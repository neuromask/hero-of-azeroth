/**
 * The in-memory caches are bounded, and what they keep is small.
 *
 * The site runs in 416 MiB, and its caches used to be bounded by a count alone (or by nothing): a profile kept the
 * raw Blizzard documents it was counted from - megabytes - and a card sat in a `Map` as a few hundred kilobytes
 * each. These tests pin the rules that replaced that: every store is capped by entries *and* by bytes, it ages out
 * on the clock the site and its tests move, and a heavy answer can live in SQLite instead of the heap.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBoundedCache, estimateBytes } from '../../server/utils/lruStore'
import { createSwrCache } from '../../server/utils/swrCache'

afterEach(() => {
  vi.useRealTimers()
})

describe('the bounded cache', () => {
  it('drops the least recently used entry when the count cap is crossed', () => {
    const cache = createBoundedCache<number>({ max: 2 })

    cache.set('a', 1)
    cache.set('b', 2)
    cache.get('a')
    cache.set('c', 3)

    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
  })

  it('drops entries when the byte budget is crossed, however few there are', () => {
    const cache = createBoundedCache<string>({ max: 100, maxBytes: 100 })

    cache.set('a', 'x'.repeat(60))
    cache.set('b', 'x'.repeat(60))

    expect(cache.has('a')).toBe(false)
    expect(cache.has('b')).toBe(true)
    expect(cache.calculatedSize).toBeLessThanOrEqual(100)
  })

  it('does not keep a single entry that outweighs the whole budget', () => {
    const cache = createBoundedCache<string>({ max: 10, maxBytes: 50 })

    cache.set('huge', 'x'.repeat(500))

    expect(cache.has('huge')).toBe(false)
    expect(cache.size).toBe(0)
  })

  it('forgets an entry once its time is up, on the clock the site and its tests move', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'))
    const cache = createBoundedCache<number>({ max: 10, ttlMs: 60_000 })

    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)

    vi.advanceTimersByTime(61_000)
    expect(cache.get('a')).toBeUndefined()
  })

  it('weighs buffers and typed arrays by their bytes and anything else by its JSON', () => {
    expect(estimateBytes(Buffer.alloc(1000))).toBe(1000)
    expect(estimateBytes(new Uint32Array(10))).toBe(40)
    expect(estimateBytes('abcd')).toBe(4)
    expect(estimateBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length)
  })
})

describe('the stale-while-revalidate store', () => {
  it('holds at most as many answers as its entry cap, the oldest out first', async () => {
    const cache = createSwrCache<string>(60_000, 2)

    await cache('a', async () => 'a')
    await cache('b', async () => 'b')
    await cache('c', async () => 'c')

    const producer = vi.fn(async () => 'again')
    await cache('a', producer)
    expect(producer).toHaveBeenCalledTimes(1)
  })

  it('holds at most its byte budget of answers', async () => {
    const cache = createSwrCache<Buffer>(60_000, 100, { maxBytes: 1000 })

    await cache('a', async () => Buffer.alloc(600))
    await cache('b', async () => Buffer.alloc(600))

    const producer = vi.fn(async () => Buffer.alloc(600))
    await cache('a', producer)
    expect(producer).toHaveBeenCalledTimes(1)
  })

  it('still hands an answer that is too large to keep to everyone waiting on it', async () => {
    const cache = createSwrCache<Buffer>(60_000, 10, { maxBytes: 100 })
    const producer = vi.fn(async () => Buffer.alloc(1000))

    const [first, second] = await Promise.all([cache('big', producer), cache('big', producer)])

    expect(first.length).toBe(1000)
    expect(second).toBe(first)
    expect(producer).toHaveBeenCalledTimes(1)
  })

  it('serves a stale answer at once and fetches the fresh one behind it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T10:00:00Z'))
    const cache = createSwrCache<string>(60_000, 10)

    await cache('a', async () => 'old')
    vi.advanceTimersByTime(90_000)

    expect(await cache('a', async () => 'new')).toBe('old')
    await vi.advanceTimersByTimeAsync(0)
    expect(await cache('a', async () => 'never')).toBe('new')
  })
})
