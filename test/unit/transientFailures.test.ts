/**
 * A transient upstream failure is remembered for a moment; a refused credential is not.
 *
 * Measured before this existed, against a mock Blizzard answering 503: every server-rendered front page asked for the
 * site's token sixteen times and waited ~650 ms for the refusal, and with an upstream that never answered, thirty
 * seconds - page after page. These tests pin the rule that replaced it, and the rules it must not break: one token
 * request at a time, a failure that clears itself on the next success, nothing remembered for ever, a refused
 * credential reported every time, and a failure never turned into an empty list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

let calls: string[] = []
let tokenAnswer: 'ok' | 'down' | 'refused' | 'hold' = 'ok'
let realmAnswer: 'ok' | 'down' | 'missing' = 'ok'
let release: () => void = () => {}

function refused(status: number) {
  return Object.assign(new Error(`[POST] "<url>": ${status}`), { name: 'FetchError', statusCode: status, status, response: { status } })
}

function token(): Promise<unknown> {
  if (tokenAnswer === 'down') return Promise.reject(refused(503))
  if (tokenAnswer === 'refused') return Promise.reject(refused(401))
  if (tokenAnswer === 'hold') {
    return new Promise((resolve) => {
      release = () => resolve({ access_token: 'isolated-token', expires_in: 86400 })
    })
  }
  return Promise.resolve({ access_token: 'isolated-token', expires_in: 86400 })
}

function realms(): Promise<unknown> {
  if (realmAnswer === 'down') return Promise.reject(refused(503))
  if (realmAnswer === 'missing') return Promise.reject(refused(404))
  return Promise.resolve({ realms: [{ slug: 'gordunni', name: 'Gordunni' }] })
}

beforeEach(() => {
  calls = []
  tokenAnswer = 'ok'
  realmAnswer = 'ok'
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T10:00:00Z'))
  vi.resetModules()
  installUseDb(createMemoryDb().db)
  const g = globalThis as Record<string, unknown>
  g.useRuntimeConfig = () => ({ blizzardClientId: 'isolated-client', blizzardClientSecret: 'isolated-secret' })
  g.createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
  g.$fetch = (url: string) => {
    const kind = url.includes('/oauth/token') ? 'token' : 'realms'
    calls.push(kind)
    return kind === 'token' ? token() : realms()
  }
})

afterEach(() => {
  vi.useRealTimers()
})

const load = () => import('../../server/utils/blizzard')
const count = (kind: string) => calls.filter((call) => call === kind).length

describe('the site token', () => {
  it('is asked for once however many readers arrive together', async () => {
    const { getBlizzardToken } = await load()
    tokenAnswer = 'hold'

    const readers = Promise.all([getBlizzardToken('eu'), getBlizzardToken('eu'), getBlizzardToken('eu')])
    await vi.advanceTimersByTimeAsync(0)
    release()

    expect(await readers).toEqual(['isolated-token', 'isolated-token', 'isolated-token'])
    expect(count('token')).toBe(1)
  })

  it('remembers an outage for the window, then asks again - and a success forgets it', async () => {
    const { getBlizzardToken, TRANSIENT_FAILURE_MS } = await load()
    tokenAnswer = 'down'

    await expect(getBlizzardToken('eu')).rejects.toMatchObject({ statusCode: 503 })
    // Inside the window the same error is the answer, and nothing is sent.
    await expect(getBlizzardToken('eu')).rejects.toMatchObject({ statusCode: 503 })
    expect(count('token')).toBe(1)

    // The window is over: it is asked again, and this time it works.
    vi.advanceTimersByTime(TRANSIENT_FAILURE_MS + 1)
    tokenAnswer = 'ok'
    expect(await getBlizzardToken('eu')).toBe('isolated-token')
    expect(count('token')).toBe(2)
  })

  it('never remembers a refused credential: every request reports it', async () => {
    const { getBlizzardToken } = await load()
    tokenAnswer = 'refused'

    await expect(getBlizzardToken('eu')).rejects.toMatchObject({ statusCode: 502, data: { reason: 'auth' } })
    await expect(getBlizzardToken('eu')).rejects.toMatchObject({ statusCode: 502, data: { reason: 'auth' } })
    expect(count('token')).toBe(2)
  })
})

describe('the realm list', () => {
  it('shares one read between readers that arrive together', async () => {
    const { getRealms } = await load()

    const lists = await Promise.all([getRealms('eu', 'en_US'), getRealms('eu', 'en_US')])

    expect(lists[0]).toEqual([{ slug: 'gordunni', name: 'Gordunni' }])
    expect(count('realms')).toBe(1)
  })

  it('remembers an outage as the error it was - never as an empty list - and heals after the window', async () => {
    const { getRealms, TRANSIENT_FAILURE_MS } = await load()
    realmAnswer = 'down'

    await expect(getRealms('eu', 'en_US')).rejects.toMatchObject({ statusCode: 503 })
    await expect(getRealms('eu', 'en_US')).rejects.toMatchObject({ statusCode: 503 })
    expect(count('realms')).toBe(1)

    vi.advanceTimersByTime(TRANSIENT_FAILURE_MS + 1)
    realmAnswer = 'ok'
    expect(await getRealms('eu', 'en_US')).toEqual([{ slug: 'gordunni', name: 'Gordunni' }])
    expect(count('realms')).toBe(2)
  })

  it('does not remember an answer about the request itself', async () => {
    const { getRealms } = await load()
    realmAnswer = 'missing'

    await expect(getRealms('eu', 'en_US')).rejects.toMatchObject({ statusCode: 404 })
    await expect(getRealms('eu', 'en_US')).rejects.toMatchObject({ statusCode: 404 })
    expect(count('realms')).toBe(2)
  })
})

describe('which failures are transient', () => {
  it('is a 5xx, a timeout, a dead connection and a 429 (by its Retry-After, within a ceiling) - nothing else', async () => {
    const { transientFailureMs, TRANSIENT_FAILURE_MS } = await load()
    const dead = Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') })

    expect(transientFailureMs({ statusCode: 503 })).toBe(TRANSIENT_FAILURE_MS)
    expect(transientFailureMs({ name: 'TimeoutError' })).toBe(TRANSIENT_FAILURE_MS)
    expect(transientFailureMs(dead)).toBe(TRANSIENT_FAILURE_MS)
    expect(transientFailureMs({ statusCode: 429, data: { retryAfter: '90' } })).toBe(90_000)
    expect(transientFailureMs({ statusCode: 429, data: { retryAfter: '999999' } })).toBe(5 * 60_000)

    expect(transientFailureMs({ statusCode: 401 })).toBe(0)
    expect(transientFailureMs({ statusCode: 502, data: { reason: 'auth' } })).toBe(0)
    expect(transientFailureMs({ statusCode: 404 })).toBe(0)
    expect(transientFailureMs(new Error('a bug'))).toBe(0)
  })
})
