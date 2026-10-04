const cardCache = new Map<string, { png: Buffer; expires: number }>()

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

  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  if (cached && cached.expires > now) {
    return cached.png
  }

  const character = await getCharacter(realm, name, region, locale)
  const png = await renderCharacterCard(character, locale)

  cardCache.set(key, { png, expires: now + 10 * 60 * 1000 })

  return png
})
