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
export interface SwrCache<T> {
  /** The value for `key`, fetching it with `producer` when it is missing, stale or forced. */
  (key: string, producer: () => Promise<T>, force?: boolean): Promise<T>
}

export function createSwrCache<T>(maxAgeMs: number, maxEntries = 512): SwrCache<T> {
  const values = new Map<string, { value: T; at: number }>()
  const inflight = new Map<string, Promise<T>>()

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
        // Re-setting an existing key moves it to the end, so the map's front is the least
        // recently seen entry and the one the cap drops.
        values.delete(key)
        values.set(key, { value, at: Date.now() })
        if (values.size > maxEntries) {
          const oldest = values.keys().next().value
          if (oldest !== undefined) values.delete(oldest)
        }
        return value
      })
      .finally(() => {
        inflight.delete(key)
      })

    inflight.set(key, fetching)
    return fetching
  }

  return (key, producer, force = false) => {
    const cached = values.get(key)

    if (force || !cached) return start(key, producer)

    if (Date.now() - cached.at <= maxAgeMs) return Promise.resolve(cached.value)

    // Stale: the caller is answered out of the cache now and the fresh copy lands behind it.
    // A failure there is the caller's to shrug off, not an unhandled rejection to raise.
    void start(key, producer).catch(() => {})
    return Promise.resolve(cached.value)
  }
}