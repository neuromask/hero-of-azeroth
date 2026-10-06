/**
 * The cards already rendered, keyed by the character and the language they were drawn in.
 *
 * A card is the expensive half of a request - a Blizzard lookup, two images over the network
 * and a rasteriser pass - so one that has just been drawn is handed to the next caller rather
 * than drawn again.
 */
const cardCache = new Map<string, { jpeg: Buffer; expires: number }>()

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const locale = (getQuery(event).locale as string) === 'ru_RU' ? 'ru_RU' : 'en_US'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  const key = `${region}:${locale}:${realm}:${name}`
  const now = Date.now()
  const cached = cardCache.get(key)

  // The card is a picture with photographs in it, so it is written and served as a JPEG: a
  // chat network's crawler fetches an `og:image` on a deadline of a couple of seconds, and
  // the bytes it has to pull inside that deadline are half of whether the preview appears.
  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  if (cached && cached.expires > now) {
    return cached.jpeg
  }

  const character = await getCharacter(realm, name, region, locale)
  const jpeg = await renderCharacterCard(character, locale)

  cardCache.set(key, { jpeg, expires: now + 10 * 60 * 1000 })

  return jpeg
})
