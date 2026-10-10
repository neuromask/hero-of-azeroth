/**
 * The characters the public leaderboard must not show.
 *
 * One rule of the site's accounts: a leaderboard row belongs to one character per player, the one
 * that account named as its main. Every other character of a signed-in account is a personal
 * stat - it belongs on the profile, beside its siblings, not in the table of everybody - so this
 * module answers the keys the table has to leave out.
 *
 * And one choice of the reader's own, which is the only way out of the table there is: an account
 * that asked not to be published (`users.hide_from_fame`) is left out entirely, its main included -
 * the main being the only character of an account the table would ever have shown. The two are one
 * query because they are one answer: who the table must not draw.
 *
 * It reads only the tables an account owns, and it is deliberately the *only* place the
 * leaderboard reaches into SQLite: the table's own storage (`./leaderboardStorage`) is otherwise a
 * JSON file, and keeping the dependency this small is what lets that storage be swapped later
 * without touching this rule.
 *
 * A process that cannot read the database - a checkout that never opened it - simply offers no
 * exclusions, which is the conservative answer: the table shows what it always showed.
 */

/** How long a set of exclusions is reused, so a burst of page reads is one query. */
const CACHE_MS = 60 * 1000

let cached: { keys: Set<string>; at: number } | null = null

/**
 * How many times the set has been dropped outright.
 *
 * The leaderboard's answer is cached for an hour (`server/api/leaderboard`), and what the set holds
 * is part of that answer - a character that stops being the main drops out of the table. Counting
 * the drops is what lets the endpoint notice, without it having to know a thing about a roster.
 */
let revision = 0

/** The identity the leaderboard keys a record on: its three address segments, lowercased. */
export function leaderboardKey(region: string, realm: string, name: string): string {
  return `${region}:${realm}:${name}`.toLowerCase()
}

/**
 * The keys of the characters the table must not draw.
 *
 * Everybody of a roster but the one character that account leads with, and every character of an
 * account that asked to be left out of the table altogether - the main included, since the main is
 * the only one the table would have shown.
 *
 * Cached for a minute: setting a main is a rare act, and every leaderboard read asking SQLite would
 * be a query paid for a fact that almost never moves. Both writes that can move it - naming a main
 * (`server/api/profile/main.post.ts`) and leaving the table (`server/api/profile/fame.post.ts`) -
 * clear the cache outright, so the change is visible on the very next read rather than a minute
 * later.
 */
export function excludedLeaderboardKeys(): Set<string> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.keys

  const keys = new Set<string>()

  try {
    const rows = useDb()
      .prepare(
        `SELECT c.region, c.realm_slug, c.name_key
           FROM characters c
           JOIN users u ON u.id = c.user_id
          WHERE c.is_main = 0 OR u.hide_from_fame = 1`
      )
      .all() as { region: string; realm_slug: string; name_key: string }[]

    for (const row of rows) keys.add(leaderboardKey(row.region, row.realm_slug, row.name_key))
  } catch {
    // No database yet, or one that cannot be read: no exclusions rather than a broken table.
  }

  cached = { keys, at: now }
  return keys
}

/** Drops the memoised set, so a main that just changed is honoured at once. */
export function clearLeaderboardExclusions(): void {
  cached = null
  revision += 1
}

/** How many times the set has been dropped, which is what a stamp of the table's own view reads. */
export function exclusionsRevision(): number {
  return revision
}
