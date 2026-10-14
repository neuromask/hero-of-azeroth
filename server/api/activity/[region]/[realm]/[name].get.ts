/**
 * The activity feeds already built, keyed by the character and the language it was read in.
 *
 * The feed is a Blizzard read plus up to forty lookups behind it (a detail and an icon for
 * each achievement shown), so one that has just been built is handed to the next caller for
 * two hours and revalidated behind the request that finds it stale - the same window, and the
 * same `server/utils/swrCache.ts`, the profile and the card are served from. A `?force=true`
 * request, which the header's Refresh button sends, waits for a freshly built feed instead.
 */
import { apiLocale, mapBlizzardError, parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'

const feeds = createSwrCache<ActivityFeed>(2 * 60 * 60 * 1000, 256)

export default defineEventHandler(async (event) => {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = apiLocale(query)
  const force = parseBoolFlag(query.force)

  // A forced refresh spends Blizzard's quota on purpose, so it is charged to whoever asked for it before any
  // of the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)

  try {
    return await feeds(
      `${region}:${locale}:${realm}:${name}`,
      () => getAchievementFeed(realm, name, region, locale),
      force
    )
  } catch (err) {
    mapBlizzardError(err, 'character activity')
  }
})