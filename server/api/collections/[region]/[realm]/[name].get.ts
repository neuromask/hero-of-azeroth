/**
 * A character's collections: one shelf of mounts, pets, toys or decor, or the summary of all of them.
 *
 * The atlas it is read from is static and shipped with the build, so the only thing paid for per
 * request is the character's own list of collected ids, the profile that says which faction those ids
 * belong to - an item only the other side can hold is not on this shelf - and the assembly of the
 * sections. A shelf that has just been assembled is handed straight to the next caller for two hours
 * and revalidated behind the request that finds it stale - the same window and the same store the
 * profile, the card and the feed are served from - while a `?force=true` request, which the header's
 * Refresh button sends, waits for a freshly assembled one.
 *
 * Two switches go into a shelf's key as well, because they change what the shelf holds:
 * `?unobtainable=1` draws the items the game has done away with and `?upcoming=1` the ones it has not
 * shipped yet, which are SimpleArmory's own two settings under the same names. A request without a
 * `?kind=` is the summary - the running total and a row per shelf - which the root page draws.
 */
import type { CollectionPage, CollectionSummary, CollectionViewOptions } from '#shared/data/collectionsSchema'

const shelves = createSwrCache<CollectionPage>(2 * 60 * 60 * 1000, 256)
const summaries = createSwrCache<CollectionSummary>(2 * 60 * 60 * 1000, 256)

/** Whether a query flag is on, accepting what a link, a fetch and a form each write. */
function isOn(value: unknown): boolean {
  return value === 'true' || value === '1' || value === true || value === 'on'
}

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  const kind = query.kind ? String(query.kind) : ''
  const force = isOn(query.force)
  const view: CollectionViewOptions = {
    unobtainable: isOn(query.unobtainable),
    upcoming: isOn(query.upcoming)
  }

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }
  if (kind && !isCollectionKind(kind)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown collection "${kind}"` })
  }

  try {
    // Without a `kind` the request is for the summary: every shelf at once, under the default view.
    if (!kind) {
      return await summaries(
        `${region}:${locale}:${realm}:${name}`,
        async () => {
          const [character, collectedByKind] = await Promise.all([
            getCharacter(realm, name, region, locale),
            getCollectedByKind(region, realm, name, locale)
          ])
          return buildCollectionSummary(locale, collectedByKind, character.faction)
        },
        force
      )
    }

    return await shelves(
      `${region}:${locale}:${kind}:${realm}:${name}:${view.unobtainable ? 'u' : ''}${view.upcoming ? 'p' : ''}`,
      async () => {
        // The character is read for its faction as well as for its ids: an item only the other side
        // can hold is not on this shelf at all. It is the same profile the shell above the view
        // fetches, from the same ten-minute cache, so a visitor reading a character pays one read.
        const [character, collected] = await Promise.all([
          getCharacter(realm, name, region, locale),
          getCollectedIds(region, realm, name, kind, locale)
        ])
        return buildCollectionPage(kind, locale, region, collected, character.faction, view)
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