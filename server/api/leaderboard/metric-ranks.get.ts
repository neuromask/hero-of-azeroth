/**
 * The three places each of the named characters holds in one metric's ranking: the world, their own region, and
 * their own realm.
 *
 * One request answers for every character a caller names and for all three scopes at once. That is the shape the
 * comparison board needs - its two sides, one metric - and it is deliberately not three requests: a place in the
 * world, a place in a region and a place in a realm are three counts over one table, and asking for them
 * separately would read the same index three times over.
 *
 * A caller asks with `?metric=<slug>&players=region:realm:name,region:realm:name`, the key the table keys a row
 * by and the one the distribution endpoint already speaks, so a comparison board asks both endpoints about the
 * very same two characters in the very same spelling.
 *
 * A character the table does not hold is answered rather than refused: `participating: false` and no places,
 * which is what lets the board say "not in this ranking" where it would otherwise draw a link that leads nowhere.
 * The slug is checked against the whitelist and a slug this build does not serve is a 400, because there is no
 * ranking to ask about.
 *
 * Cached under the question and the stamp of the data, exactly as the metric page's own answer is
 * (`./metrics.get`), so a write that moves the population is a different key and a reader is never shown a place
 * in a table that has moved on.
 */
import { getMetricRanks, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'
import { RANK_KEYS_LIMIT } from '~~/server/utils/leaderboardRows'

/**
 * The characters a caller named, as `region:realm:name` keys - the way the table keys a row.
 *
 * A key that is not that shape is dropped rather than guessed at: a place is a fact about a member, and a
 * half-written key names no member.
 */
function parsePlayers(value: unknown): string[] {
  const players = Array.isArray(value) ? value.join(',') : value
  if (typeof players !== 'string') return []

  return players
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter((key) => /^[a-z]+:[^:]+:.+$/.test(key))
    .slice(0, RANK_KEYS_LIMIT)
}

export default defineCachedEventHandler(
  async (event) => {
    const query = getQuery(event)

    const metric = metricLeaderboardOf(Array.isArray(query.metric) ? query.metric[0] : query.metric)
    if (!metric) throw createError({ statusCode: 400, statusMessage: 'A known metric is required' })

    return await getMetricRanks(metric, parsePlayers(query.players))
  },
  {
    // The table's own terms, so a place can never be a place in a table nobody was shown.
    maxAge: 3600,
    swr: false,
    /** The question and the stamp of the data, exactly as the metric page's own answer is filed. */
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
