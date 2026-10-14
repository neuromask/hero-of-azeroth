/**
 * A character's achievements, drawn against the whole game.
 *
 * The atlas it is read from is static and shipped with the build, so the only thing paid for per
 * request is the character's own list of earned ids and the profile that names its faction - an
 * achievement only the other side can earn is not on this shelf. One endpoint answers both shapes the
 * pages need: with a `?category=` it assembles that category's shelf, without one the summary - the
 * running total and a row per category - which is what the root page draws.
 *
 * Achievements are built exactly the way the collections shelves are (`server/utils/collections`): the
 * character's own log over the static atlas, filtered by the side the profile names. What they are not is
 * the account's - a merged roster would answer a question nobody standing in the game on this character is
 * asking, and the shelf and the tile beside it would be two answers to one question. The account's figures
 * belong to the tiles and to the hall of fame's rows (`server/utils/accountPool`), and even there it is the
 * achievement *points* that are the account's, because in the game they are.
 *
 * A shelf or a summary that has just been assembled is handed straight to the next caller for two
 * hours and revalidated behind the request that finds it stale - the same window and the same store
 * the profile, the card and the shelves are served from - while a `?force=true` request, which the
 * header's Refresh button sends, waits for a freshly assembled one.
 */
import { isAchievementCategory, type AchievementCategory, type AchievementPage, type AchievementSummary } from '#shared/data/achievementsSchema'
import { apiLocale, mapBlizzardError, parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'
import { profileRevision } from '~~/server/utils/profileRevision'

const summaries = createSwrCache<AchievementSummary>(2 * 60 * 60 * 1000, 256)
const shelves = createSwrCache<AchievementPage>(2 * 60 * 60 * 1000, 512)

export default defineEventHandler(async (event) => {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = apiLocale(query)
  const category = query.category ? String(query.category) : ''
  const force = parseBoolFlag(query.force)

  // A forced refresh spends Blizzard's quota on purpose, so it is charged to whoever asked for it before any
  // of the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)
  if (category && !isAchievementCategory(category)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown achievement category "${category}"` })
  }

  /** The character's own log and faction, together - the profile is served from the same ten-minute
   *  cache the shell above the view reads, so a visitor reading a character pays one read. */
  async function characterLog() {
    const [character, collected] = await Promise.all([
      getCharacter(realm, name, region, locale, force),
      getEarnedAchievementIds(region, realm, name, locale)
    ])
    return { collected, faction: character.faction }
  }

  try {
    if (category) {
      return await shelves(
        `${region}:${locale}:${category}:${realm}:${name}@${profileRevision(region, realm, name)}`,
        async () => {
          const { collected, faction } = await characterLog()
          return buildAchievementPage(category as AchievementCategory, locale, region, collected, faction)
        },
        force
      )
    }

    return await summaries(
      `${region}:${locale}:${realm}:${name}@${profileRevision(region, realm, name)}`,
      async () => {
        const { collected, faction } = await characterLog()
        return buildAchievementSummary(locale, collected, faction)
      },
      force
    )
  } catch (err) {
    mapBlizzardError(err, 'character achievements')
  }
})
