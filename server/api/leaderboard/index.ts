/**
 * The leaderboard endpoint, and the only way the page reaches the data.
 *
 * It answers one page of the table together with the summary figures the widgets print, in a
 * single response - a reader opening the page makes one request, not two, and every filter change
 * is the same request with a different query string.
 *
 * The handler is wrapped in `defineCachedEventHandler` with an hour's `maxAge` and stale-while-
 * revalidate, which is the whole performance story of this page: the first reader of an hour pays
 * for the read, everybody after them is answered from Nitro's own in-memory cache in single-digit
 * milliseconds without touching the storage layer at all. `swr` is what keeps the hour from ever
 * being visible - once the entry is stale it is served immediately and refreshed behind the
 * response - so the leaderboard cannot add to the site's TTFB even on the tick of the hour.
 *
 * The cache key is the path plus the query, sorted so that two spellings of the same request
 * (`?sort=total&page=1` and `?page=1&sort=total`) share one entry. Nitro bounds the cache, so a
 * reader typing a name into the search box fills entries that expire on their own rather than
 * anything that has to be swept.
 *
 * This handler knows a query and a payload. What the payload is read from - today a JSON file,
 * tomorrow a SQLite table - is entirely inside `leaderboardStorage`.
 */
import { getLeaderboard } from '~~/server/utils/leaderboardStorage'
import { LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
import type { LeaderboardFaction, LeaderboardSort } from '#shared/data/leaderboardSchema'

/** The factions a caller may filter by; anything else means "everybody". */
const FACTIONS: readonly LeaderboardFaction[] = ['alliance', 'horde', 'neutral']

/** The order a caller asked for, or the overall table when it named one this build does not know. */
function parseSort(value: unknown): LeaderboardSort {
  const sort = Array.isArray(value) ? value[0] : value
  return typeof sort === 'string' && (LEADERBOARD_SORTS as readonly string[]).includes(sort)
    ? (sort as LeaderboardSort)
    : 'total'
}

/** The faction a caller asked for, or `all`. */
function parseFaction(value: unknown): LeaderboardFaction | 'all' {
  const faction = Array.isArray(value) ? value[0] : value
  return typeof faction === 'string' && (FACTIONS as readonly string[]).includes(faction)
    ? (faction as LeaderboardFaction)
    : 'all'
}

/** A positive whole number out of a query string, or `undefined` for anything unusable. */
function parseNumber(value: unknown): number | undefined {
  const number = Number(Array.isArray(value) ? value[0] : value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined
}

/** A string out of a query string, trimmed and cut to a length a name could plausibly be. */
function parseText(value: unknown, limit = 40): string | undefined {
  const text = Array.isArray(value) ? value[0] : value
  if (typeof text !== 'string') return undefined

  const trimmed = text.trim().slice(0, limit)
  return trimmed || undefined
}

export default defineCachedEventHandler(
  async (event) => {
    const query = getQuery(event)

    // The page's own answer is public and identical for every visitor, so a browser may hold it
    // for a minute and a CDN for the hour the handler caches for.
    setHeader(event, 'cache-control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=600')

    return await getLeaderboard({
      sort: parseSort(query.sort),
      faction: parseFaction(query.faction),
      realm: parseText(query.realm),
      classId: parseNumber(query.class),
      q: parseText(query.q),
      page: parseNumber(query.page),
      perPage: parseNumber(query.perPage)
    })
  },
  {
    // An hour of freshness, served stale while the next hour is being built.
    maxAge: 3600,
    swr: true,
    // The query is part of the key, canonicalised so that the same request spelled two ways is
    // one cache entry.
    getKey: (event) => {
      const query = getQuery(event)
      const params = new URLSearchParams()

      for (const key of Object.keys(query).sort()) {
        const value = query[key]
        if (value === undefined || value === null || value === '') continue
        params.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }

      return `${getRequestURL(event).pathname}?${params.toString()}`
    }
  }
)
