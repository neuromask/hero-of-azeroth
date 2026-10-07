/**
 * The cards already rendered, keyed by the character and the language they were drawn in.
 *
 * A card is the expensive half of a request - a Blizzard lookup, two images over the network
 * and a rasteriser pass - so one that has just been drawn is handed to the next caller rather
 * than drawn again, for two hours (see `server/utils/swrCache.ts`). A `?force=true` request,
 * which the header's Refresh button sends, waits for a freshly drawn card instead.
 */
const cards = createSwrCache<Buffer>(2 * 60 * 60 * 1000, 256)

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = query.locale === 'ru_RU' ? 'ru_RU' : 'en_US'
  const force = query.force === 'true' || query.force === '1'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  // The card is a picture with photographs in it, so it is written and served as a JPEG: a
  // chat network's crawler fetches an `og:image` on a deadline of a couple of seconds, and
  // the bytes it has to pull inside that deadline are half of whether the preview appears.
  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  return cards(
    `${region}:${locale}:${realm}:${name}`,
    async () => {
      const character = await getCharacter(realm, name, region, locale)
      return renderCharacterCard(character, locale)
    },
    force
  )
})
