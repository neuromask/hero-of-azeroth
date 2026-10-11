/**
 * A character's reputation journal: every faction they can work on, filed the way the game's reputation
 * pane files them, with the stage the character stands on and the scale of each ladder.
 *
 * **This endpoint answers for one character and one character alone.** The journal is folded against the
 * payload of the very character named in the address - `/profile/wow/character/{realm}/{name}/reputations`,
 * one call to Blizzard - and the account's union across the roster (`server/utils/accountPool`,
 * `bestFigures`) is deliberately *not* applied to it, unlike the reputations tile and the hall of fame's
 * rows above the shelf. A visitor opening this page is standing in the game on that character, comparing
 * themselves against what *that* character can raise - which is also why the profile is read for the
 * faction, so the other side's factions are not on the journal at all. The shelf therefore counts fewer
 * factions than the account-wide tile beside it, and says so in the reader's own words.
 *
 * The catalogue it is folded against is static and shipped with the build (`server/utils/reputations-data.json`,
 * built by `scripts/refresh-reputations.mjs`), so the only thing paid for per request is that one call and
 * the assembly of the groups. A journal that has just been assembled is handed straight to the next caller
 * for two hours and revalidated behind the request that finds it stale - the same window and the same
 * store the profile, the card, a collection shelf and the feed are served from - while a `?force=true`
 * request waits for a freshly assembled one.
 *
 * The switches a reader flips on the shelf - the search box and the switch that hides the factions the
 * character has not started - are the view's own and never reach this endpoint: they filter rows the
 * journal already holds, so the counters a heading reads cannot change under a filter. What the endpoint
 * takes from the query is the language only.
 */
import type { ReputationJournal } from '#shared/data/reputationsSchema'

const journals = createSwrCache<ReputationJournal>(2 * 60 * 60 * 1000, 256)

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
  const force = isOn(query.force)

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  try {
    return await journals(
      `${region}:${locale}:${realm}:${name}`,
      async () => {
        // The character is read for its faction as well as for its reputations: a faction only the other
        // side may raise is not on this journal at all. It is the same profile the shell above the view
        // fetches, from the same ten-minute cache, so a visitor reading a character pays one read.
        const [character, standings] = await Promise.all([
          getCharacter(realm, name, region, locale),
          getReputationStandings(region, realm, name, locale)
        ])

        return buildReputationJournal(locale, standings, character.faction)
      },
      force
    )
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character reputations from Blizzard API'
    })
  }
})
