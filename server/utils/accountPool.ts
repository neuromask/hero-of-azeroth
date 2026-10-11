/**
 * The account's pool: one unique id per thing the account owns.
 *
 * A WoW collection is shared across every character of a Battle.net account - mounts, pets, toys,
 * decor, and the reputations driven to Exalted - so the account's real numbers are a **union of
 * unique ids**, never a sum over the roster and never just one character's list. This is that
 * union, and it is what every figure the site prints for an account's character is read from:
 * the profile tiles, the character pages, the card, and the main's row in the hall of fame.
 *
 * Two things fill it, and both are ids rather than counts:
 *
 *   1. **Blizzard's account collections** (`/profile/user/wow/collections/*`), read at sign-in and
 *      on demand - the account's own mount, pet, toy and decor lists, both factions included.
 *   2. **Each character's reputations**, as the character is read: the factions that character has
 *      driven to the top of their ladder. Because a reputation is a character's, the pool's
 *      reputation figure only grows as the roster is read - which is exactly the "union across all
 *      characters" the number is meant to be.
 *
 * A character that belongs to no account - a stranger's lookup - has no pool, and the site answers
 * with Blizzard's per-character numbers, which is the behaviour the site has always had.
 */
import { nowSec } from './db'
import { readCharacterReading } from './characterReading'
import { ACCOUNT_COLLECTION_KINDS } from './bnetOAuth'
import type { BlizzardRegion } from './params'
import type { CharacterData } from './blizzard'
// The overall rating, and the one place it is computed: the account's own figure, the table's column and
// every page's tile are one number because they are one call (`server/utils/playerScore`).
import { calculatePlayerScore, scoreFigures, type ScoreInput } from './playerScore'
// The identity the hall of fame keys a row on, so the totals below are handed back under the key
// the table itself looks a row up by.
import { leaderboardKey } from './leaderboardExclusions'

/** The kinds the pool counts, one per figure a tile prints. */
const POOL_KINDS = ['mounts', 'pets', 'toys', 'decor', 'reputations'] as const

/** One of those kinds, which is also the name every reader of an account's figures knows it by. */
export type PoolKind = (typeof POOL_KINDS)[number]

/** The account's own numbers, each one a count of unique ids. */
type AccountPool = Record<PoolKind, number>

/** The ids one collection answer carried, each kind under its own spelling. */
function idsOf(kind: (typeof ACCOUNT_COLLECTION_KINDS)[number], data: any): number[] {
  if (!data || typeof data !== 'object') return []

  const idOf = (value: any, ...path: string[]): number | undefined => {
    let node = value
    for (const key of path) node = node?.[key]
    return typeof node === 'number' ? node : undefined
  }

  switch (kind) {
    case 'mounts':
      return (data.mounts || []).map((entry: any) => entry?.mount?.id ?? entry?.id).filter((id: any) => typeof id === 'number')
    case 'pets':
      return (data.pets || []).map((entry: any) => entry?.species?.id ?? entry?.id).filter((id: any) => typeof id === 'number')
    case 'toys':
      return (data.toys || []).map((entry: any) => entry?.toy?.id ?? entry?.id).filter((id: any) => typeof id === 'number')
    case 'decor':
      return (data.decor_items || data.decor || data.items || [])
        .map((entry: any) => idOf(entry, 'decor_item', 'id') ?? entry?.id)
        .filter((id: any) => typeof id === 'number')
  }
}

/** Adds ids to the pool, keeping the ones already there and writing only what is new. */
export function addToPool(userId: number, kind: PoolKind, ids: number[]): number {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))]
  if (!unique.length) return 0

  const statement = useDb().prepare(
    'INSERT OR IGNORE INTO account_pool (user_id, kind, item_id, first_seen_at) VALUES (?, ?, ?, ?)'
  )
  const now = nowSec()
  let added = 0

  for (const id of unique) {
    const result = statement.run(userId, kind, id, now)
    if (result.changes) added += 1
  }

  return added
}

/**
 * The ids the account holds of one kind, as the pool has them.
 *
 * This is what an account-wide collection shelf is drawn from (`server/utils/collections`): the pool is
 * ids rather than counts precisely so that a page can do more with it than print a number, and a shelf is
 * that page. A kind the site has never read - the account's decorations, when Blizzard refuses that call -
 * comes back empty, which is how the caller tells "nothing collected" from "nothing known" and falls back
 * to the character's own journal.
 */
export function readAccountIds(userId: number, kind: PoolKind): Set<number> {
  const ids = new Set<number>()

  try {
    const rows = useDb()
      .prepare('SELECT item_id FROM account_pool WHERE user_id = ? AND kind = ?')
      .all(userId, kind) as { item_id: number }[]

    for (const row of rows) ids.add(row.item_id)
  } catch {
    // No database yet: no pool, which reads as an account with nothing to say about this kind.
  }

  return ids
}

/**
 * Reads the account's four account-wide collections from Blizzard and folds them into the pool.
 *
 * Every kind is its own call and its own failure: one this build may not read (decor, today) leaves
 * that part of the pool where it was rather than emptying the account.
 */
export async function syncAccountCollections(
  userId: number,
  region: BlizzardRegion,
  accessToken: string,
  locale = 'en_US'
): Promise<Partial<Record<PoolKind, number>>> {
  const answers = await Promise.allSettled(
    ACCOUNT_COLLECTION_KINDS.map(async (kind) => ({
      kind,
      data: await getAccountCollection(region, accessToken, kind, locale)
    }))
  )

  const added: Partial<Record<PoolKind, number>> = {}

  for (const answer of answers) {
    if (answer.status !== 'fulfilled') {
      console.warn(
        '[accountPool] collection read failed:',
        (answer.reason as any)?.data || (answer.reason as any)?.message || answer.reason
      )
      continue
    }

    added[answer.value.kind] = addToPool(userId, answer.value.kind, idsOf(answer.value.kind, answer.value.data))
  }

  console.log('[accountPool] collections added', JSON.stringify(added))

  // The main's public row follows the pool: the Hall of Fame should compare accounts, not the
  // faction-limited collections of one character.
  syncMainToLeaderboard(userId)

  return added
}

/** The factions a character has driven to the top of their own ladder, folded into the pool. */
export function syncPoolReputations(userId: number, factionIds: number[]): number {
  return addToPool(userId, 'reputations', factionIds)
}

/** The account's own totals, as the profile, the card and the hall of fame read them. */
/**
 * The account's own totals: the six figures the site ranks by, plus the three facts about an account that
 * are not collections of them.
 *
 * It extends `AccountFigures` rather than listing the six again, so a figure added to the rating is a
 * figure of an account's totals by construction - and the table, the profile page and a character page
 * cannot be reading three different sets of the same account.
 */
export interface AccountTotals extends AccountFigures {
  ilvl: number | null
  mplus: number | null
  /** The overall rating the hall of fame ranks by, read off the six figures above. */
  score: number
  /** The kinds the pool answered, which is what marks a figure as the account's own. */
  accountWide: PoolKind[]
}

/**
 * The six figures a character prints, whoever they turn out to belong to.
 *
 * An alias rather than a second interface on purpose: these are the very figures the rating is computed
 * from (`ScoreInput`), and a copy of the six written out beside them would be a second list to keep in
 * step - which is how a score once came to be computed from a list that had lost a figure. The name is
 * here because a reader of an account's figures thinks of figures, not of a formula's inputs.
 */
export type AccountFigures = ScoreInput

/**
 * The best of two readings of the same account: the higher of each figure, never the lower.
 *
 * The rule the whole site turns on, written once. Every figure has two possible sources - the reading
 * the site just took, which is per character and may be newer than anything stored, and the account's own
 * totals, which are the union of the account's characters and are what a collector is compared by - and
 * the answer has to be the same one wherever it is read: on the character page, on the account's profile,
 * and in the hall of fame's row. So the two are merged in one function, and all three call it instead of
 * deciding for themselves, which is what let a page print one number and the table beside it another.
 *
 * `max` rather than "the account wins" or "the reading wins", because each source can legitimately be
 * ahead: the pool counts unique ids and is filled in the background, so a live reading can carry a mount
 * the pool has not been told about yet - and a reading can equally be a cached copy of two hours ago
 * (`server/utils/swrCache`) while the account's own snapshots have moved on. Taking the higher of the two
 * can only understate a figure by what the other source does not know yet, and it never lowers a number a
 * reader has already been shown.
 *
 * What it is the figure *for* is worth saying, because it is not every question the site asks about a
 * collection: it is the number the tiles and the hall of fame's rows print. A collections shelf and an
 * achievements shelf answer a different one - what *this* character can get, earn and use - and are
 * deliberately not built from this union (`server/utils/collections`, `server/utils/achievementCollections`).
 */
export function bestFigures(live: AccountFigures, account: AccountTotals): AccountFigures {
  const of = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

  return {
    achievements: Math.max(of(live.achievements), of(account.achievements)),
    mounts: Math.max(of(live.mounts), of(account.mounts)),
    pets: Math.max(of(live.pets), of(account.pets)),
    toys: Math.max(of(live.toys), of(account.toys)),
    decor: Math.max(of(live.decor), of(account.decor)),
    reputations: Math.max(of(live.reputations), of(account.reputations))
  }
}

/** How many unique ids of each kind the account holds. */
function readAccountPool(userId: number): AccountPool {
  const pool: AccountPool = { mounts: 0, pets: 0, toys: 0, decor: 0, reputations: 0 }

  try {
    const rows = useDb()
      .prepare('SELECT kind, COUNT(DISTINCT item_id) AS count FROM account_pool WHERE user_id = ? GROUP BY kind')
      .all(userId) as { kind: string; count: number }[]

    for (const row of rows) {
      if ((POOL_KINDS as readonly string[]).includes(row.kind)) pool[row.kind as PoolKind] = row.count
    }
  } catch {
    // No database yet: an empty pool, which reads as "no account behind this character".
  }

  return pool
}

/** The best reading of each figure among the characters of an account that has no pool yet. */
interface AccountMaxes {
  ilvl: number | null
  mplus: number | null
  achievements: number | null
  mounts: number | null
  pets: number | null
  toys: number | null
  decor: number | null
  reputations: number | null
}

/**
 * The account's totals: the best of what its pool counts and what its characters have been shown to hold.
 *
 * Nothing here adds two characters together. A collection is account-wide, so the site holds two lower
 * bounds of the account's own figure - the pool's unique count of ids, and the highest reading of any one
 * of its characters - and the higher of the two is the account's (`pick` below). `MAX`, never `SUM`: a
 * pool of one and a reading of one are two views of the same mount rather than two mounts. The item level
 * and the rating are not folded like that at all: they really are one character's, so the roster's best
 * stands for the account without being merged with anything.
 */
export function readAccountTotals(userId: number): AccountTotals {
  const maxes = useDb()
    .prepare(
      `SELECT
         (SELECT MAX(s.ilvl)         FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS ilvl,
         (SELECT MAX(s.mplus_score)  FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS mplus,
         (SELECT MAX(s.achievements) FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS achievements,
         (SELECT MAX(s.mounts)       FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS mounts,
         (SELECT MAX(s.pets)         FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS pets,
         (SELECT MAX(s.toys)         FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS toys,
         (SELECT MAX(s.decor)        FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS decor,
         (SELECT MAX(s.reputations)  FROM snapshots s JOIN characters c ON c.id = s.character_id WHERE c.user_id = ?) AS reputations`
    )
    .get(userId, userId, userId, userId, userId, userId, userId, userId) as AccountMaxes

  const pool = readAccountPool(userId)
  const accountWide = POOL_KINDS.filter((kind) => pool[kind] > 0)

  /**
   * The account's number for a kind: the higher of what its pool counts and what its characters have
   * been shown to hold.
   *
   * Never the sum of the two, and never one where the other would do: both are counts of the same
   * collection, so each is a lower bound of what the account really has - the pool counts the unique ids
   * the site has been shown across the whole roster, and the readings are Blizzard's own count for one of
   * the account's characters, which is why they can differ by a few (a per-character view of an
   * account-wide collection). Taking the higher of the two is the rule the rest of the site merges with
   * (`bestFigures`), and it is what keeps an account's own page, the character page that belongs to it
   * and the hall of fame's row from printing three different numbers for one collection: preferring the
   * pool, as this did, left the other two with a figure the pool could only have understated.
   */
  const pick = (kind: PoolKind, fallback: number | null): number => Math.max(pool[kind] || 0, fallback || 0)

  /**
   * The account's own six, gathered in one object: every one of them is also a figure of the totals below,
   * and the rating is computed from this object rather than from a second list of the same values written
   * out beside it - the shape is the formula's own input, so a figure cannot be present in one list and
   * missing from the other.
   */
  const figures: AccountFigures = {
    achievements: maxes.achievements || 0,
    mounts: pick('mounts', maxes.mounts),
    pets: pick('pets', maxes.pets),
    toys: pick('toys', maxes.toys),
    decor: pick('decor', maxes.decor),
    reputations: pick('reputations', maxes.reputations)
  }

  return {
    ilvl: maxes.ilvl ?? null,
    mplus: maxes.mplus ?? null,
    ...figures,
    // The overall rating, off the very collections above - the same formula the table's own column is
    // computed with, so the pool never carries a score the leaderboard would not agree with.
    score: calculatePlayerScore(figures),
    accountWide
  }
}

/**
 * The account's totals, handed back under the key the hall of fame keys a row on.
 *
 * This is what lets the table *read* the account rather than wait to be told: the row of a
 * signed-in player is drawn with the account's own figures wherever it is read, whether or not that
 * character has been looked up since the pool last grew. Without it a row written before the pool
 * existed keeps the character's faction-limited numbers until somebody happens to open that page,
 * while the page itself already answers with the account's - the table and the character page
 * disagreeing about the same reader.
 *
 * One pass over the roster answers every row, and each account's totals are read once however many
 * of its characters the table holds.
 */
export function accountTotalsByCharacterKey(): Map<string, AccountTotals> {
  const totals = new Map<string, AccountTotals>()

  try {
    const rows = useDb()
      .prepare('SELECT user_id, region, realm_slug, name_key FROM characters')
      .all() as { user_id: number; region: string; realm_slug: string; name_key: string }[]

    const byAccount = new Map<number, AccountTotals>()

    for (const row of rows) {
      let account = byAccount.get(row.user_id)
      if (!account) {
        account = readAccountTotals(row.user_id)
        byAccount.set(row.user_id, account)
      }

      totals.set(leaderboardKey(row.region, row.realm_slug, row.name_key), account)
    }
  } catch {
    // No database, or one with no roster yet: no account stands behind any row, which is the
    // stranger's answer the table already knows how to draw.
  }

  return totals
}

/**
 * The account's own totals for the character at an address, or `null` for a character that belongs to
 * none.
 *
 * This is the whole "guest or account" rule in one lookup: a stranger's character finds no roster row
 * and is answered with Blizzard's per-character numbers, while a character of an account that has ever
 * been read is answered with the account's own totals.
 *
 * The totals rather than the pool itself, and that is the point of the function. The pool counts unique
 * ids and is filled in the background one collection at a time, so an account can be known with its pool
 * half-filled or still empty; the totals are the best of that pool's own count and the readings of the
 * account's characters (`readAccountTotals`), which is the figure the profile page and the hall of fame's
 * own rows print. Every reader of an account reads this, so a page cannot be answered from one of the
 * account's numbers while the table is answered from another.
 */
/**
 * The account a character belongs to, or `null` for a character no account on the site holds.
 *
 * It is the site's own roster that answers it - the row a character was filed under when it was first read
 * for somebody who is signed in - so a stranger's lookup finds nobody, which is the rule every
 * account-wide view is gated on. The name is matched lowercased, the way the roster's own key stores it.
 */
export function accountOwnerId(region: string, realm: string, name: string): number | null {
  try {
    const row = useDb()
      .prepare('SELECT user_id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
      .get(region, String(realm).toLowerCase(), String(name).toLowerCase()) as { user_id: number } | undefined

    return row?.user_id ?? null
  } catch {
    return null
  }
}

function findOwnerTotals(region: string, realm: string, name: string): AccountTotals | null {
  const owner = accountOwnerId(region, realm, name)
  return owner === null ? null : readAccountTotals(owner)
}

/**
 * Writes the account's own figures into the main's row of the public table.
 *
 * The hall of fame draws one character per account - its main - and the numbers a collector compares
 * there should be the account's, not that one character's faction-limited collections. The identity,
 * the class and the level ride along from the stored row; the collections are the pool's, and the
 * table's own merge keeps whatever this pass does not carry.
 */
export function syncMainToLeaderboard(userId: number): void {
  const main = useDb()
    .prepare(
      `SELECT region, realm_slug, realm_name, name, display_name, class_id, level, faction
         FROM characters
        WHERE user_id = ?
        ORDER BY is_main DESC, COALESCE(level, 0) DESC, name ASC
        LIMIT 1`
    )
    .get(userId) as
    | {
        region: string
        realm_slug: string
        realm_name: string | null
        name: string
        display_name: string | null
        class_id: number | null
        level: number | null
        faction: string | null
      }
    | undefined

  if (!main) return

  const totals = readAccountTotals(userId)

  void upsertPlayer({
    region: main.region,
    realm: main.realm_slug,
    realmName: main.realm_name || undefined,
    name: main.name,
    displayName: main.display_name || undefined,
    classId: main.class_id ?? undefined,
    level: main.level ?? undefined,
    faction: main.faction || undefined,
    mounts: totals.mounts || undefined,
    pets: totals.pets || undefined,
    toys: totals.toys || undefined,
    decor: totals.decor || undefined,
    reputations: totals.reputations || undefined,
    achievements: totals.achievements || undefined
  })
}

/**
 * The figures a page prints for a character: the reading that was served, with the account's own figures
 * laid over it and the site's record of the character weighed against it.
 *
 * This is the one place the "guest or account" rule is applied to a live character, and the one place the
 * trading of a cached reading for the record happens (`bestFigures`, `readCharacterReading`). What it
 * returns is a **copy**: the profile handed to it is the one the endpoint read and cached, and it is also
 * the object every later reader of the same page start from - a page that wrote its own figures into it
 * would be writing them into the reading the site files next time, which is a loop rather than a view (the
 * item level and the rating of a record the site had already filed used to keep coming back as what
 * Blizzard had said).
 *
 * A character with no account behind them is handed back with the flag off and nothing else touched: their
 * figures are Blizzard's own, and a page reads the flag to say which numbers are whose.
 */
export function overlayPool(
  profile: CharacterData,
  region: string,
  realm: string,
  name: string,
  /** When the profile being overlaid was read from Blizzard, in seconds; now, for a reading just taken. */
  readAt: number = nowSec()
): CharacterData {
  const account = findOwnerTotals(region, realm, name)

  if (!account) {
    return { ...profile, score: calculatePlayerScore(scoreFigures(profile.stats)), pooled: false }
  }

  // The figures that really are one character's - the item level, the rating, the level - are taken from
  // the newer of the two readings the site can see: the one being served, and the site's own record of the
  // last reading it filed for this character (`server/utils/characterReading`). A profile is cached for two
  // hours on this endpoint (`./swrCache`), so a page can hold a reading older than the record - the
  // background pass has read the character since - and printing that one is exactly what left the item
  // level and the rating at the bottom of a character page behind the rest of the site.
  //
  // The record is preferred only when it was read at least as recently as this profile was. A page that
  // has just read Blizzard for itself is the newer of the two and keeps its own figures, which is also
  // what makes the Refresh button show what it just fetched. A record whose moment is not on file is not
  // weighed against one that has a moment - it is older than anything the site timed.
  const reading = readCharacterReading(region, realm, name)
  const recorded = reading && reading.readAt !== null && reading.readAt >= readAt

  const figures = bestFigures(
    {
      achievements: profile.ap,
      mounts: profile.stats.mounts.count,
      pets: profile.stats.pets.count,
      toys: profile.stats.toys.count,
      decor: profile.stats.decor.count,
      reputations: profile.stats.reputations.count
    },
    account
  )

  return {
    ...profile,
    ap: figures.achievements,
    ilvl: recorded && reading.ilvl !== null ? reading.ilvl : profile.ilvl,
    mPlusScore: recorded && reading.mplus !== null ? reading.mplus : profile.mPlusScore,
    level: recorded && reading.level !== null ? reading.level : profile.level,
    pooled: true,
    // The rating of the very figures below, computed here and nowhere else: a page prints this number
    // rather than working one out from the tiles, which is what kept the two from agreeing.
    score: calculatePlayerScore(figures),
    stats: {
      ...profile.stats,
      achievements: { ...profile.stats.achievements, count: figures.achievements },
      mounts: { ...profile.stats.mounts, count: figures.mounts },
      pets: { ...profile.stats.pets, count: figures.pets },
      toys: { ...profile.stats.toys, count: figures.toys },
      decor: { ...profile.stats.decor, count: figures.decor },
      reputations: { ...profile.stats.reputations, count: figures.reputations }
    }
  }
}
