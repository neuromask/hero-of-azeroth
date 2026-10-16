/**
 * One page of one metric leaderboard, at the scope a caller names.
 *
 * A metric leaderboard is a ranking of a *single* figure (`METRIC_LEADERBOARDS` in
 * `#shared/data/leaderboardSchema`) and the address of one is three things: which figure, which scope, and which
 * page. The figure and the scope travel as a query string rather than as path segments because the page that
 * draws them is a Nuxt route of its own (`app/pages/leaderboards/...`), and the route is what a crawler and a
 * reader see - this handler only has to answer the question that route asks. That is the same split the front
 * door already keeps between `/` and `/api/leaderboard`.
 *
 * The scope is exact: no region is the whole world, a region is that region's ranking, and a realm is a realm
 * *inside* its region - which is why a realm is ignored without one (`MetricLeaderboardScope`), since the same
 * realm slug exists in more than one region.
 *
 * The metric's slug is checked against the whitelist here and the *entry* is what travels on: nothing a caller
 * types reaches SQL, and a slug this build does not serve is a 404 rather than an empty table - the address names
 * a page that does not exist, which is exactly what a 404 is for.
 *
 * Cached for the hour the front door's table is cached for, under a key that carries the stamp of the data as
 * well as the question (`getKey` below), so a write that moves the population moves the key and the first reader
 * after it is answered with the figures the pages already print.
 */
import { getMetricLeaderboard, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'
import type { LeaderboardFaction } from '#shared/data/leaderboardSchema'

/** The factions a caller may filter by; anything else means "everybody". */
const FACTIONS: readonly LeaderboardFaction[] = ['alliance', 'horde', 'neutral']

/** A positive whole number out of a query string, or `undefined` for anything unusable. */
function parseNumber(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === null || raw === '') return undefined

  const number = Number(raw)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

/** The faction a caller asked for, or `all` - the same three chips the front door's table offers. */
function parseFaction(value: unknown): LeaderboardFaction | 'all' {
  const faction = Array.isArray(value) ? value[0] : value
  return typeof faction === 'string' && (FACTIONS as readonly string[]).includes(faction)
    ? (faction as LeaderboardFaction)
    : 'all'
}

/** A text parameter out of a query string, trimmed, or `undefined` for anything unusable. */
function parseText(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return undefined

  const text = raw.trim()
  return text || undefined
}

export default defineCachedEventHandler(
  async (event) => {
    const query = getQuery(event)

    const metric = metricLeaderboardOf(Array.isArray(query.metric) ? query.metric[0] : query.metric)
    if (!metric) throw createError({ statusCode: 404, statusMessage: 'Unknown leaderboard metric' })

    // The region is read as a bare code (`eu`) and as the spelling a page's own address uses (`region-eu`), so a
    // link copied out of a character page's address still names the scope it means. Anything else is a scope the
    // site does not serve, and it keeps nobody rather than everybody (`whereClause`).
    const region = parseText(query.region)?.replace(/^region-/, '').toLowerCase()

    // The two narrowing choices the filter bar makes are the front door's own: which side, and a fragment of a
    // name. Neither is part of the address, exactly as neither is on the front door - the table they narrow is
    // the one the address names, and a filtered answer is that table's state rather than a page of its own.
    return await getMetricLeaderboard(
      metric,
      {
        region,
        realm: parseText(query.realm)?.toLowerCase(),
        faction: parseFaction(query.faction),
        q: parseText(query.q),
        page: parseNumber(query.page)
      },
      parseNumber(query.perPage)
    )
  },
  {
    // An hour of freshness, resolved in place when the hour is up or the data behind it has moved. `swr` is off
    // for the reason it is off on the front door's own table: the stale half is what would answer the first reader
    // after a change with a table the site no longer holds.
    maxAge: 3600,
    swr: false,
    /**
     * The key an answer is filed under: the question, and the stamp of the data behind it.
     *
     * The stamp has to ride in the key rather than be compared against a variable, because one handler answers a
     * different question per metric and per scope - an entry written before the data moved is filed under a stamp
     * nobody asks for again, so the first reader after a sync is answered from the rows the pages now print.
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
