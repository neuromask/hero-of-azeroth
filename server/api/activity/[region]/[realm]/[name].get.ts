/**
 * The activity feeds already built, keyed by the character and the language it was read in.
 *
 * The feed is a Blizzard read plus up to forty lookups behind it (a detail and an icon for
 * each achievement shown), so one that has just been built is handed to the next caller for
 * two hours and revalidated behind the request that finds it stale - the same window, and the
 * same `server/utils/swrCache.ts`, the profile and the card are served from. A `?force=true`
 * request, which the header's Refresh button sends, waits for a freshly built feed instead.
 */
const feeds = createSwrCache<ActivityFeed>(2 * 60 * 60 * 1000, 256)

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  const force = query.force === 'true' || query.force === '1'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  try {
    return await feeds(
      `${region}:${locale}:${realm}:${name}`,
      () => getAchievementFeed(realm, name, region, locale),
      force
    )
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character activity from Blizzard API'
    })
  }
})