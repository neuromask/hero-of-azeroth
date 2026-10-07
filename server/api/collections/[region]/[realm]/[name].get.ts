/**
 * A character's shelf of mounts, pets or toys, drawn against the whole game.
 *
 * The atlas it is read from is static and shipped with the build, so the only thing paid for per
 * request is the character's own list of collected ids and the assembly of the sections. A shelf
 * that has just been assembled is handed straight to the next caller for two hours and revalidated
 * behind the request that finds it stale - the same window and the same store the profile, the card
 * and the feed are served from - while a `?force=true` request, which the header's Refresh button
 * sends, waits for a freshly assembled one.
 */
import type { CollectionPage } from '#shared/data/collectionsSchema'

const shelves = createSwrCache<CollectionPage>(2 * 60 * 60 * 1000, 256)

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  const kind = String(query.kind || 'mounts')
  const force = query.force === 'true' || query.force === '1'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }
  if (!isCollectionKind(kind)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown collection "${kind}"` })
  }

  try {
    return await shelves(
      `${region}:${locale}:${kind}:${realm}:${name}`,
      async () => {
        const collected = await getCollectedIds(region, realm, name, kind, locale)
        return buildCollectionPage(kind, locale, region, collected)
      },
      force
    )
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character collections from Blizzard API'
    })
  }
})