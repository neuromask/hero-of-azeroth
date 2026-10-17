/**
 * A stale-while-revalidate store for the two endpoints that are expensive to answer.
 *
 * A card costs a Blizzard lookup, two images over the network and a rasteriser pass, and the
 * profile behind it costs the lookup on its own, so an answer is kept on hand for a while
 * instead of being paid for again: one younger than `maxAge` is handed straight back, an
 * older one is handed back at once while a fresh copy is fetched behind the request - which
 * is what `stale-while-revalidate` names - and a caller that asks to `force` waits for the
 * fresh copy and stores it, which is the one path the header's Refresh button takes.
 *
 * The answers live in the process alone: they are a cache, not data, so nothing is written
 * anywhere a redeploy would have to clean up, and the map is capped so a busy day cannot make
 * the server hold every card it ever drew. It is deliberately not Nitro's `routeRules` cache:
 * that one sits outside the handler and keys on the whole URL, so it can neither hand a
 * `?force=true` request a fresh copy *and* refresh the copy the plain URL is served from.
 */
import { createBoundedCache, estimateBytes } from './lruStore'

export interface SwrCache<T> {
  /** The value for `key`, fetching it with `producer` when it is missing, stale or forced. */
  (key: string, producer: () => Promise<T>, force?: boolean): Promise<T>
  /**
   * When the value on hand for `key` was fetched, in seconds since the epoch, or `null` when the store
   * holds none.
   *
   * A caller that has to weigh its own answer against something else the site has stored needs to know how
   * old that answer is - a character's profile, say, against the reading the site filed for the same
   * character - and the store that handed it over is the only place that knows. The moment is the store's
   * rather than the caller's on purpose: an answer served out of the cache was fetched when it was
   * fetched, not when it was asked for, which is exactly the difference a caller cannot see otherwise.
   */
  fetchedAt(key: string): number | null
  /**
   * Forgets the value on hand for `key`, so the next caller pays for a fresh one.
   *
   * Only the *stored* value goes: a fetch already in flight is left alone, because the two callers waiting on
   * it are waiting for the same answer and cancelling it would be a third request for the same document. Which
   * is also why this is a per-key operation and not a `clear()`: the caches are separate per endpoint, and a
   * wipe of one of them is a burst of Blizzard reads nobody asked for.
   */
  invalidate(key: string): void
}

/**
 * Where an answer lives instead of the process's memory: a disk tier (`./sqliteStore`).
 *
 * Every method may throw; the store treats a throw as a miss (a read) or a shrug (a write), because a cache
 * that can take a page down is worse than no cache.
 */
export interface SwrPersistence<T> {
  /** The answer on file for `key` and when it was fetched (milliseconds), or `null`. */
  read(key: string): { value: T; at: number } | null
  /** Only the moment of the answer on file (milliseconds), without reading the answer itself. */
  readAt(key: string): number | null
  write(key: string, value: T, at: number): void
  remove(key: string): void
}

/**
 * The hard limits of one store, on top of its freshness.
 *
 * The site runs in 416 MiB for everything, so a store may not be bounded by *how many* answers it holds
 * alone: a card is a few hundred kilobytes and a shelf a few hundred more, and "512 entries" of those is
 * the whole heap. Every store therefore also has a byte budget, and the oldest answers are dropped as soon
 * as either limit is crossed.
 */
export interface SwrCacheOptions<T> {
  /** The most bytes the store may hold, by `sizeOf`. Defaults to 8 MiB. */
  maxBytes?: number
  /** What an answer weighs. Defaults to the byte length of a `Buffer`, or a few times the JSON length of anything else. */
  sizeOf?: (value: T) => number
  /**
   * A disk tier. When given, the answers are kept *there* and not in memory at all: a read is one indexed
   * SELECT, the bytes are in the heap only until the response is sent, and the process holds nothing between
   * requests but the in-flight markers. Without it the store is an in-memory LRU, bounded by `maxBytes`.
   */
  persist?: SwrPersistence<T>
}
/** The default byte budget of one store: all of them side by side stay well inside the host's limit. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/** How much longer than its freshness an answer is kept to be served stale before it is forgotten for good. */
const STALE_WINDOW = 3

/**
 * What a JavaScript object graph costs on the heap relative to the length of its JSON: property names are shared
 * but every object, array and string carries a header, so the figure is a few times the text. The budget is a
 * guard against the heap, so it is counted in heap-ish bytes rather than in the bytes of the wire.
 */
const HEAP_FACTOR = 3

function defaultSizeOf(value: unknown): number {
  return Buffer.isBuffer(value) ? value.byteLength : estimateBytes(value) * HEAP_FACTOR
}

export function createSwrCache<T>(maxAgeMs: number, maxEntries = 512, options: SwrCacheOptions<T> = {}): SwrCache<T> {
  const sizeOf = options.sizeOf ?? defaultSizeOf
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const persist = options.persist

  // An LRU rather than a bare `Map`: the cap is on entries *and* on bytes, an answer nobody has asked for in
  // `STALE_WINDOW` freshness spans is forgotten by the clock, and a read moves its entry to the safe end.
  // With a disk tier it is never filled: the answers live in the file and this stays empty.
  const values = createBoundedCache<{ value: T; at: number }>({
    max: maxEntries,
    maxBytes,
    ttlMs: maxAgeMs * STALE_WINDOW,
    sizeOf: (entry) => sizeOf(entry.value)
  })
  const inflight = new Map<string, Promise<T>>()

  /** The answer on hand for `key` and when it was fetched, from whichever tier this store keeps them in. */
  function recall(key: string): { value: T; at: number } | undefined {
    if (!persist) return values.get(key)

    try {
      return persist.read(key) ?? undefined
    } catch {
      // A tier that cannot be read is a miss: the caller fetches, which is what it would do with no cache.
      return undefined
    }
  }

  function keep(key: string, value: T, at: number): void {
    if (!persist) {
      values.set(key, { value, at })
      return
    }

    try {
      persist.write(key, value, at)
    } catch {
      // A tier that cannot be written costs the next caller a fetch and nothing else.
    }
  }

  function forget(key: string): void {
    if (!persist) {
      values.delete(key)
      return
    }

    try {
      persist.remove(key)
    } catch {
      // As above: nothing is lost by not forgetting what could not be read in the first place.
    }
  }

  /**
   * Fetches once per key: two callers that miss together share the one answer rather than
   * paying Blizzard twice, and the answer replaces the entry the moment it lands. The
   * bookkeeping (storing the value, dropping the in-flight marker) rides on the same promise
   * the callers await, so by the time any of them is handed the value the marker is already
   * gone and a later `force` starts a genuinely new fetch instead of finding the settled one.
   */
  function start(key: string, producer: () => Promise<T>): Promise<T> {
    const running = inflight.get(key)
    if (running) return running

    const fetching = producer()
      .then((value) => {
        // The LRU evicts the least recently used entries itself when either cap - the count or the bytes -
        // is crossed, and refuses an answer that alone outweighs the budget (it is still handed to the
        // callers waiting on it, it just is not kept).
        keep(key, value, Date.now())
        return value
      })
      .finally(() => {
        inflight.delete(key)
      })

    inflight.set(key, fetching)
    return fetching
  }

  /**
   * The store itself, with the moment of what it holds hanging off it: a caller that only wants a value
   * reads it as the function it is, and a caller that has to weigh that value against something else reads
   * `fetchedAt`.
   */
  const cache = ((key: string, producer: () => Promise<T>, force = false) => {
    if (force) return start(key, producer)

    const cached = recall(key)
    if (!cached) return start(key, producer)

    if (Date.now() - cached.at <= maxAgeMs) return Promise.resolve(cached.value)

    // Stale: the caller is answered out of the cache now and the fresh copy lands behind it.
    // A failure there is the caller's to shrug off, not an unhandled rejection to raise.
    void start(key, producer).catch(() => {})
    return Promise.resolve(cached.value)
  }) as SwrCache<T>

  cache.fetchedAt = (key) => {
    let at: number | null | undefined

    if (persist) {
      try {
        at = persist.readAt(key)
      } catch {
        at = null
      }
    } else {
      // `peek`: asking *when* is not a use of the answer, so it must not keep the entry alive.
      at = values.peek(key)?.at
    }

    return at ? Math.floor(at / 1000) : null
  }

  cache.invalidate = (key) => {
    forget(key)
  }

  return cache
}