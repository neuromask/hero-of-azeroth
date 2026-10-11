/**
 * Who is on the site, which is what the hall of fame draws its online dots from.
 *
 * The page asks this for itself instead of reading the mark off the table it draws, and deliberately so:
 * that table is cached for an hour and may be served by a CDN for another, while a dot is worth something
 * only while it is fresh. One small read per reader a minute buys a mark that is at most half a minute old
 * (the query behind it is memoised for that long, see `server/utils/presence.ts`), and the table itself
 * goes on being cached exactly as it was - no dot can pull an hour of table through the cache again.
 *
 * The answer is public, because who is on the site is what the dot says to everybody, and it may be held
 * for the same half minute the server's own read is memoised for.
 */
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'public, max-age=30')

  return { window: PRESENCE_WINDOW_SECONDS, keys: [...onlineLeaderboardKeys()] }
})
