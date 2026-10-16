/**
 * The population as the front door's widgets read it: how many members the site holds, who leads each figure, and
 * the facets the filters are built from.
 *
 * It is an endpoint of its own because the front door no longer draws a table: the aggregate used to ride along with
 * a page of the hall of fame (`/api/leaderboard`), and a page that shows plates and widgets rather than rows should
 * not ask for rows to get them. What it answers with is the very object the storage layer memoises per revision of
 * the data (`getGlobalStats`), so the request costs no more than the answer costs to serialise - the aggregation
 * itself is paid once, when the table moves.
 *
 * The answer is cached for an hour, keyed on the stamp of the data behind it, exactly as the tables are: an entry
 * written before a write is filed under a stamp nobody asks for again, so a reader is never shown a population the
 * site has moved past.
 */
import { getGlobalStats, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'

export default defineCachedEventHandler(
  async () => await getGlobalStats(),
  {
    maxAge: 3600,
    // Off for the reason it is off on the tables: the stale half is what would answer the first reader after a
    // change with figures the site no longer holds.
    swr: false,
    getKey: (event) => `${getRequestURL(event).pathname}@${leaderboardDataStamp()}`
  }
)
