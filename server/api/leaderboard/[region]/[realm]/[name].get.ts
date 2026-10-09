/**
 * Where one character stands in the hall of fame: their row, the place the overall table gives it,
 * and how many characters that place was won among.
 *
 * The table is one answer for every reader and is cached as one (see `index.ts`); this is one answer
 * for one reader, and it is a request of its own because of it. Folded into the table's own query,
 * every reader's own character would give them a private copy of an answer the next reader cannot
 * use, and the table - the one answer everybody shares - would be cached once per visitor. The page
 * asks for it once, for the character the browser is signed in as, which the browser only knows after
 * it has mounted (`app/composables/searchHistory.ts`).
 *
 * The character is named the way every other endpoint on the site names one, as three address
 * segments in the path, so what a caller builds is the address of a character rather than a question
 * with a realm in it.
 *
 * Cached for the hour the table itself is cached for: a place is a place in the table the reader is
 * looking at, and an answer fresher than the table would be a place in a table nobody was shown. A
 * character the table does not know is refused, not placed: there is no place to report for a row that
 * is not there, and the page draws no plate for one. That is a 404 rather than an empty answer because
 * an empty answer is one the cache would hold for the hour, and a character is looked up - and so
 * enters the table - the moment their page is opened, which is usually a moment after a reader's
 * browser remembers them.
 */
import { getLeaderboardStanding } from '~~/server/utils/leaderboardStorage'

export default defineCachedEventHandler(
  async (event) => {
    const region = parseRegion(getRouterParam(event, 'region'))
    const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
    const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()

    if (!realm || !name) {
      throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
    }

    // The freshness the table promises, spelled for a browser and for a CDN: a reading of the table
    // is worth a minute in the browser, and the hour the handler caches for everywhere else.
    setHeader(event, 'cache-control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=600')

    const standing = await getLeaderboardStanding({ region, realm, name })
    if (!standing) {
      throw createError({ statusCode: 404, statusMessage: 'That character is not in the table' })
    }

    return standing
  },
  {
    // An hour of freshness, served stale while the next hour is being built - the table's own terms.
    maxAge: 3600,
    swr: true
  }
)
