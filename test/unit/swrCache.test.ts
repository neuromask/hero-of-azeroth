/**
 * Forgetting one key, and only one key.
 *
 * The admin panel can afford one targeted operation and not a wipe: the caches are per-endpoint and each one
 * sits in front of a Blizzard read, so clearing "everything" is a burst of upstream calls nobody asked for.
 * These tests pin the two rules that make an addressable invalidation safe - the key that is named is forgotten,
 * the keys that are not are left standing, and a fetch already under way is never cancelled (the callers waiting
 * on it are waiting for the same answer).
 */
import { describe, expect, it, vi } from 'vitest'
import { createSwrCache } from '../../server/utils/swrCache'

describe('invalidating one key', () => {
  it('makes the next caller pay for a fresh value, and leaves the other keys alone', async () => {
    const cache = createSwrCache<string>(60_000)
    const producer = vi.fn(async (value: string) => value)

    await cache('a', () => producer('a'))
    await cache('b', () => producer('b'))
    expect(producer).toHaveBeenCalledTimes(2)

    cache.invalidate('a')

    // `b` is still the answer on hand.
    expect(await cache('b', () => producer('b-second'))).toBe('b')
    expect(producer).toHaveBeenCalledTimes(2)

    // `a` is not: the producer runs again, and the fresh value is what is stored.
    expect(await cache('a', () => producer('a-second'))).toBe('a-second')
    expect(producer).toHaveBeenCalledTimes(3)
    expect(await cache('a', () => producer('never'))).toBe('a-second')
    expect(producer).toHaveBeenCalledTimes(3)
  })

  it('does not cancel a fetch that is already in flight, nor lose its answer', async () => {
    const cache = createSwrCache<string>(60_000)
    let release: () => void = () => {}
    const producer = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('fetched')
        })
    )

    const first = cache('a', producer)
    // Two callers, one request: the second joins the first rather than starting a second.
    const second = cache('a', producer)

    cache.invalidate('a')

    expect(producer).toHaveBeenCalledTimes(1)

    release()
    expect(await first).toBe('fetched')
    expect(await second).toBe('fetched')

    // And the answer the in-flight fetch produced is the one the cache now holds.
    expect(await cache('a', () => Promise.resolve('other'))).toBe('fetched')
  })

  it('reports when a value was fetched, which is what a caller weighs its own figures against', async () => {
    const cache = createSwrCache<string>(60_000)

    expect(cache.fetchedAt('missing')).toBeNull()

    await cache('a', () => Promise.resolve('a'))
    expect(cache.fetchedAt('a')).toBeGreaterThan(0)

    cache.invalidate('a')
    expect(cache.fetchedAt('a')).toBeNull()
  })
})
