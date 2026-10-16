/**
 * The characters an account holds, written from the one summary call a sign-in makes.
 *
 * Only what that call carries is stored: a name, a realm, a level, a class, a faction. Stats are
 * deliberately left out - each one costs a Blizzard read - and are filled by the background task or
 * by the first click on a character (`server/api/profile/character/[id].get.ts`). That split is the
 * whole answer to a gateway timeout: a thirty-alt account costs one request at sign-in, not thirty.
 */
import type { BlizzardRegion } from './params'
import { fileDailyReading } from './characterReading'
import { fileAccountReading } from './accountPool'
import { dropGuestRow } from './leaderboardRows'
import { nowSec } from './db'

/** What one roster read did, which is what a page or a log needs to explain an empty grid. */
export interface AccountSyncResult {
  /** How many WoW accounts the summary carried. */
  accounts: number
  /** How many character entries those accounts carried, before anything was filtered. */
  characters: number
  /** How many rows were actually written. */
  stored: number
  /** The top-level keys of the answer - what tells a shape that parses to nothing apart. */
  responseKeys: string[]
  /** The keys of the first WoW account entry. */
  accountKeys: string[]
  /** The keys of the first character entry, for the same reason. */
  characterKeys: string[]
}

/**
 * Writes every character the account summary names, refreshing the ones already on file.
 *
 * The upsert keys on the account and the character's address, so a character that has been renamed
 * simply appears beside the old row until the old one is gone - and a character that is looked at
 * again keeps the fields this call did not carry (`COALESCE`), which is what lets a later stats read
 * survive a summary that only knows names.
 *
 * The shape is read defensively: Battle.net nests each character under `character`, but a realm's
 * `slug` is not guaranteed, and an answer this build cannot read must be a diagnosable `0` rather
 * than a silent one - which is what the counts and the key lists are for.
 */
export async function upsertAccountCharacters(
  userId: number,
  region: BlizzardRegion,
  accessToken: string,
  locale = 'en_US'
): Promise<AccountSyncResult> {
  const summary = await getAccountProfile(region, accessToken, locale)
  const accounts = summary?.wow_accounts || []
  const entries = accounts.flatMap((account) => account?.characters || [])

  const result: AccountSyncResult = {
    accounts: accounts.length,
    characters: entries.length,
    stored: 0,
    responseKeys: summary && typeof summary === 'object' ? Object.keys(summary) : [],
    accountKeys: accounts[0] && typeof accounts[0] === 'object' ? Object.keys(accounts[0]) : [],
    characterKeys: entries[0] && typeof entries[0] === 'object' ? Object.keys(entries[0]) : []
  }

  if (!entries.length) return result

  const statement = useDb().prepare(
    `INSERT INTO characters
       (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id, level, faction,
        first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, region, realm_slug, name_key) DO UPDATE SET
       realm_name = excluded.realm_name,
       display_name = excluded.display_name,
       class_id = COALESCE(excluded.class_id, characters.class_id),
       level = COALESCE(excluded.level, characters.level),
       faction = COALESCE(excluded.faction, characters.faction),
       last_seen_at = excluded.last_seen_at`
  )

  const now = nowSec()

  for (const entry of entries) {
    // The account summary carries the character's own fields on the entry itself (`name`, `realm`,
    // `level`, `playable_class`, `faction`); the `character` beside them is a link reference, not a
    // second copy of the data. The flat fields are read first, and the reference only stands in for
    // an answer that nests them there instead.
    const flat = entry as any
    const nested = flat?.character || {}
    const name = flat?.name || nested?.name
    const realmName = flat?.realm?.name || nested?.realm?.name || ''
    // A realm is addressed by its slug; one that named only the realm's display name has the name looked up
    // in Blizzard's own realm list, which is the only authority on which spelling belongs to which address
    // (`realmSlugByName`). Slugifying the name as it stands is the last resort, for a realm that list has
    // not got.
    const realmSlug = flat?.realm?.slug || nested?.realm?.slug || (await realmSlugByName(region, realmName))
    if (!name || !realmSlug) continue

    // A row the site already keeps for this character as a guest is handed over first, so the insert below
    // finds it rather than writing a second row beside it.
    claimGuestCharacter(userId, region, realmSlug, name)

    statement.run(
      userId,
      region,
      realmSlug.toLowerCase(),
      realmName || realmSlug,
      name,
      name.toLowerCase(),
      name,
      flat?.playable_class?.id ?? nested?.playable_class?.id ?? null,
      flat?.level ?? nested?.level ?? null,
      (flat?.faction?.type || nested?.faction?.type || '').toLowerCase() || null,
      now,
      now
    )

    result.stored += 1
  }

  return result
}

/**
 * Hands the guest row of a character over to the account that has just claimed them.
 *
 * A character the site read before its owner signed in is on file with no owner (`./profileFeed`), and its
 * readings are that character's own record - the history a comparison board draws. Naming the owner is what
 * keeps one character one row: inserting beside the guest would leave the site's record of a single character
 * split over two ids, and every page would then read whichever of the two its query happened to find first -
 * two histories for one character, and a reading that appears to jump whenever the other row is found.
 *
 * Only a row with no owner is ever touched, so a character that already belongs to somebody - this account or
 * another - is left exactly as it was, and a character with no guest row simply has none to hand over (the
 * insert that follows writes one).
 */
export function claimGuestCharacter(userId: number, region: string, realm: string, name: string): void {
  const claimed = useDb()
    .prepare(
      `UPDATE characters SET user_id = ?, last_seen_at = ?
        WHERE region = ? AND realm_slug = ? AND name_key = ? AND user_id IS NULL`
    )
    .run(userId, nowSec(), region, String(realm).toLowerCase(), String(name).toLowerCase())

  // The character was a guest and is now an account's, which is the one write here that moves the population: it
  // is an alt until the account names it its main, so it leaves the table the moment it is claimed
  // (`./statisticsPopulation`). Dropping the row it held as a guest is what takes it out - and what moves the
  // revision every memo of the population is keyed on (`./leaderboardRows`). A claim that matched nothing - the
  // character already belongs to somebody - leaves the table exactly as it was.
  if (claimed.changes > 0) dropGuestRow(region, realm, name)
}

/** A realm's display name as the slug an address spells: `Tarren Mill` -> `tarren-mill`. */
function slugify(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * The address of a realm a roster entry named only by its display name.
 *
 * A roster read in Russian names a realm the way the game does in Russian (`Гордунни`), while the address a
 * character's page is built from needs the slug Blizzard files it under (`gordunni`). Slugifying the Russian
 * name gives `гордунни`: a realm no endpoint can resolve, and a second row for every character on it - two
 * cards in the profile, one of them leading nowhere. So the name is looked up in Blizzard's own realm list,
 * read in both languages the site serves and cached for the process (`getRealms`), and the slugified name is
 * only what stands for a realm that list has not got.
 */
const REALM_LOCALES = ['en_US', 'ru_RU'] as const
/** The names each region's realms answer to, per region, filled once and kept. */
const realmSlugs = new Map<string, Map<string, string>>()

async function realmSlugByName(region: BlizzardRegion, name: string): Promise<string> {
  const wanted = String(name || '').trim().toLowerCase()
  if (!wanted) return ''

  let known = realmSlugs.get(region)
  if (!known) {
    known = new Map<string, string>()
    realmSlugs.set(region, known)

    for (const locale of REALM_LOCALES) {
      try {
        for (const realm of await getRealms(region, locale)) {
          known.set(String(realm.name || '').trim().toLowerCase(), realm.slug)
        }
      } catch {
        // A realm list that cannot be read leaves the slugified name in charge, as it was before.
      }
    }
  }

  return known.get(wanted) || slugify(name)
}

/** A character row as the database keeps it, which is what a stats read is made for. */
export interface CharacterRow {
  id: number
  /**
   * The account that holds this character, or `null` for a guest: a character the site has read that nobody has
   * signed in for (`./profileFeed` files one). A guest's reading is filed like any other, but the account's own
   * pool has nothing to do with it - see `doRefreshCharacterStats`.
   */
  user_id: number | null
  region: string
  realm_slug: string
  name: string
  name_key: string
  /** Whether this is the character its account leads with, which is who files the account's wardrobe. */
  is_main?: number
}

/** A character being read in full, shared so two passes over the same alt wait once. */
const pendingRefreshes = new Map<number, ReturnType<typeof doRefreshCharacterStats>>()

/**
 * Reads one character live and writes what it says: the row's own fields and one snapshot.
 *
 * This is the expensive half - a full Blizzard profile read - and it is called only from two
 * places, both of them off the sign-in path: the profile page when a reader clicks a character,
 * and the background task. The point is one per real update rather than one per day: opening the
 * same character twice in an afternoon leaves one new row only when the figures actually moved
 * (`server/utils/characterReading`), which is what keeps the history a log of change.
 *
 * Returns the profile, so the endpoint can hand the page the same document the site's public
 * character reader would.
 */
export function refreshCharacterStats(row: CharacterRow, locale = 'en_US') {
  const running = pendingRefreshes.get(row.id)
  if (running) return running

  const read = doRefreshCharacterStats(row, locale).finally(() => {
    pendingRefreshes.delete(row.id)
  })
  pendingRefreshes.set(row.id, read)

  return read
}

async function doRefreshCharacterStats(row: CharacterRow, locale = 'en_US') {
  const profile = await getCharacter(row.realm_slug, row.name_key, row.region, locale)
  // The portrait is not on the summary and the professions are a document of their own, so both are
  // read here - where a character is read in full - and kept on the row the tiles draw from.
  const professions = await getCharacterProfessions(row.realm_slug, row.name_key, row.region)
  const db = useDb()
  const now = nowSec()

  // The row as the roster lists it. The moment its figures were read is not set here: it belongs to the
  // reading below, which sets it whether or not the figures moved (`server/utils/characterReading`), so
  // the column has one writer rather than two.
  db.prepare(
    `UPDATE characters
        SET realm_name = ?, display_name = ?, class_id = ?, level = ?, faction = ?,
            avatar = ?, guild = COALESCE(?, guild), profession_1 = ?, profession_2 = ?, last_seen_at = ?
      WHERE id = ?`
  ).run(
    profile.realm,
    profile.name,
    profile.classId || null,
    profile.level || null,
    (profile.faction || '').toLowerCase() || null,
    profile.avatarUrl || null,
    // The guild the profile named, which is a fact about the character and not a figure of its readings: it is
    // written here, where a character is read in full, and nowhere else. A profile that names none leaves the
    // guild the row already held rather than blanking it, which is the rule every partial read follows.
    profile.guild || null,
    professions[0] || null,
    professions[1] || null,
    now,
    row.id
  )

  /**
   * And the account's wardrobe, read once for the account rather than once per character.
   *
   * The appearance sources are the account's own figure - the game keeps the wardrobe for the whole account, so
   * two of its characters answer the same document - which is why the character its *main* leads with is the one
   * that files it, and why every other character's tile reads it from the account's totals. It is also the most
   * expensive read of the twelve (2.5 MB): a pass over a thirty-alt account would otherwise ask Blizzard for the
   * same document thirty times.
   */
  if (row.is_main) {
    const transmogs = await getCharacterTransmogs(row.realm_slug, row.name_key, row.region)
    if (transmogs !== null) profile.stats.transmogs = { count: transmogs, accountWide: true }
  }

  // The reading's own point, filed by the one function that knows how (`fileDailyReading`): the same call a
  // character page makes when it reads a profile in full, so the two can never file a point differently -
  // or leave one of them unfiled.
  fileDailyReading(row.id, profile)

  // What this character adds to the account's pool, both folded in as ids: its own mount journal
  // (a mount can belong to a side or a race, and it only ever appears in the journal of a character
  // who can use it, so the union across the roster is the account's real figure) and the factions it
  // has finished. A pool that grew hands the account's row over at once; the rest of the batch is
  // handed over once per account when the pass ends (`syncDueCharacters`), so a pass over a hundred
  // alts is not a hundred leaderboard writes.
  //
  // The pool is the *account's*, keyed by it, so a guest has none to add to: a character read for nobody files
  // its own reading above and nothing else, and the five reads below - the most expensive of the twelve - are
  // not even asked for, because every figure they carry is only ever folded into that pool.
  const owner = row.user_id

  if (owner !== null) {
    try {
      const [mounts, factions, titles, quests, recipes] = await Promise.all([
        getCharacterMountIds(row.realm_slug, row.name_key, row.region, locale),
        getMaxedReputationIds(row.realm_slug, row.name_key, row.region, locale),
        // The three figures a character *earns*: read here as ids, because a count cannot be unioned with
        // anything and the account's own figure is exactly that union (`syncPoolFigures`).
        getCharacterTitleIds(row.realm_slug, row.name_key, row.region),
        getCharacterQuestIds(row.realm_slug, row.name_key, row.region),
        getCharacterRecipeIds(row.realm_slug, row.name_key, row.region)
      ])

      addToPool(owner, 'mounts', mounts)
      syncPoolReputations(owner, factions)
      syncPoolFigures(owner, { titles, quests, recipes })
    } catch {
      // A read that failed leaves the pool as it was; the next pass tries again.
    }

    // And the account's own figures, which is what the site counts it by: the reading above and the pool just
    // folded in are both what they are made of, so the point is filed once, here, after both. `fileAccountReading`
    // decides what a point is - it writes nothing when the totals say what the newest point already says, and
    // nothing at all until one of the account's characters has been read in full (`./accountPool`).
    fileAccountReading(owner)
  }

  // The professions ride along on the answer, so a tile that was just refreshed can draw them
  // without a second request for the same character. `readAt` is the moment the read was stored,
  // which the tile prints as its own update time: the client's clock is not the authority on when
  // Blizzard was last asked.
  return { ...profile, professions, readAt: now }
}

/** A character a stats read is due for, with the account it belongs to. */
interface DueCharacter extends CharacterRow {
  main_character_id: number | null
}

/**
 * Refreshes a handful of characters whose newest reading is missing or a day old.
 *
 * The sign-in writes names, not figures, so this is what fills item levels, M+ ratings and
 * collections in behind the reader's back. It never runs on a request path that has to answer
 * quickly: the profile page starts it and forgets it, and the scheduled task waits for it. The
 * batch is small on purpose - a thirty-alt account is filled over several passes rather than in one
 * burst that Blizzard would rate-limit.
 *
 * A character Blizzard will not answer for is left for the next pass; nothing here throws upward,
 * because a background refresh that fails is a stale row, not a broken site.
 */
export async function syncDueCharacters(limit = 5, locale = 'en_US', userId?: number): Promise<number> {
  let due: DueCharacter[]
  try {
    const scope = userId ? 'AND c.user_id = ?' : ''
    const params: unknown[] = [nowSec() - 86400]
    if (userId) params.push(userId)
    params.push(limit)

    due = useDb()
      .prepare(
        `SELECT c.id, c.user_id, c.region, c.realm_slug, c.name, c.name_key, c.is_main
           FROM characters c
          WHERE NOT EXISTS (
                  SELECT 1 FROM snapshots s
                   WHERE s.character_id = c.id AND s.taken_at > ?
                )
                -- The accounts' characters only: a guest's reading is taken when somebody opens the page, and
                -- a background pass that refreshed strangers would spend the site's Blizzard quota on nobody's
                -- roster. Guests are also the ones this pass cannot finish for - there is no account to hand the
                -- result to.
                AND c.user_id IS NOT NULL
                ${scope}
          ORDER BY c.is_main DESC, COALESCE(c.level, 0) DESC, c.last_seen_at DESC
          LIMIT ?`
      )
      .all(...(params as any[])) as unknown as DueCharacter[]
  } catch {
    return 0
  }

  let done = 0

  for (const row of due) {
    try {
      await refreshCharacterStats(row, locale)
      done += 1
    } catch {
      // Retried on the next pass; one character that cannot be read never stops the batch.
    }
  }

  // The pool block above already handed each account's own point over, character by character, so nothing is
  // left to do once the pass ends: a pass over a hundred alts files the account's point a hundred times, and
  // every one of those but the last says what the point before it said (`fileAccountReading`).

  return done
}
