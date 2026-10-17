/**
 * The one way the site builds an in-memory cache: an LRU with a count cap, a byte cap and a clock.
 *
 * The process has 416 MiB for the whole site, and every `Map` that used to hold "what was read last" was
 * bounded - if at all - by a number of entries and an ad-hoc sweep. A count says nothing about weight: five
 * hundred cards or five hundred Blizzard documents are not five hundred small things. So every store built
 * here is capped on *both*, ages out on its own (`ttlMs`), and drops the least recently used entry first the
 * moment either cap is crossed - which is what `lru-cache` is for, and why the hand-written sweeps are gone.
 *
 * The clock is `Date.now()` and `ttlResolution` is 0 on purpose: expiry is then read off the same clock the
 * rest of the site's freshness rules (and the unit tests' fake timers) read, and the cache starts no timer
 * of its own that could keep the process or a test alive.
 */
import { LRUCache } from 'lru-cache'

export interface BoundedCacheOptions<V> {
  /** The most entries the store holds. */
  max: number
  /** How long an entry lives, in milliseconds. Omitted: an entry lives until the caps push it out. */
  ttlMs?: number
  /** The most bytes the store holds, by `sizeOf`. Omitted: bounded by count alone (for entries that are tiny). */
  maxBytes?: number
  /** What an entry weighs; defaults to `estimateBytes`. */
  sizeOf?: (value: V) => number
  /**
   * Keep serving an entry after its `ttlMs`, until it is evicted by the caps. For the stores that read
   * freshness off the entry themselves (a stale answer is still the last known one).
   */
  keepStale?: boolean
}

/**
 * A cheap estimate of how many bytes a value holds: exact for buffers, strings and typed arrays, the length of
 * the JSON for anything else. It is a budget, not an accounting - being within a small factor is the point.
 */
export function estimateBytes(value: unknown): number {
  if (value == null) return 1
  if (typeof value === 'string') return value.length
  if (ArrayBuffer.isView(value)) return value.byteLength

  try {
    return JSON.stringify(value)?.length ?? 1
  } catch {
    return 1
  }
}

export function createBoundedCache<V extends {}>(options: BoundedCacheOptions<V>): LRUCache<string, V> {
  const sizeOf = options.sizeOf ?? estimateBytes

  return new LRUCache<string, V>({
    max: options.max,
    ...(options.ttlMs ? { ttl: options.ttlMs } : {}),
    ttlResolution: 0,
    perf: { now: () => Date.now() },
    ...(options.maxBytes
      ? {
          maxSize: options.maxBytes,
          maxEntrySize: options.maxBytes,
          sizeCalculation: (value: V) => Math.max(1, Math.ceil(sizeOf(value)))
        }
      : {}),
    ...(options.keepStale ? { allowStale: true, noDeleteOnStaleGet: true } : {})
  })
}
