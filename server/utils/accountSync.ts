/**
 * The characters an account holds, written from the one summary call a sign-in makes.
 *
 * Only what that call carries is stored: a name, a realm, a level, a class, a faction. Stats are
 * deliberately left out - each one costs a Blizzard read - and are filled by the background task or
 * by the first click on a character (`server/api/profile/character/[id].get.ts`). That split is the
 * whole answer to a gateway timeout: a thirty-alt account costs one request at sign-in, not thirty.
 */
import type { BlizzardRegion } from './params'
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
       (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id, level, faction, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    // A realm is addressed by its slug; one that named only the realm's display name is turned into
    // a slug, which is what a character page's address needs.
    const realmSlug = flat?.realm?.slug || nested?.realm?.slug || slugify(realmName)
    if (!name || !realmSlug) continue

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
      now
    )

    result.stored += 1
  }

  return result
}

/** A realm's display name as the slug an address spells: `Tarren Mill` -> `tarren-mill`. */
function slugify(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u0400-\u04ff]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A character row as the database keeps it, which is what a stats read is made for. */
export interface CharacterRow {
  id: number
  user_id: number
  region: string
  realm_slug: string
  name: string
  name_key: string
}

/**
 * Reads one character live and writes what it says: the row's own fields and one snapshot.
 *
 * This is the expensive half - a full Blizzard profile read - and it is called only from two
 * places, both of them off the sign-in path: the profile page when a reader clicks a character,
 * and the background task. The snapshot is keyed to the day, so the aggregate is a step chart
 * rather than a log - opening the same character twice in an afternoon updates one row.
 *
 * Returns the profile, so the endpoint can hand the page the same document the site's public
 * character reader would.
 */
export async function refreshCharacterStats(row: CharacterRow, locale = 'en_US') {
  const profile = await getCharacter(row.realm_slug, row.name_key, row.region, locale)
  // The portrait is not on the summary and the professions are a document of their own, so both are
  // read here - where a character is read in full - and kept on the row the tiles draw from.
  const professions = await getCharacterProfessions(row.realm_slug, row.name_key, row.region)
  const db = useDb()
  const now = nowSec()
  const dayStart = Math.floor(now / 86400) * 86400

  // The row as the roster lists it, plus the moment its figures were read: the snapshot is keyed to
  // the day (`taken_at` below), so this is the only place a page can learn when the reading actually
  // happened - which is what a tile prints as "Updated 5 minutes ago" rather than "20 hours ago".
  db.prepare(
    `UPDATE characters
        SET realm_name = ?, display_name = ?, class_id = ?, level = ?, faction = ?,
            avatar = ?, profession_1 = ?, profession_2 = ?, last_seen_at = ?, stats_read_at = ?
      WHERE id = ?`
  ).run(
    profile.realm,
    profile.name,
    profile.classId || null,
    profile.level || null,
    (profile.faction || '').toLowerCase() || null,
    profile.avatarUrl || null,
    professions[0] || null,
    professions[1] || null,
    now,
    now,
    row.id
  )

  db.prepare('DELETE FROM snapshots WHERE character_id = ? AND taken_at = ?').run(row.id, dayStart)
  db.prepare(
    `INSERT INTO snapshots (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    dayStart,
    profile.ilvl ?? null,
    profile.mPlusScore ?? null,
    profile.ap ?? null,
    profile.stats.mounts.count,
    profile.stats.pets.count,
    profile.stats.toys.count,
    profile.stats.decor.count,
    profile.stats.reputations?.count ?? null
  )

  // What this character adds to the account's pool, both folded in as ids: its own mount journal
  // (a mount can belong to a side or a race, and it only ever appears in the journal of a character
  // who can use it, so the union across the roster is the account's real figure) and the factions it
  // has finished. A pool that grew hands the account's row over at once; the rest of the batch is
  // handed over once per account when the pass ends (`syncDueCharacters`), so a pass over a hundred
  // alts is not a hundred leaderboard writes.
  try {
    const mounts = await getCharacterMountIds(row.realm_slug, row.name_key, row.region, locale)
    const factions = await getMaxedReputationIds(row.realm_slug, row.name_key, row.region, locale)

    const added = addToPool(row.user_id, 'mounts', mounts) + syncPoolReputations(row.user_id, factions)
    if (added) syncMainToLeaderboard(row.user_id)
  } catch {
    // A reputation read that failed leaves the pool as it was; the next pass tries again.
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
        `SELECT c.id, c.user_id, c.region, c.realm_slug, c.name, c.name_key
           FROM characters c
          WHERE NOT EXISTS (
                  SELECT 1 FROM snapshots s
                   WHERE s.character_id = c.id AND s.taken_at > ?
                )
                ${scope}
          ORDER BY c.is_main DESC, COALESCE(c.level, 0) DESC, c.last_seen_at DESC
          LIMIT ?`
      )
      .all(...(params as any[])) as DueCharacter[]
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

  // And the main's public row once per account the pass touched. What that row prints is the
  // account's own figures (`./accountPool`), and the snapshots written above are one of the things
  // they are read from - so a pass that moved a figure the row shows has to hand it over. Once per
  // account rather than once per character: a record that already says these figures is not written
  // again, so a pass over a hundred alts is one comparison and no disk at all.
  for (const account of new Set(due.map((row) => row.user_id))) {
    try {
      syncMainToLeaderboard(account)
    } catch {
      // The row keeps what it had; the next pass tries again.
    }
  }

  return done
}
