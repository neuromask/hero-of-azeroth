/**
 * One metric's distribution, with the positions of the players a caller named.
 *
 * The endpoint answers from what the site already has - no Blizzard lookup, and no disk after the first read.
 * The population is the site's own readings (`readSnapshotDistribution`): every character it has read, one
 * figure each, taken at that character's newest point. One population for all fifteen figures, and the same
 * one a character's history is drawn from - so a comparison board is drawing one table's worth of everybody and
 * the site's own record of the two characters in it.
 *
 * The histogram is the population's and is therefore shared: one request serves a whole comparison, and the
 * `players` it names are the only per-player work - their figure, their place and their percentile.
 *
 * A caller asks for `?metric=<key>&players=region:realm:name,region:realm:name`. A player the site has not read
 * is answered with `null`s rather than a fabricated place.
 */
import { readSnapshotDistribution } from '~~/server/utils/characterReading'
import { METRIC_KEYS } from '#shared/data/historySchema'
import type { MetricKey } from '#shared/data/historySchema'

/** The metric a caller asked for, or `null` for one this build does not know. */
function parseMetric(value: unknown): MetricKey | null {
  const metric = Array.isArray(value) ? value[0] : value
  return typeof metric === 'string' && (METRIC_KEYS as readonly string[]).includes(metric)
    ? (metric as MetricKey)
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
  if (!metric) throw createError({ statusCode: 400, statusMessage: 'A known metric is required' })

  return readSnapshotDistribution(metric, parsePlayers(query.players))
})
