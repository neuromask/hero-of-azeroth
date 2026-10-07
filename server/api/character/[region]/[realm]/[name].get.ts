/**
 * The profiles already fetched, keyed by the character and the language it was read in.
 *
 * A profile is a Blizzard lookup, which is the whole cost of answering a character page, so
 * an answer stays on hand for two hours and is revalidated behind the request that finds it
 * stale (see `server/utils/swrCache.ts`).
 */
const profiles = createSwrCache<CharacterData>(2 * 60 * 60 * 1000)

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  // `?force=true` is the Refresh button: it skips the two hours of cache, waits for a fresh
  // Blizzard lookup and stores it, so the plain URL is answered from the new copy afterwards.
  const force = query.force === 'true' || query.force === '1'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  try {
    return await profiles(
      `${region}:${locale}:${realm}:${name}`,
      async () => {
        const character = await getCharacter(realm, name, region, locale)
        // A lookup that came back with a character is the one moment the site learns a page
        // exists, so it is written down for the sitemap as the fresh copy is fetched (see
        // `server/utils/characterIndex.ts`).
        await rememberCharacter({ region, realm, name })
        return character
      },
      force
    )
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character from Blizzard API'
    })
  }
})
