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
import { ACCOUNT_COLLECTION_KINDS } from './bnetOAuth'
import type { BlizzardRegion } from './params'
import type { CharacterData } from './blizzard'
// The overall rating, off the same formula the hall of fame ranks by - so the pool's own figure and
// the table's column are one number.
import { calculatePlayerScore } from '#shared/utils/leaderboardScore'

/** The kinds the pool counts, one per figure a tile prints. */
export const POOL_KINDS = ['mounts', 'pets', 'toys', 'decor', 'reputations'] as const

export type PoolKind = (typeof POOL_KINDS)[number]

/** The account's own numbers, each one a count of unique ids. */
export type AccountPool = Record<PoolKind, number>

/** A pool that is empty is a pool this account has not filled yet, which reads as "not signed in". */
export function poolIsEmpty(pool: AccountPool): boolean {
  return POOL_KINDS.every((kind) => !pool[kind])
}

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
export interface AccountTotals {
  ilvl: number | null
  mplus: number | null
  achievements: number
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
  /** The overall rating the hall of fame ranks by, read off the account's own collections. */
  score: number
  /** The kinds the pool answered, which is what marks a figure as the account's own. */
  accountWide: PoolKind[]
}

/** How many unique ids of each kind the account holds. */
export function readAccountPool(userId: number): AccountPool {
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
 * The account's totals: the pool where it answered, the best character otherwise.
 *
 * Nothing here adds two characters together. A collection is account-wide, so the pool's unique
 * count is the account's own number; where the pool is still empty (an account that has not
 * finished its first sync) the best character's reading stands in - `MAX`, never `SUM`.
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

  /** The pool's own number, or the best character's reading while the pool has none. */
  const pick = (kind: PoolKind, fallback: number | null): number => pool[kind] || fallback || 0

  return {
    ilvl: maxes.ilvl ?? null,
    mplus: maxes.mplus ?? null,
    achievements: maxes.achievements || 0,
    mounts: pick('mounts', maxes.mounts),
    pets: pick('pets', maxes.pets),
    toys: pick('toys', maxes.toys),
    decor: pick('decor', maxes.decor),
    reputations: pick('reputations', maxes.reputations),
    // The overall rating, off the very collections above - the same formula the table's own column is
    // computed with, so the pool never carries a score the leaderboard would not agree with.
    score: calculatePlayerScore({
      achievements: maxes.achievements || 0,
      mounts: pick('mounts', maxes.mounts),
      toys: pick('toys', maxes.toys),
      decor: pick('decor', maxes.decor),
      pets: pick('pets', maxes.pets)
    }),
    accountWide
  }
}

/**
 * The pool of the account a character belongs to, or `null` for a character that belongs to none.
 *
 * This is the whole "guest or account" rule in one function: a stranger's lookup finds no roster row
 * and is answered with Blizzard's per-character numbers, while a character of an account that has
 * synced is answered with the account's own pool.
 */
export function findOwnerPool(region: string, realm: string, name: string): AccountPool | null {
  try {
    const row = useDb()
      .prepare('SELECT user_id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
      .get(region, String(realm).toLowerCase(), String(name).toLowerCase()) as { user_id: number } | undefined

    if (!row) return null

    const pool = readAccountPool(row.user_id)
    return poolIsEmpty(pool) ? null : pool
  } catch {
    return null
  }
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
    achievements: totals.achievements || undefined
  })
}

/**
 * Lays the account's own pool over a character's reading, in place.
 *
 * This is the one place the "guest or account" rule is applied to a live character: the profile the
 * site just read is a character's, but the collections it carries are the account's, so a character
 * whose account has synced is answered with the pool instead. The item level, the rating and the
 * level are left alone - those really are the character's own.
 *
 * Returns whether a pool was applied, which is what a caller can tell a log from.
 */
export function overlayPool(profile: CharacterData, region: string, realm: string, name: string): boolean {
  const pool = findOwnerPool(region, realm, name)

  if (!pool) {
    // No account behind this character: the figures stay Blizzard's own, and the flag says so - a
    // page reads it to tell the reader which numbers are theirs and which are the character's.
    profile.pooled = false
    return false
  }

  if (pool.mounts) profile.stats.mounts.count = pool.mounts
  if (pool.pets) profile.stats.pets.count = pool.pets
  if (pool.toys) profile.stats.toys.count = pool.toys
  if (pool.decor) profile.stats.decor.count = pool.decor
  if (pool.reputations) profile.stats.reputations.count = pool.reputations

  profile.pooled = true
  return true
}
