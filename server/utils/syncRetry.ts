/**
 * How long a character that failed is left alone, and what the panel is told about it.
 *
 * The background pass reads the characters whose newest reading is missing or a day old. That made one thing
 * impossible to see and one thing impossible to escape: a character Blizzard will not answer for never gains a
 * reading, so it stays *due* for ever, and the pass selects its batch in a fixed order - so the same handful of
 * unreadable characters took the whole batch on every pass, and every character behind them was never read at
 * all. Measured on the reported incident: three passes, five characters each, fifteen failures, and a roster
 * that never moved.
 *
 * So a failure is remembered. A character that failed is *parked* for a while, and the pass skips it until that
 * moment passes; the characters behind it are finally read. The state is three columns on `characters`, which is
 * the smallest change that survives a restart - and a restart is exactly when an in-memory list would have sent
 * the same five hopeless reads at Blizzard again.
 *
 * The policy is deliberately not "give up": nothing here is permanent, because a character can come back (a
 * transfer, a rename reversed, a season's private profile made public) and because a *wrong* verdict must not
 * outlive the mistake. Every wait is a delay, never a tombstone, and the first successful read clears the state
 * entirely.
 */
import { nowSec } from './db'

/** Which kind of failure a character was parked for. Stored as itself, so the panel can say what it means. */
export type SyncFailureCode = 'missing' | 'rate-limited' | 'auth' | 'timeout' | 'upstream' | 'unreachable' | 'unknown'

/** What one failed read is worth recording, and how long it earns. */
export interface SyncFailureVerdict {
  code: SyncFailureCode
  /** The status this site answered with - its own, not Blizzard's, since that is what the read produced. */
  status: number
  /** How long to leave the character alone, in milliseconds. */
  retryDelayMs: number
}

/** The ceiling every backoff shares: a day is long enough to be a rest and short enough to be a retry. */
const MAX_RETRY_MS = 24 * 60 * 60 * 1000

/**
 * Classifies a failed read into the one code the panel prints and the delay it earns.
 *
 * The four kinds are genuinely different problems and are treated as such:
 *
 *   - **missing** - the site's own `404`, which `upstreamFailure` produces only for a `404` from Blizzard. A
 *     character that is not there is not going to be there in five minutes; it is left alone for a day, and for
 *     longer on each successive attempt, so a renamed or deleted character costs one request a day rather than a
 *     dozen every three minutes.
 *   - **rate-limited** - a `429`. Blizzard's own `Retry-After` is honoured when it sent one (it is the only body
 *     that knows how long), capped at the day so a hostile value cannot park a character for ever.
 *   - **auth** - the site's credentials were refused (`502` with `reason: 'auth'`, see `upstreamFailure`). This
 *     is the operator's problem, not the character's, and hammering Blizzard with a rejected token is the worst
 *     thing to do about it: the character waits, and the log says plainly what happened.
 *   - **temporary** - a timeout, an unreachable host, a `5xx` of Blizzard's. Doubling from five minutes, so a
 *     bad quarter of an hour costs a couple of retries and a bad afternoon costs a handful.
 */
export function classifySyncFailure(error: unknown, attempts: number): SyncFailureVerdict {
  const failure = error as {
    statusCode?: number
    data?: { retryAfter?: string | number; reason?: string }
  }

  const status = Number(failure?.statusCode || 0)
  const retryAfterSeconds = Number(failure?.data?.retryAfter || 0)

  if (status === 404) return { code: 'missing', status, retryDelayMs: missingDelay(attempts) }

  if (status === 429) {
    const asked = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 10 * 60 * 1000
    return { code: 'rate-limited', status, retryDelayMs: Math.min(Math.max(asked, 60_000), MAX_RETRY_MS) }
  }

  if (failure?.data?.reason === 'auth') return { code: 'auth', status, retryDelayMs: 30 * 60 * 1000 }

  if (status === 504) return { code: 'timeout', status, retryDelayMs: temporaryDelay(attempts) }
  if (status === 503 || status === 502) return { code: 'upstream', status, retryDelayMs: temporaryDelay(attempts) }

  return { code: 'unknown', status, retryDelayMs: temporaryDelay(attempts) }
}

/** A day, then two, then three - and never more than a week: a long rest, not a deletion. */
function missingDelay(attempts: number): number {
  const days = Math.min(Math.max(1, attempts), 7)
  return days * 24 * 60 * 60 * 1000
}

/** Five minutes, doubling, capped at a day. */
function temporaryDelay(attempts: number): number {
  const step = Math.max(1, attempts) - 1
  // The doubling is bounded at `2^9` (about two days before the cap below applies), so the arithmetic cannot
  // grow with the attempt count even if a row somehow reaches thousands of failures.
  return Math.min(5 * 60 * 1000 * 2 ** Math.min(step, 9), MAX_RETRY_MS)
}

/**
 * Remembers a failed read: one more attempt spent, and a moment before the next one is allowed.
 *
 * Answers what it wrote, so the caller can file one log entry that says what an operator needs - which character,
 * how many times, and when it will be tried again - without a second read of the row.
 */
export function parkCharacterSyncFailure(
  characterId: number,
  error: unknown
): { attempts: number; nextAttemptAt: number; code: SyncFailureCode; status: number; retryDelayMs: number } {
  const previous = Number(
    (
      useDb().prepare('SELECT sync_failures FROM characters WHERE id = ?').get(characterId) as
        | { sync_failures: number | null }
        | undefined
    )?.sync_failures || 0
  )

  const attempts = previous + 1
  const verdict = classifySyncFailure(error, attempts)
  const nextAttemptAt = nowSec() + Math.round(verdict.retryDelayMs / 1000)

  useDb()
    .prepare('UPDATE characters SET sync_failures = ?, sync_retry_at = ?, sync_error = ? WHERE id = ?')
    .run(attempts, nextAttemptAt, verdict.code, characterId)

  return { attempts, nextAttemptAt, code: verdict.code, status: verdict.status, retryDelayMs: verdict.retryDelayMs }
}

/**
 * Forgets a character's failures, which one successful read is worth.
 *
 * Guarded by `sync_failures > 0` so the ordinary case - a character that has never failed - costs a single
 * statement that matches no row, rather than a write on every read of the site.
 */
export function clearCharacterSyncFailure(characterId: number): void {
  useDb()
    .prepare(
      'UPDATE characters SET sync_failures = 0, sync_retry_at = NULL, sync_error = NULL WHERE id = ? AND sync_failures > 0'
    )
    .run(characterId)
}

