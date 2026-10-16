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
 * looking at, and an answer fresher than the table would be a place in a table nobody was shown. What
 * makes that hour a bound on the work rather than a promise about the numbers is the stamp of the data
 * riding in the key the answer is filed under (`leaderboardDataStamp`): a sync that grows the pool
 * behind a reader's row - or a table that was rewritten - is a different key, so the plate is read
 * again rather than left an hour behind the table it was read from. A character the table does not
 * know is refused, not placed: there is no place to report for a row that is not there, and the page
 * draws no plate for one. That is a 404 rather than an empty answer because an empty answer is one the
 * cache would hold for the hour, and a character is looked up - and so enters the table - the moment
 * their page is opened, which is usually a moment after a reader's browser remembers them.
 */
import { getLeaderboardStanding, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'

export default defineCachedEventHandler(
  async (event) => {
    const region = parseRegion(getRouterParam(event, 'region'))
    const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
    const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()

    if (!realm || !name) {
      throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
    }

    // The freshness of this reading is Nitro's to write, out of the options below: a header set in here is
    // overwritten before the answer leaves. It is the site's own answer to where a character stands *overall* -
    // the pages that print a place read the ranking of one figure for it
    // (`/api/leaderboard/metric-ranks`), which asks the same question of one metric at a time.

    const standing = await getLeaderboardStanding({ region, realm, name })
    if (!standing) {
      throw createError({ statusCode: 404, statusMessage: 'That character is not in the table' })
    }

    return standing
  },
  {
    // An hour of freshness - the table's own terms, so a place can never be a place in a table nobody
    // was shown. `swr` is off for the reason it is off there: the stale half is what would answer the
    // first reader after a change with figures the table no longer holds, which is exactly the
    // situation a reader cannot tell from a broken one.
    maxAge: 3600,
    swr: false,
    /**
     * The stamp of the data the answer was read from rides in the key it is filed under.
     *
     * The table's own handler compares a stamp against a variable instead (`server/api/leaderboard`),
     * which is enough there because one table stands behind every key it serves. This handler answers a
     * different question per character, and a variable shared by all of them could not say which entry
     * was built from which table - so the stamp is part of the key, where the question answers itself:
     * an entry written before the data moved is filed under a stamp nobody asks for again, and the
     * first reader after a sync is answered with the figures the character page already prints.
     */
    getKey: (event) => `${getRequestURL(event).pathname}@${leaderboardDataStamp()}`
  }
)
