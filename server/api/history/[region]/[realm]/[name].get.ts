/**
 * One metric's history for one character: every snapshot point filed for it, oldest first.
 *
 * The endpoint answers from the database alone - no Blizzard lookup, no cache - because a history is the
 * site's own record, and it is read the same way the points are written (`readCharacterHistory`, beside
 * `fileDailyReading` in `server/utils/characterReading`). One metric per request, because the view that draws
 * one figure at a time should pay for one figure at a time.
 */
import { readCharacterHistory } from '~~/server/utils/characterReading'
import { readCharacterRoute } from '~~/server/utils/characterRoute'
import { METRIC_KEYS } from '#shared/data/historySchema'
import type { MetricKey } from '#shared/data/historySchema'

/** The metric a caller asked for, or `null` for one this build does not know. */
function parseMetric(value: unknown): MetricKey | null {
  const metric = Array.isArray(value) ? value[0] : value
  return typeof metric === 'string' && (METRIC_KEYS as readonly string[]).includes(metric)
    ? (metric as MetricKey)
    : null
}

export default defineEventHandler((event) => {
  const { region, realm, name } = readCharacterRoute(event)

  const metric = parseMetric(getQuery(event).metric)
  if (!metric) throw createError({ statusCode: 400, statusMessage: 'A known metric is required' })

  const history = readCharacterHistory(region, realm, name, metric)
  if (!history) throw createError({ statusCode: 404, statusMessage: 'Character not found' })

  return history
})
