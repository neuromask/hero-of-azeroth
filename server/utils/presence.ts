/**
 * Who is on the site right now.
 *
 * The hall of fame marks the row of a player whose account is here - the green dot on the portrait
 * (`app/components/leaderboard/LeaderboardTable.vue`) - and this module is the whole of what that mark is
 * read from. A signed-in browser beats once a minute while its tab is visible
 * (`POST /api/user/heartbeat`, sent by `app/composables/presence.ts`), a beat stamps `users.last_seen_at`,
 * and an account whose stamp is newer than `PRESENCE_WINDOW_SECONDS` is on the site.
 *
 * The window is deliberately wider than the beat - five minutes against one - so a reader waiting out a
 * slow request, a laptop that slept through a beat and a tab the browser throttled all keep their dot,
 * while an account whose tab was closed loses it within five minutes. The dot is a courtesy, not a claim
 * about where somebody is sitting.
 *
 * What it answers is the rows of the table: the one character per account the hall of fame draws. That identity
 * is the table's own - the account's main, or the strongest character it has until one is named
 * (`./leaderboardRows`) - so the dot is read from the very rows a reader is looking at rather than worked out
 * again here. Reading `characters.is_main` instead, as this once did, marked nobody for an account that had
 * never named a main: its row is in the table all the same, and the dot on it never lit.
 *
 * The read is memoised for half a minute: every reader of the page
 * asks for presence, and a query per reader for a fact that moves once a minute is a query nobody needs to
 * pay. The memo is short enough that the dot a reader sees was stamped, at worst, half a minute ago.
 *
 * It is a small, self-contained reach into SQLite: a process that cannot read the
 * database marks nobody, which is the quiet answer rather than a broken page. A table that has not been built
 * yet - the first moments of a process, before the startup pass has written it - is the same quiet answer, and
 * it heals the moment the table exists.
 */
import { leaderboardKey } from './leaderboardExclusions'
// The clock the heartbeat's stamp is written with, imported rather than taken from the auto-imported global:
// every other module here reads it this way, and a bare name that is missing fails silently inside the `try`
// below - which is exactly how a presence read comes to mark nobody without saying so.
import { nowSec } from './db'

/** How long an account is read as being on the site after its last beat. */
export const PRESENCE_WINDOW_SECONDS = 5 * 60

/** How long a set of online keys is reused, so a burst of page reads is one query. */
const CACHE_MS = 30 * 1000

let cached: { keys: Set<string>; at: number } | null = null

/**
 * Forgets the memo, which is what a test that swaps the database under these modules needs
 * (`test/helpers/memoryDb.ts`): the set is keyed on the clock rather than on a revision, so nothing else would
 * make it stale.
 */
export function clearPresenceCache(): void {
  cached = null
}

/**
 * Stamps an account as having been seen now, which is the whole of what a heartbeat writes.
 *
 * Written on every beat rather than only when the stamp is old: the beat is one indexed `UPDATE` of one
 * row a minute per open tab, which is cheaper than the read that would decide whether to write. A failure
 * is swallowed on purpose - presence is a courtesy, and a beat that cannot be written costs a dot rather
 * than a reader's sign-in.
 */
export function touchPresence(userId: number): void {
  try {
    useDb().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowSec(), userId)
  } catch {
    // No database yet, or one that cannot be written: nobody is marked for this beat.
  }
}

/**
 * The keys of the mains whose account has been on the site inside the window.
 *
 * Cached for half a minute, so the page's readers share one query: what moves here is one stamp a minute
 * per open tab, and a set read half a minute ago is a set that is at most half a minute behind - a
 * difference no dot can show.
 */
export function onlineLeaderboardKeys(): Set<string> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.keys

  const keys = new Set<string>()

  try {
    // The rows the table draws, and the account behind each of them: a main and each of its alts are one
    // account, so the address a reader is looking at is the one the row carries (`./leaderboardRows`).
    const rows = useDb()
      .prepare(
        `SELECT l.region, l.realm_slug, l.name_key
           FROM leaderboard l
           JOIN users u ON u.id = l.user_id
          WHERE l.is_account = 1 AND u.last_seen_at IS NOT NULL AND u.last_seen_at >= ?`
      )
      .all(nowSec() - PRESENCE_WINDOW_SECONDS) as { region: string; realm_slug: string; name_key: string }[]

    for (const row of rows) keys.add(leaderboardKey(row.region, row.realm_slug, row.name_key))
  } catch {
    // No database yet, or one that cannot be read: nobody is marked.
  }

  cached = { keys, at: now }
  return keys
}
