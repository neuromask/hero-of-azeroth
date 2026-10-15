/**
 * One metric's distribution over the canonical leaderboard, with the positions of the players a caller named.
 *
 * The endpoint answers from the leaderboard alone (no Blizzard lookup, no disk after the first read). The
 * histogram is the population's and is therefore shared: one request serves a whole comparison, and the
 * `players` it names are the only per-player work - their figure, their place and their percentile.
 *
 * A caller asks for `?metric=<key>&players=region:realm:name,region:realm:name`. A player the table does not
 * know is answered with `null`s rather than a fabricated place.
 */
import { getDistribution } from '~~/server/utils/leaderboardStorage'
import { DISTRIBUTION_METRICS } from '#shared/data/historySchema'
import type { DistributionMetricKey } from '#shared/data/historySchema'

/** The metric a caller asked for, or `null` for one this build cannot draw a distribution of. */
function parseMetric(value: unknown): DistributionMetricKey | null {
  const metric = Array.isArray(value) ? value[0] : value
  return typeof metric === 'string' && (DISTRIBUTION_METRICS as readonly string[]).includes(metric)
    ? (metric as DistributionMetricKey)
    : null
}

/** The players a caller named, as `region:realm:name` keys - the way the table keys a row. */
function parsePlayers(value: unknown): string[] {
  const players = Array.isArray(value) ? value.join(',') : value
  if (typeof players !== 'string') return []

  return players
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter((key) => /^[a-z]+:[^:]+:.+$/.test(key))
    .slice(0, 4)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const metric = parseMetric(query.metric)
  if (!metric) throw createError({ statusCode: 400, statusMessage: 'A metric with a distribution is required' })

  return await getDistribution(metric, parsePlayers(query.players))
})
