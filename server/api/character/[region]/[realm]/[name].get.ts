export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const locale = (getQuery(event).locale as string) || 'en_US'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  try {
    const character = await getCharacter(realm, name, region, locale)
    // A lookup that came back with a character is the one moment the site learns a page
    // exists, so it is written down for the sitemap before the answer is returned (see
    // `server/utils/characterIndex.ts`).
    await rememberCharacter({ region, realm, name })
    return character
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character from Blizzard API'
    })
  }
})
