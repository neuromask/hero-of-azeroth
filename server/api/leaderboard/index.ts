/**
 * The leaderboard endpoint, and the only way the page reaches the data.
 *
 * It answers one page of the table together with the summary figures the widgets print, in a
 * single response - a reader opening the page makes one request, not two, and every filter change
 * is the same request with a different query string.
 *
 * The handler is wrapped in `defineCachedEventHandler` with an hour's `maxAge`, which is the whole
 * performance story of this page: the first reader of an hour pays for the read, everybody after
 * them is answered from Nitro's own in-memory cache in single-digit milliseconds. What the reader
 * pays for the hour's first answer is small in any case - the payload is a filter and a sort over a
 * snapshot the process already holds, with no Blizzard lookup and no disk - so the stale-while-
 * revalidate half is deliberately not used: it would answer the first reader after a change with the
 * table as it was, which is exactly the situation a reader cannot tell from a broken one.
 *
 * And the hour is not a promise about the figures, either: an answer is dropped the moment what it
 * was built from has moved (`shouldInvalidateCache` below), because the account pool behind a
 * signed-in row grows in the background and a table an hour behind the character page is a reader
 * seeing two different numbers for one player. All this handler has to do is not answer from a
 * table that is no longer the table.
 *
 * The cache key is the path plus the query, sorted so that two spellings of the same request
 * (`?sort=total&page=1` and `?page=1&sort=total`) share one entry. Nitro bounds the cache, so a
 * reader typing a name into the search box fills entries that expire on their own rather than
 * anything that has to be swept. Invalidating an entry re-resolves it under the same key, so nothing
 * accumulates behind a table that moves.
 *
 * This handler knows a query and a payload. What the payload is read from - today a JSON file,
 * tomorrow a SQLite table - is entirely inside `leaderboardStorage`.
 */
import { getLeaderboard, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'
import { LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
import type { LeaderboardFaction, LeaderboardSort } from '#shared/data/leaderboardSchema'

/** The stamp the answer standing in the cache was built from (see `shouldInvalidateCache`). */
let servedStamp = ''

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

    // What this answer is built from, kept for the next request to compare against (see
    // `shouldInvalidateCache` below).
    servedStamp = leaderboardDataStamp()

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
    // An hour of freshness, resolved in place when the hour is up or the data behind it has moved.
    // `swr` is off explicitly: it is on by default for a cached event handler, and it is what would
    // answer the first reader after a change with the table as it was.
    maxAge: 3600,
    swr: false,
    /**
     * The entry is dropped when what it was built from has moved.
     *
     * The table is not the only thing behind this answer: the account pool grows in the background
     * (`server/utils/accountPool`) and the figures a signed-in row prints are read from it, so an
     * answer an hour old can be answering with a pool that has since been filled in - the very thing
     * that leaves a reader looking at a character page and a table that disagree. Comparing the stamp
     * the answer was built with against the current one resolves the entry again, in place: the key
     * does not change, so nothing accumulates, and a reader who arrives after a sync is answered with
     * the figures the profile page already prints.
     */
    shouldInvalidateCache: () => leaderboardDataStamp() !== servedStamp,
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
