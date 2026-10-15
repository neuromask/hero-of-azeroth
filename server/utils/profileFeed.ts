/**
 * One profile written into what the site keeps of it.
 *
 * A character page is a Blizzard lookup, and a lookup that came back with somebody is the moment the site learns
 * two things at once: that a page exists (which is what the sitemap's index is for, see `./characterIndex`) and
 * what the character was when it was read - the reading itself, which the hall of fame's table, a character's
 * history and the distribution a comparison board draws are all read from (`./characterReading`,
 * `./statisticsPopulation`). Both are written from here, and from nowhere else, because *every* reader of a
 * profile has to feed both of them.
 *
 * There is no third store to keep in step: the table used to have a file of its own, written from here as well,
 * and it is a query over the reading now (`./leaderboardRows`).
 *
 * That is the rule the two stores were missing. A profile is read by more than the character page:
 * the card the page previews as and the front door shares is read by crawlers, by every share of a
 * link and by the download button, and a lookup that filled the index and the table only from the
 * character endpoint left the readers of the other one with a row that was missing everything the
 * profile had said - a portrait, a faction, the pets, the toys, the decor, the achievements -
 * while the card drawn from the very same profile showed all of it.
 *
 * It is one function rather than two calls beside each other at each reader for the same reason the
 * table and the index are written in one place each: what a Blizzard profile becomes when it is
 * stored is a single decision, and a second copy of the mapping is a copy that drifts. Each of the
 * two writes swallows its own failure, because a record that could not be written is a stale row
 * rather than a broken page - so this awaits both and still cannot fail the request it is made for.
 */
import type { CharacterData } from './blizzard'
import type { BlizzardRegion } from './params'
import { fileDailyReading } from './characterReading'
import { fileAccountReading } from './accountPool'
import { nowSec } from './db'

/** A freshly read profile, and the three address segments it belongs to. */
export interface ProfileFeedInput {
  region: BlizzardRegion
  /** The realm's slug, lowercased: what an address and a record are keyed by. */
  realm: string
  /** The character's name, lowercased. */
  name: string
  profile: CharacterData
  /**
   * True when this profile is a reading the site has just taken from Blizzard, rather than a copy of one
   * handed out of a cache.
   *
   * It decides one of the three writes below: a reading is filed as the character's own point
   * (`server/utils/characterReading`), and the profile page, the hall of fame's row and the character page
   * itself all compute their figures from what is filed. A copy is not filed - it is by definition older
   * than the reading already on file, and filing it would move the record backwards for every reader who
   * has not opened the same page in the last two hours.
   */
  reading?: boolean
}

export async function feedProfile({ region, realm, name, profile, reading }: ProfileFeedInput): Promise<void> {
  // Everything a stored record is made of, read off the profile once: the sitemap's index is filled from this
  // list, and nothing else is. What the site counts - the table, a history, a distribution - is read from the
  // database, which the reading below is filed into.
  const figures = {
    displayName: profile.name,
    avatar: profile.avatarUrl,
    faction: profile.faction,
    classId: profile.classId,
    level: profile.level,
    ilvl: profile.ilvl,
    mPlusScore: profile.mPlusScore,
    mounts: profile.stats.mounts.count,
    pets: profile.stats.pets.count,
    toys: profile.stats.toys.count,
    decor: profile.stats.decor.count,
    reputations: profile.stats.reputations.count,
    achievements: profile.ap,
    // The one figure of the list that is not a collection of items, and the one an account answers for by
    // adding its characters up rather than by taking the best of them (`server/utils/accountPool`): the
    // reading lives in the profile's own stats, beside the honor level.
    honorableKills: profile.stats.honorableKills.count
  }

  // The sitemap's index: the page exists, and what the character was when it was seen.
  await rememberCharacter({ region, realm, name, ...figures })

  // And the reading's own point, for a character that belongs to an account - and only when this profile is
  // a reading rather than a copy of one (`reading` above). The three readers of an account's figures - the
  // profile page, this page and the hall of fame's row - all compute them from what is filed
  // (`server/utils/accountPool`), so a reading taken here and not filed would leave two of the three up to a
  // sync behind the page it was taken from. That is the drift a reader notices as one collection reading as
  // two numbers on two pages.
  //
  // A character nobody has signed in for is filed as well, as a guest (`characters.user_id IS NULL`): the
  // reading is the site's own record of them - the history a comparison board draws - and it belongs to
  // whoever asked for the page rather than to an account. Every account-wide read is keyed by `user_id` or
  // joins `users` (`./accountPool`, `./accounts`, `./presence`, `./leaderboardExclusions`), so the row is
  // invisible to the roster by itself and the character's own figures stay their own. The moment it belongs to
  // is UTC, exactly as the background pass files it (`server/utils/characterReading`).
  if (reading) {
    const stored = useDb()
      .prepare('SELECT id, user_id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
      .get(region, realm, name) as { id: number; user_id: number | null } | undefined

    const characterId = stored?.id ?? rememberGuest({ region, realm, name, profile })
    fileDailyReading(characterId, profile)

    // And the account's own history, when the character belongs to one: what the statistics count is the account
    // (`./statisticsPopulation`), so every character of it shows the same figures and the same curve, and the
    // totals are what the pool and the roster's readings now say (`fileAccountReading` in `./accountPool`).
    const owner = stored ? stored.user_id : null
    if (owner !== null) fileAccountReading(owner)
  }
}

/**
 * Files the wardrobe count a tray has just read, as that character's own point.
 *
 * The appearances are the one figure of the fourteen a profile does not carry: the document behind them is 2.5 MB
 * and is read by the tray that asks for it (`server/api/transmog`, and the wardrobe row of a comparison board).
 * A reading the site has taken belongs in the site's record of the character, and this is where it is filed -
 * without it the one figure a reader has just looked at is the one figure a distribution cannot place, and a
 * guest, whose profile no account's sync ever reads, would never have it at all.
 *
 * A character the site has never met is not created here: the tray is opened from a page that has already read
 * them, so a row that is not there is a row this call has nothing to say about.
 */
export function fileTransmogReading(region: string, realm: string, name: string, count: number): void {
  const stored = useDb()
    .prepare('SELECT id, user_id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
    .get(region, realm, name) as { id: number; user_id: number | null } | undefined

  if (!stored) return

  fileDailyReading(stored.id, { stats: { transmogs: { count } } })

  // And the account's own history, when the character belongs to one: the wardrobe is the account's whole, so its
  // own point is what its characters print, and the totals are what the roster's readings now say
  // (`fileAccountReading`).
  if (stored.user_id !== null) fileAccountReading(stored.user_id)
}

/**
 * Writes a character's own row for a guest, and answers its id - the one writer of such a row.
 *
 * A guest is a character the site has read that no account holds, and both of the callers that can meet one go
 * through here: a profile read (`rememberGuest` below) and the migration of the hall of fame's own table
 * (`./statisticsMigration`), which holds rows written before the database kept guests at all. The row is the one
 * an account's character gets, without an owner: the address, what was read about the character, and the day the
 * site met them - which is written once and never moved again, the way the index keeps its own record.
 *
 * The address is unique on its own for a guest (`idx_characters_guest`, see `./db`), and the upsert names that
 * index as its conflict target: two readers landing on the same stranger at once is one row rather than two,
 * which is what keeps one character's readings in one history. A field this reading does not carry is kept from
 * the row already there (`COALESCE`). A character that belongs to an account is never touched: this only ever
 * inserts or updates a guest row.
 */
export function rememberGuestRow(input: {
  region: string
  realm: string
  name: string
  realmName?: string | null
  displayName?: string | null
  avatar?: string | null
  classId?: number | null
  level?: number | null
  faction?: string | null
  /** The day the site first met the character, in seconds; now when the caller does not say. */
  firstSeenAt?: number
}): number {
  const db = useDb()
  const now = nowSec()

  db.prepare(
    `INSERT INTO characters
       (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id, level, faction, avatar,
        first_seen_at, last_seen_at)
     VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (region, realm_slug, name_key) WHERE user_id IS NULL DO UPDATE SET
       realm_name = excluded.realm_name,
       display_name = excluded.display_name,
       class_id = COALESCE(excluded.class_id, characters.class_id),
       level = COALESCE(excluded.level, characters.level),
       faction = COALESCE(excluded.faction, characters.faction),
       avatar = COALESCE(excluded.avatar, characters.avatar),
       last_seen_at = excluded.last_seen_at`
  ).run(
    input.region,
    input.realm,
    input.realmName || input.realm,
    input.name,
    input.name,
    input.displayName || input.name,
    input.classId ?? null,
    input.level ?? null,
    (input.faction || '').toLowerCase() || null,
    input.avatar || null,
    input.firstSeenAt ?? now,
    now
  )

  const row = db
    .prepare(
      'SELECT id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? AND user_id IS NULL LIMIT 1'
    )
    .get(input.region, input.realm, input.name) as { id: number } | undefined

  if (!row) throw new Error(`the guest row for ${input.region}:${input.realm}:${input.name} could not be read back`)

  return row.id
}

/**
 * Files a character the site has met that no account holds, and answers its row.
 *
 * The figures are deliberately not written here - they arrive as the reading the caller files next, which is the
 * one thing that writes them (`./characterReading`), so a guest's history is filed by exactly the code that files
 * an account's, down to the carry-forward of a partial read.
 */
function rememberGuest({ region, realm, name, profile }: Omit<ProfileFeedInput, 'reading'>): number {
  return rememberGuestRow({
    region,
    realm,
    name,
    realmName: profile.realm || realm,
    displayName: profile.name,
    avatar: profile.avatarUrl,
    classId: profile.classId,
    level: profile.level,
    faction: profile.faction
  })
}
