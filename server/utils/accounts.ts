/**
 * The leaderboard rows that belong to an account on the site.
 *
 * The hall of fame is filled from two places, and a reader has no way of telling them apart by looking at a
 * row. A row backfilled from the sitemap's index is what one lookup happened to see - a character somebody
 * opened once, whose figures were read at that moment. A row that belongs to an account which signed in is
 * *the account's own*: it is that account's main, the background sync re-reads it, and its figures are
 * merged with the account's own pool of everything the roster has gathered
 * (`server/utils/accountPool`). The table marks those rows, so a reader can tell the site's reading of a
 * whole account from one glimpse of one character.
 *
 * It is deliberately the *account* that is asked about rather than the pool: an account exists from the
 * moment it signs in, while a pool is only filled as its characters are read, and a row should not lose its
 * mark because a fresh account has not been read yet. The two are read through the same join
 * `./presence` uses - one character per account, `is_main` - so what counts as a player's own row is one
 * answer everywhere on the site.
 *
 * The answer is memoised for a minute, like the exclusions beside it: it moves when somebody signs in or
 * names another main, which is a handful of times a day, and every read of the table asks for it. A process
 * that cannot read the database marks nobody, which is the quiet answer rather than a marked-up table.
 */
import { leaderboardKey } from './leaderboardExclusions'

/** How long the set is reused, so a burst of page reads is one query. */
const CACHE_MS = 60 * 1000

let cached: { keys: Set<string>; at: number } | null = null

/** The keys of the mains whose account signed in to the site, as the table keys a row. */
export function accountLeaderboardKeys(): Set<string> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.keys

  const keys = new Set<string>()

  try {
    const rows = useDb()
      .prepare(
        `SELECT c.region, c.realm_slug, c.name_key
           FROM characters c
           JOIN users u ON u.id = c.user_id
          WHERE c.is_main = 1`
      )
      .all() as { region: string; realm_slug: string; name_key: string }[]

    for (const row of rows) keys.add(leaderboardKey(row.region, row.realm_slug, row.name_key))
  } catch {
    // No database yet, or one that cannot be read: no row is marked.
  }

  cached = { keys, at: now }
  return keys
}

/** Drops the memoised set, for a caller that has just changed who belongs to an account. */
export function clearAccountKeys(): void {
  cached = null
}
