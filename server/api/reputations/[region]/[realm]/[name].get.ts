/**
 * A character's reputation journal: every faction they can work on, filed the way the game's reputation
 * pane files them, with the stage the character stands on and the scale of each ladder.
 *
 * **The journal is one character's**, and the account's reading of it (`?byAccount=1`, which the shelf's own
 * switch sends) is the account's: the pool of ladders *some* character of it has finished
 * (`server/utils/accountPool`, the same pool the reputations tile and the site's score are read from) is what
 * the rows are marked and counted from, and the reading draws *both sides* for it - a faction an alt of the
 * other faction finished is part of the account, and a figure the reader cannot find on the list below would
 * be no figure at all. Its `total` is therefore every ladder of the atlas
 * (`reputationReachableTotal`) rather than the one side a character can raise, which is the same pair of
 * numbers the tile above the shelf prints. Every stage and every span stays the character's own: a ladder is
 * a character's, and the site holds no other character's (it would cost a Blizzard read per alt to know
 * them). The journal is folded against the payload of the character named in the address -
 * `/profile/wow/character/{realm}/{name}/reputations`, one call to Blizzard.
 *
 * The catalogue it is folded against is static and shipped with the build (`server/utils/reputations-data.json`,
 * built by `scripts/refresh-reputations.mjs`), so the only thing paid for per request is that one call and
 * the assembly of the groups. A journal that has just been assembled is handed straight to the next caller
 * for two hours and revalidated behind the request that finds it stale - the same window and the same
 * store the profile, the card, a collection shelf and the feed are served from - while a `?force=true`
 * request waits for a freshly assembled one.
 *
 * The switches a reader flips on the shelf - the search box and the two that hide the factions the character
 * has not started, or has already finished - are the view's own and never reach this endpoint: they filter
 * rows the journal already holds, so the counters a heading reads cannot change under a filter. What the
 * endpoint takes from the query is the language and the scope (`?byAccount=1`), where the scope decides which
 * of the two readings the rows are folded for.
 */
import { accountOwnerId, readAccountIds } from '~~/server/utils/accountPool'
import type { ReputationJournal } from '#shared/data/reputationsSchema'
import { apiLocale, mapBlizzardError, parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'
import { collectionReadSource, runWithBlizzardSource } from '~~/server/utils/blizzardSource'
import type { H3Event } from 'h3'
import { profileRevision } from '~~/server/utils/profileRevision'

const journals = createSwrCache<ReputationJournal>(2 * 60 * 60 * 1000, 64, {
  persist: createSqliteStore('reputations-journal', jsonCodec<ReputationJournal>(), { maxRows: 300, maxAgeMs: 6 * 60 * 60 * 1000 })
})

export default defineEventHandler((event) =>
  runWithBlizzardSource(collectionReadSource(parseBoolFlag(getQuery(event).force)), () => readReputations(event))
)

/** The journal itself, under the tag its caller earned: a page view, or the reader's own Refresh. */
async function readReputations(event: H3Event) {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = apiLocale(query)
  const force = parseBoolFlag(query.force)

  // A forced refresh spends Blizzard's quota on purpose, so it is charged to whoever asked for it before any
  // of the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)

  /**
   * The account's pool of finished factions, and whether the site holds one for this character's account.
   *
   * `accountAvailable` is that fact on its own, which is what a page draws the switch from - offered wherever
   * pressing it can do something - and `accountFinished` is the same pool read *because the reader asked for
   * the account's journal* (`?byAccount=1`), which is what the rows are marked from. The pool belongs to the
   * account that holds the character, not to whoever is reading: the collections endpoint is answered on the
   * same terms (`server/api/collections/[region]/[realm]/[name].get.ts`).
   */
  const poolOwner = accountOwnerId(region, realm, name)
  const poolIds = poolOwner !== null ? readAccountIds(poolOwner, 'reputations') : null
  const accountAvailable = Boolean(poolIds && poolIds.size)
  const accountFinished = parseBoolFlag(query.byAccount) && accountAvailable ? poolIds : null

  try {
    return await journals(
      `${region}:${locale}:${realm}:${name}${accountFinished ? `:a${poolOwner}` : ''}@${profileRevision(region, realm, name)}`,
      async () => {
        // The character is read for its faction as well as for its reputations: a faction only the other
        // side may raise is not on this journal at all. It is the same profile the shell above the view
        // fetches, from the same ten-minute cache, so a visitor reading a character pays one read.
        const [character, standings] = await Promise.all([
          getCharacter(realm, name, region, locale, force),
          getReputationStandings(region, realm, name, locale)
        ])

        return {
          ...buildReputationJournal(locale, standings, character.faction, accountFinished),
          account: accountFinished !== null,
          accountAvailable
        }
      },
      force
    )
  } catch (err) {
    mapBlizzardError(err, 'character reputations')
  }
}
