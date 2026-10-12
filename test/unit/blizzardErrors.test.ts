/**
 * What a failed call to Blizzard is answered with.
 *
 * Every failure of the profile summary used to be answered with the 404 that means "there is no such
 * character", so an outage, a rate limit and a connection that died all looked like a misspelt name - to a
 * reader, to a crawler, and to the site itself. These tests pin the statuses that replaced it: 404 only for a
 * character Blizzard does not have, 429 for its rate limit, 503 for its own 5xx, 504 for a call that ran past
 * the deadline, 502 for a connection that never answered - and nothing of the failure itself travelling on
 * with them, no upstream URL and no upstream body.
 *
 * The module reads the network through the `$fetch` Nuxt hands it, so each test installs its own - one that
 * refuses the way ofetch refuses, which is what the classification is written against.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

/** How the stub refuses the summary: an HTTP status, a deadline, or a connection that never answered. */
let refusal: { status: number; retryAfter?: string; timeout?: boolean; dead?: boolean } | null = null

/** What ofetch throws for an HTTP refusal: a `FetchError` carrying the status, the response and the URL. */
function refused(status: number, retryAfter?: string) {
  return Object.assign(
    new Error(`[GET] "https://eu.api.blizzard.com/profile/wow/character/gordunni/refused": ${status} (an upstream body)`),
    {
      name: 'FetchError',
      statusCode: status,
      status,
      response: {
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) }
      }
    }
  )
}

const timedOut = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
const dead = () => new TypeError('fetch failed')

function summary() {
  return {
    name: 'Refused',
    level: 90,
    achievement_points: 11000,
    average_item_level: 317,
    character_class: { id: 8, name: 'Mage' },
    race: { id: 7, name: 'Night Elf' },
    gender: { type: 'FEMALE' },
    active_spec: { name: 'Frost' },
    guild: { name: 'Guild' },
    faction: { type: 'HORDE' },
    realm: { name: 'Gordunni' }
  }
}

/** A minimal Blizzard: the summary, and an empty document for everything else, which the read tolerates. */
function answerFor(url: string): unknown {
  if (url.includes('/oauth/token')) return { access_token: 'isolated-token', expires_in: 86400 }

  const path = decodeURIComponent(new URL(url).pathname)
  if (/^\/profile\/wow\/character\/[^/]+\/[^/]+$/.test(path)) return summary()

  return {}
}

beforeEach(() => {
  refusal = null
  // The clock belongs to the test: the cooldown a forced read spends is fifteen seconds of it.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))
  installUseDb(createMemoryDb().db)
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    blizzardClientId: 'isolated-client',
    blizzardClientSecret: 'isolated-secret'
  })
  ;(globalThis as Record<string, unknown>).createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)

  ;(globalThis as Record<string, unknown>).$fetch = async (url: string) => {
    const isSummary = /\/profile\/wow\/character\/[^/]+\/[^/?]+\?namespace/.test(url)

    if (refusal && isSummary) {
      if (refusal.dead) throw dead()
      if (refusal.timeout) throw timedOut()
      throw refused(refusal.status, refusal.retryAfter)
    }

    return answerFor(url)
  }
})

afterEach(() => {
  vi.useRealTimers()
})

/** A fresh copy of the module under test, so each test starts with empty caches. */
async function load() {
  vi.resetModules()
  return await import('../../server/utils/blizzard')
}

/** Reads a character and reports the status the failure was answered with, or 200 when it was answered. */
async function readStatus(character: string, force = false): Promise<number> {
  const { getCharacter } = await load()
  try {
    await getCharacter('gordunni', character, 'eu', 'en_US', force)
    return 200
  } catch (err) {
    return Number((err as { statusCode?: number }).statusCode || 0)
  }
}
describe('the status a failed Blizzard call is answered with', () => {
  it('is 404 when Blizzard really does not have the character', async () => {
    refusal = { status: 404 }
    expect(await readStatus('missing')).toBe(404)
  })

  it('is 429 when Blizzard is rate-limiting the site, and passes its Retry-After on', async () => {
    const { getCharacter } = await load()
    refusal = { status: 429, retryAfter: '42' }

    await expect(getCharacter('gordunni', 'limited', 'eu', 'en_US')).rejects.toMatchObject({
      statusCode: 429,
      data: { retryAfter: '42' }
    })
  })

  it('is 503 when Blizzard answers with an error of its own', async () => {
    refusal = { status: 503 }
    expect(await readStatus('down')).toBe(503)

    refusal = { status: 500 }
    expect(await readStatus('broken')).toBe(503)
  })

  it('is 504 when the call ran past the deadline', async () => {
    refusal = { status: 0, timeout: true }
    expect(await readStatus('slow')).toBe(504)
  })

  it('is 502 when the connection never got an answer at all', async () => {
    refusal = { status: 0, dead: true }
    expect(await readStatus('unreachable')).toBe(502)
  })

  it('is never 404 for any of those, so an outage is not answered as a missing character', async () => {
    for (const failure of [{ status: 429 }, { status: 503 }, { status: 0, timeout: true }, { status: 0, dead: true }]) {
      refusal = failure
      const status = await readStatus(`outage${failure.status}${failure.timeout ? 't' : ''}${failure.dead ? 'd' : ''}`)
      expect(status).not.toBe(404)
    }
  })

  it('carries nothing of the failure itself: no upstream URL, no body, no exception text', async () => {
    const { getCharacter } = await load()
    refusal = { status: 503 }

    const failure = await getCharacter('gordunni', 'quiet', 'eu', 'en_US').catch((err) => err)
    const shown = `${failure.message} ${failure.statusMessage ?? ''}`

    expect(shown).not.toContain('api.blizzard.com')
    expect(shown).not.toContain('upstream body')
    expect(shown).not.toContain('FetchError')
  })
})

describe('after a failed read', () => {
  it('the last good reading stands, and a later read recovers', async () => {
    const { getCharacter } = await load()

    const first = await getCharacter('gordunni', 'recovering', 'eu', 'en_US')
    expect(first.stats.mounts.count).toBe(0)

    // The API goes down; the forced read fails with the status that says so.
    refusal = { status: 503 }
    vi.advanceTimersByTime(20_000)
    await expect(getCharacter('gordunni', 'recovering', 'eu', 'en_US', true)).rejects.toMatchObject({ statusCode: 503 })

    // The reading on file is untouched, so the plain request is still answered from it.
    refusal = null
    const still = await getCharacter('gordunni', 'recovering', 'eu', 'en_US')
    expect(still.stats.mounts.count).toBe(0)

    // And the failure left nothing behind that would hide the next successful read.
    vi.advanceTimersByTime(20_000)
    const recovered = await getCharacter('gordunni', 'recovering', 'eu', 'en_US', true)
    expect(recovered.name).toBe('Refused')
  })
})
