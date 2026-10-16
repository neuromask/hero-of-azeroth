/**
 * How long a character that failed is left alone, and what that state is worth.
 *
 * The rule this file exists for is the one the reported incident broke: a character Blizzard will not answer for
 * must stop taking a slot in every pass. Two things are pinned here - the *policy* (which kind of failure earns
 * which wait, and that none of them is a tombstone) and the *state* (a failure is remembered on the row, one
 * success forgets it).
 *
 * Everything runs against the throwaway database (`test/helpers/memoryDb.ts`), whose `characters` table carries
 * the retry columns for exactly this reason.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import { classifySyncFailure, clearCharacterSyncFailure, parkCharacterSyncFailure } from '../../server/utils/syncRetry'

let memory: MemoryDb

/** A character row to park, and the columns the state is read back from. */
function failureRow(id: number): { sync_failures: number; sync_retry_at: number | null; sync_error: string | null } {
  return memory.db.prepare('SELECT sync_failures, sync_retry_at, sync_error FROM characters WHERE id = ?').get(id) as {
    sync_failures: number
    sync_retry_at: number | null
    sync_error: string | null
  }
}

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

describe('the failure a character was parked for', () => {
  it('is read from the status this site answered with, and never guessed from a message', () => {
    expect(classifySyncFailure({ statusCode: 404 }, 1).code).toBe('missing')
    expect(classifySyncFailure({ statusCode: 429 }, 1).code).toBe('rate-limited')
    expect(classifySyncFailure({ statusCode: 504 }, 1).code).toBe('timeout')
    expect(classifySyncFailure({ statusCode: 503 }, 1).code).toBe('upstream')
    expect(classifySyncFailure({ statusCode: 502 }, 1).code).toBe('upstream')
    expect(classifySyncFailure(new Error('fetch failed'), 1).code).toBe('unknown')
  })

  it('is `auth` when the site’s own credentials were refused, which is nobody’s character', () => {
    // `upstreamFailure` maps a 401/403 to a 502 and carries only the reason (`server/utils/blizzard`).
    expect(classifySyncFailure({ statusCode: 502, data: { reason: 'auth' } }, 1)).toMatchObject({
      code: 'auth',
      status: 502
    })
  })
})

describe('the wait a failure earns', () => {
  it('is a day for a character Blizzard does not have, and longer on each attempt - up to a week', () => {
    const day = 24 * 60 * 60 * 1000

    expect(classifySyncFailure({ statusCode: 404 }, 1).retryDelayMs).toBe(day)
    expect(classifySyncFailure({ statusCode: 404 }, 2).retryDelayMs).toBe(2 * day)
    expect(classifySyncFailure({ statusCode: 404 }, 30).retryDelayMs).toBe(7 * day)
  })

  it('honours Blizzard’s own Retry-After for a rate limit, and never parks for ever', () => {
    expect(classifySyncFailure({ statusCode: 429, data: { retryAfter: '90' } }, 1).retryDelayMs).toBe(90_000)
    // No header: ten minutes, which is what the site has to assume.
    expect(classifySyncFailure({ statusCode: 429 }, 1).retryDelayMs).toBe(10 * 60 * 1000)
    // A hostile value is capped at the shared ceiling rather than trusted.
    expect(classifySyncFailure({ statusCode: 429, data: { retryAfter: '99999999' } }, 1).retryDelayMs).toBe(
      24 * 60 * 60 * 1000
    )
  })

  it('doubles for a bad moment, from five minutes', () => {
    expect(classifySyncFailure({ statusCode: 503 }, 1).retryDelayMs).toBe(5 * 60 * 1000)
    expect(classifySyncFailure({ statusCode: 503 }, 2).retryDelayMs).toBe(10 * 60 * 1000)
    expect(classifySyncFailure({ statusCode: 503 }, 3).retryDelayMs).toBe(20 * 60 * 1000)
    expect(classifySyncFailure({ statusCode: 503 }, 99).retryDelayMs).toBe(24 * 60 * 60 * 1000)
  })

  it('waits half an hour for a rejected credential, so a site-wide problem is not hammered', () => {
    expect(classifySyncFailure({ statusCode: 502, data: { reason: 'auth' } }, 1).retryDelayMs).toBe(30 * 60 * 1000)
  })
})

describe('the state a failure leaves on the row', () => {
  it('counts the attempts and remembers when the next one is allowed', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Missing' })
    const now = Math.floor(Date.now() / 1000)

    const first = parkCharacterSyncFailure(id, { statusCode: 404 })

    expect(first).toMatchObject({ attempts: 1, code: 'missing', status: 404 })
    expect(first.nextAttemptAt).toBeGreaterThanOrEqual(now + 24 * 60 * 60 - 5)
    expect(failureRow(id)).toMatchObject({ sync_failures: 1, sync_error: 'missing' })

    const second = parkCharacterSyncFailure(id, { statusCode: 404 })
    expect(second.attempts).toBe(2)
    expect(failureRow(id)).toMatchObject({ sync_failures: 2, sync_error: 'missing' })
  })

  it('is forgotten by one successful read, which is the whole of "it works again"', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Back' })
    parkCharacterSyncFailure(id, { statusCode: 503 })
    expect(failureRow(id).sync_failures).toBe(1)

    clearCharacterSyncFailure(id)

    expect(failureRow(id)).toEqual({ sync_failures: 0, sync_retry_at: null, sync_error: null })
  })

  it('is not a tombstone: a parked character is *tried again* once the wait is over', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Transferred' })
    const verdict = parkCharacterSyncFailure(id, { statusCode: 404 })

    // The row is still there, with its readings; only the moment it may be looked at again moved.
    const parked = failureRow(id)
    expect(parked.sync_retry_at).toBe(verdict.nextAttemptAt)
    expect(memory.db.prepare('SELECT COUNT(*) AS count FROM characters WHERE id = ?').get(id)).toEqual({ count: 1 })
  })
})
