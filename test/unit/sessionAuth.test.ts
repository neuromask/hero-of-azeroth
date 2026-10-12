/**
 * What the site does when a Battle.net sign-in stops working, and how it tells a refusal from a bad day.
 *
 * The distinction is the whole of this file: a renewal the token endpoint *refuses* means the grant is dead
 * (a rotated client secret, a revoked account) and the reader has to sign in again - while a timeout, a DNS
 * hiccup or a 5xx says nothing about the grant at all. Getting it wrong in one direction leaves a reader
 * staring at a roster that stopped moving with nothing to explain it (the afternoon this comes from); getting
 * it wrong in the other signs people out over somebody else's outage.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import { isAuthRefused } from '../../server/utils/bnetOAuth'
import { ensureAccessToken, markAuthExpired } from '../../server/utils/session'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** The mark as it stands in the database, which is where a page reads it. */
function markOf(userId: number): number {
  const row = memory.db.prepare('SELECT auth_expired FROM users WHERE id = ?').get(userId) as
    | { auth_expired: number }
    | undefined
  return row?.auth_expired ?? -1
}

describe('a refused renewal', () => {
  it('is the token endpoint answering an OAuth error', () => {
    expect(isAuthRefused({ response: { status: 400 }, data: { error: 'invalid_grant' } })).toBe(true)
    expect(isAuthRefused({ statusCode: 400, data: { error: 'invalid_request' } })).toBe(true)
  })

  it('is a 401 or a 403 whatever the body says', () => {
    expect(isAuthRefused({ statusCode: 401 })).toBe(true)
    expect(isAuthRefused({ response: { status: 403 } })).toBe(true)
  })

  it('is not a bad moment', () => {
    expect(isAuthRefused({ response: { status: 500 } })).toBe(false)
    expect(isAuthRefused({ statusCode: 429 })).toBe(false)
    expect(isAuthRefused(new Error('fetch failed'))).toBe(false)
    expect(isAuthRefused(undefined)).toBe(false)
    expect(isAuthRefused(null)).toBe(false)
  })
})

describe('the mark a refusal leaves on the account', () => {
  it('is written and can be cleared again', () => {
    memory.addUser(1, false)
    expect(markOf(1)).toBe(0)

    markAuthExpired(1)
    expect(markOf(1)).toBe(1)

    markAuthExpired(1, false)
    expect(markOf(1)).toBe(0)
  })

  it('is honoured instead of the stored token, which is what a page reads it for', async () => {
    const marked = {
      id: 7,
      bnetSub: 'sub',
      battletag: null,
      mainCharacterId: null,
      hideFromFame: false,
      authExpired: true,
      accessToken: 'still-in-the-row',
      refreshToken: null,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }

    // The account is not asked for a token at all: nothing about it can have changed but a new sign-in.
    expect(await ensureAccessToken(marked, 'eu')).toBeNull()
  })

  it('leaves an account that is still good alone', async () => {
    const live = {
      id: 8,
      bnetSub: 'sub',
      battletag: null,
      mainCharacterId: null,
      hideFromFame: false,
      authExpired: false,
      accessToken: 'still-in-the-row',
      refreshToken: null,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    }

    expect(await ensureAccessToken(live, 'eu')).toBe('still-in-the-row')
  })
})
