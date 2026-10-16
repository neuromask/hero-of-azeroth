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
 * pays for the hour's first answer is small in any case - a page of an indexed table and the widgets'
 * own figures beside it, with no Blizzard lookup and no walk of the population - so the stale-while-
 * revalidate half is deliberately not used: it would answer the first reader after a change with the
 * table as it was, which is exactly the situation a reader cannot tell from a broken one.
 *
 * And the hour is not a promise about the figures, either: every answer is filed under the stamp of the
 * data it was read from as well as under its own question (see `getKey` below), because the account pool
 * behind a signed-in row grows in the background and a table an hour behind the character page is a
 * reader seeing two different numbers for one player. All this handler has to do is not answer from a
 * table that is no longer the table.
 *
 * The cache key is the address, the query - sorted, so that two spellings of the same request
 * (`?sort=total&page=1` and `?page=1&sort=total`) share one entry - and that stamp. Carrying the stamp
 * is what makes the invalidation exact rather than eventual: an entry written before the data moved is
 * filed under a stamp nobody asks for again, so it can neither be handed to a reader who arrived after
 * the sync nor keep its figures while another question is read again. A handful of stamps a day (a
 * character looked up, a pool that grew) times the queries that were actually asked in that hour is
 * what the cache holds, and Nitro bounds it besides.
 *
 * This handler knows a query and a payload. What the payload is read from - the rows of the hall of fame's own
 * table in SQLite, materialised and maintained as the population moves - is entirely inside `leaderboardStorage`.
 */
import { getLeaderboard, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'
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

    // Three caches stand between this answer and a reader, and the hour is one bound on all of them.
    //
    //   - **Nitro's own**, in this process: keyed on the address, the question and the stamp of the data
    //     (`getKey` below), so a write that moves the table moves the key and the answer is read again. The hour
    //     is a ceiling on how long an entry may live, never a promise about the figures.
    //   - **the browser's**, out of the `cache-control` Nitro writes from `maxAge` below. The page asks with
    //     `cache-control: no-cache` (`app/composables/leaderboardView.ts`), which is what stops the browser using
    //     its own copy without asking the server. It does *not* make this handler skip its own cache - Nitro has
    //     no switch for that on a cached event handler - so what actually refreshes an answer is the stamp above.
    //   - **a proxy's or a CDN's**, if one stands in front: `max-age` is a directive a shared cache honours too,
    //     so such a cache may hold an answer for the hour it names and knows nothing of the stamp. That is the
    //     hour the site accepts, and part of why the presence endpoint exists beside this one
    //     (`server/api/leaderboard/presence.get.ts`).
    // Nothing about freshness is written in this handler: a cached answer's headers are Nitro's to build out of
    // the options below, and anything set here is overwritten before the answer leaves.

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
     * The key an answer is filed under: the address, the question, and the stamp of the data behind
     * both.
     *
     * The table is not the only thing behind an answer: the account pool grows in the background
     * (`server/utils/accountPool`) and the figures a signed-in row prints are read from it, so an answer
     * an hour old can be answering with a pool that has since been filled in - the very thing that leaves
     * a reader looking at a character page and a table that disagree.
     *
     * Comparing the stamp against a variable would keep that promise for the entry that was rebuilt last
     * and break it for every other entry in the cache, which is what this handler used to do: the answer
     * to one question says nothing about whether the answer to another was read from the same table, so a
     * reader who asked a different question in the meantime left the first entry answering from the table
     * as it was before the move, for as long as the hour lasted. Carried in the key, it needs no
     * bookkeeping at all: the data moved, so the key a reader asks for is not the key the stale answer is
     * filed under, and the question is read again.
     */
    getKey: (event) => {
      const query = getQuery(event)
      const params = new URLSearchParams()

      for (const key of Object.keys(query).sort()) {
        const value = query[key]
        if (value === undefined || value === null || value === '') continue
        params.set(key, Array.isArray(value) ? value.join(',') : String(value))
      }

      return `${getRequestURL(event).pathname}?${params.toString()}@${leaderboardDataStamp()}`
    }
  }
)
