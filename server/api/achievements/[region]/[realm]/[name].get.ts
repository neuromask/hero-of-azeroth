/**
 * A character's achievements, drawn against the whole game.
 *
 * The atlas it is read from is static and shipped with the build, so the only thing paid for per
 * request is the character's own list of earned ids and the profile that names its faction - an
 * achievement only the other side can earn is not on this shelf. One endpoint answers both shapes the
 * pages need: with a `?category=` it assembles that category's shelf, without one the summary - the
 * running total and a row per category - which is what the root page draws.
 *
 * A shelf or a summary that has just been assembled is handed straight to the next caller for two
 * hours and revalidated behind the request that finds it stale - the same window and the same store
 * the profile, the card and the shelves are served from - while a `?force=true` request, which the
 * header's Refresh button sends, waits for a freshly assembled one.
 */
import { isAchievementCategory, type AchievementPage, type AchievementSummary } from '#shared/data/achievementsSchema'

const summaries = createSwrCache<AchievementSummary>(2 * 60 * 60 * 1000, 256)
const shelves = createSwrCache<AchievementPage>(2 * 60 * 60 * 1000, 512)

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
  const category = query.category ? String(query.category) : ''
  const force = isOn(query.force)

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }
  if (category && !isAchievementCategory(category)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown achievement category "${category}"` })
  }

  /** The character's own log and faction, together - the profile is served from the same ten-minute
   *  cache the shell above the view reads, so a visitor reading a character pays one read. */
  async function characterLog() {
    const [character, collected] = await Promise.all([
      getCharacter(realm, name, region, locale),
      getEarnedAchievementIds(region, realm, name, locale)
    ])
    return { collected, faction: character.faction }
  }

  try {
    if (category) {
      return await shelves(
        `${region}:${locale}:${category}:${realm}:${name}`,
        async () => {
          const { collected, faction } = await characterLog()
          return buildAchievementPage(category, locale, region, collected, faction)
        },
        force
      )
    }

    return await summaries(
      `${region}:${locale}:${realm}:${name}`,
      async () => {
        const { collected, faction } = await characterLog()
        return buildAchievementSummary(locale, collected, faction)
      },
      force
    )
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character achievements from Blizzard API'
    })
  }
})
