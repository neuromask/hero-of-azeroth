/**
 * Returns the realm list used by the realm combobox.
 *
 * Realms of every supported region are returned together (each entry carries its
 * `region`), so the UI can group them under "Europe" / "America" headers and derive the
 * region from the realm the user picks – there is no separate region selector any more.
 * Pass ?region=eu to limit the response to one region.
 *
 * A Russian realm has two names in the game's own data – `Gordunni` and `Гордунни` –
 * and the API answers in the one the requested locale asks for. The list is therefore
 * read a second time in Russian: every realm then carries both names, which is what lets
 * the combobox show a Russian realm under either spelling and match what the visitor
 * types in either language.
 */
import type { H3Event } from 'h3'
// The realm list is its own source in the panel: every page with a search box or a realm name asks for it, and on a
// cold process it is most of what the first front page costs (`server/utils/blizzardSource`).
import { runWithBlizzardSource } from '~~/server/utils/blizzardSource'

export default defineEventHandler((event) => runWithBlizzardSource('realm_list', () => readRealmList(event)))

async function readRealmList(event: H3Event) {
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  const requested = query.region === 'eu' || query.region === 'us' ? (query.region as 'eu' | 'us') : ''
  const regions: Array<'eu' | 'us'> = requested ? [requested] : ['eu', 'us']

  try {
    const lists = await Promise.all(regions.map((region) => getRealms(region, locale)))
    // Reading it again as the Russian list: for the other realms the two names are the
    // same string, and the client decides whether the second one is worth showing.
    const russian =
      locale === 'ru_RU' ? lists : await Promise.all(regions.map((region) => getRealms(region, 'ru_RU')))

    return regions.flatMap((region, index) => {
      const russianNames = new Map(russian[index]!.map((realm) => [realm.slug, realm.name]))

      return lists[index]!.map((realm) => ({
        ...realm,
        region,
        nameRu: russianNames.get(realm.slug) || ''
      }))
    })
  } catch (err: any) {
    // One line, not the whole error: during an outage every page asks for the list, and a remembered failure
    // (`getRealms`) is rethrown to each of them - the stack of the first attempt would otherwise be printed per page.
    console.error(`[realms] failed: ${err?.statusCode || ''} ${err?.statusMessage || err?.message || 'unknown error'}`)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || err.statusMessage || 'Failed to fetch realm list'
    })
  }
}