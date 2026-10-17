/**
 * The activity feed's Blizzard reads go through the one wrapper.
 *
 * `getAchievementFeed` used to read the character's achievement list with a bare `$fetch`: no deadline (a Blizzard
 * that never answered held the feed open indefinitely) and no counter (the panel's total was short by every feed).
 * These tests pin the three outcomes - an answer, a refusal, a call that runs past the deadline - and that each of
 * them is counted, under the source the route tagged it with, without any real request leaving the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

/** Every request the module made, with the options it asked for. */
let asked: { url: string; options: Record<string, unknown> }[] = []
/** What the stub does with the achievement list. */
let listAnswer: 'ok' | 'refused' | 'hang' = 'ok'

const LIST = {
  total_points: 12345,
  total_quantity: 3,
  achievements: [
    { id: 6, achievement: { name: 'Level 10' }, completed_timestamp: 1_700_000_000_000 },
    // An achievement the shipped catalogue cannot know, so its static half is read from Blizzard.
    { id: 999_999_991, achievement: { name: 'Shipped after the catalogue' }, completed_timestamp: 1_700_000_002_000 },
    // Not earned: no moment, so not on the timeline.
    { id: 7, achievement: { name: 'Level 20' } }
  ]
}

function refused(status: number) {
  return Object.assign(new Error(`[GET] "<url>": ${status}`), { name: 'FetchError', statusCode: status, status, response: { status } })
}

/** ofetch honours `timeout` by aborting; the stub does the same with the deadline the caller asked for. */
function hang(timeout: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), timeout)
  )
}

beforeEach(() => {
  asked = []
  listAnswer = 'ok'
  vi.resetModules()
  installUseDb(createMemoryDb().db)
  const g = globalThis as Record<string, unknown>
  g.useRuntimeConfig = () => ({ blizzardClientId: 'isolated-client', blizzardClientSecret: 'isolated-secret' })
  g.createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
  g.$fetch = (url: string, options: Record<string, unknown> = {}) => {
    asked.push({ url, options })
    if (url.includes('/oauth/token')) return Promise.resolve({ access_token: 'isolated-token', expires_in: 86400 })
    if (url.includes('/achievements?')) {
      if (listAnswer === 'refused') return Promise.reject(refused(503))
      if (listAnswer === 'hang') return hang(Number(options.timeout))
      return Promise.resolve(LIST)
    }
    if (url.includes('/data/wow/achievement/')) {
      return Promise.resolve({ name: 'New one', points: 10, category: { id: 92, name: 'General' } })
    }
    if (url.includes('/data/wow/media/achievement/')) return Promise.reject(refused(404))
    return Promise.resolve({})
  }
})

afterEach(() => {
  vi.useRealTimers()
})

async function load() {
  const { getAchievementFeed } = await import('../../server/utils/activity')
  const { runWithBlizzardSource } = await import('../../server/utils/blizzardSource')
  const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')
  return { getAchievementFeed, runWithBlizzardSource, readDiagnosticBuffers }
}

describe('the activity feed', () => {
  it('reads the list through the wrapper, with its deadline, and builds the feed as before', async () => {
    const { getAchievementFeed, runWithBlizzardSource, readDiagnosticBuffers } = await load()

    const feed = await runWithBlizzardSource('collection_read', () => getAchievementFeed('gordunni', 'mock', 'eu', 'en_US'))

    // The feed itself is unchanged: newest first, unearned left out, an incomplete card degraded rather than lost.
    expect(feed.totalPoints).toBe(12345)
    expect(feed.items.map((item) => item.id)).toEqual([999_999_991, 6])
    expect(feed.items[0]).toMatchObject({ name: 'New one', points: 10, icon: '' })

    const list = asked.find((call) => call.url.includes('/achievements?'))!
    expect(list.url).toBe(
      'https://eu.api.blizzard.com/profile/wow/character/gordunni/mock/achievements?namespace=profile-eu&locale=en_US'
    )
    expect(list.options.timeout).toBe(15_000)
    // The static reads are this module's own retry loop, so ofetch's silent retry is switched off for them.
    expect(asked.find((call) => call.url.includes('/data/wow/achievement/'))!.options.retry).toBe(0)

    // Every request is counted, and counted under the source the route set.
    const report = readDiagnosticBuffers().blizzardApi
    expect(report.total).toBe(asked.length)
    expect(report.bySource.reduce((sum, row) => sum + row.calls, 0)).toBe(report.total)
    expect(report.bySource.find((row) => row.source === 'collection_read')?.calls).toBe(report.total)
    expect(report.byCategory.find((row) => row.category === 'achievements')?.calls).toBe(1)
  })

  it('throws a refusal as it arrived, so the route maps it exactly as before, and counts it', async () => {
    const { getAchievementFeed, readDiagnosticBuffers } = await load()
    listAnswer = 'refused'

    await expect(getAchievementFeed('gordunni', 'mock', 'eu', 'en_US')).rejects.toMatchObject({ statusCode: 503 })

    const report = readDiagnosticBuffers().blizzardApi
    expect(report.failed).toBe(1)
    expect(report.serverErrors).toBe(1)
  })

  it('gives up at the deadline instead of waiting for ever, and counts a timeout', async () => {
    vi.useFakeTimers()
    const { getAchievementFeed, readDiagnosticBuffers } = await load()
    listAnswer = 'hang'

    const reading = getAchievementFeed('gordunni', 'mock', 'eu', 'en_US')
    const outcome = expect(reading).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await outcome

    expect(readDiagnosticBuffers().blizzardApi.timeouts).toBe(1)
  })
})
