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
 * What a shelf holds is the character's own journal, and deliberately not the account's union of
 * collections that the tiles and the hall of fame's rows print (`server/utils/accountPool`, `bestFigures`).
 * A shelf is read by somebody standing in the game on that character, comparing themselves against what
 * *that* character can get and use - which is what the profile's faction is read for - so a shelf may hold
 * fewer items than the account-wide tile above it, and the legend every shelf page carries says as much in
 * the reader's own words (`collectionsLegendAvailableText`, `collectionsLegendGameText`).
 *
 * A reader may read any character's shelf as the *account's* instead (`?byAccount=1`, which the shelf page's own
 * switch sends): a WoW collection is shared across every character of a Battle.net account, and the account's
 * own ids were read into the site's pool when that account signed in - the same pool for every reader. Two
 * rules make that safe and honest:
 *
 *   1. **The account's list has to be on the site.** The flag is honoured for a character whose account the
 *      site holds a pool for (`accountOwnerId`), whoever is reading: the account-wide figure is already
 *      printed on every character page for everybody - the tiles above a shelf are overlaid with the pool - so
 *      a shelf showing which items that figure is made of tells a reader nothing the page has not said. A
 *      character whose account has never signed in, or whose account holds no list of that collection, is
 *      answered with the character's own shelf; the page draws no switch where there is nothing to read with
 *      it (`CollectionPage.accountAvailable`).
 *   2. **The answer says which it is.** The `account` flag in the payload is `true` only when the account's
 *      ids were really used; a collection the site has never read for that account - Blizzard refuses the
 *      account's decorations today - falls back to the character's journal and says `false`, so a page can
 *      tell "nought collected" from "nothing known".
 *
 * An account's shelf is cached under a key carrying that account's user id, so the two views of one character
 * can never be served to each other's readers - and the key names the *account*, not the reader, because the
 * answer is the same for both.
 *
 * Two switches go into a shelf's key as well, because they change what the shelf holds:
 * `?unobtainable=1` draws the items the game has done away with and `?upcoming=1` the ones it has not
 * shipped yet, which are SimpleArmory's own two settings under the same names. A request without a
 * `?kind=` is the summary - the running total and a row per shelf - which the root page draws.
 */
import { ACCOUNT_SHELF_KINDS, COLLECTION_KINDS } from '#shared/data/collectionsSchema'
import type {
  CollectionKind,
  CollectionPage,
  CollectionSummary,
  CollectionViewOptions
} from '#shared/data/collectionsSchema'
import { apiLocale, mapBlizzardError, parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'
import { profileRevision } from '~~/server/utils/profileRevision'
import { collectionReadSource, runWithBlizzardSource } from '~~/server/utils/blizzardSource'
import type { H3Event } from 'h3'

const shelves = createSwrCache<CollectionPage>(2 * 60 * 60 * 1000, 64, {
  persist: createSqliteStore('collections-shelf', jsonCodec<CollectionPage>(), { maxRows: 300, maxAgeMs: 6 * 60 * 60 * 1000 })
})
const summaries = createSwrCache<CollectionSummary>(2 * 60 * 60 * 1000, 100)

export default defineEventHandler((event) =>
  runWithBlizzardSource(collectionReadSource(parseBoolFlag(getQuery(event).force)), () => readCollections(event))
)

/** The shelf itself, under the tag its caller earned: a page view, or the reader's own Refresh. */
async function readCollections(event: H3Event) {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = apiLocale(query)
  const kind = query.kind ? String(query.kind) : ''
  const force = parseBoolFlag(query.force)
  /**
   * How much of the shelf this request is answered with (the rule itself is `selectCollectionView`).
   *
   * A shelf is every collectable in the game, so the whole of it is the largest document the site sends -
   * and a page opens on one section. `sections=first` is what the shelf page asks for as it is rendered,
   * and `section=<id>` what it asks for as a section is scrolled to. Neither is part of the cache key
   * below, so both are answered from the one shelf assembled there: a reader who walks every section still
   * costs one read of Blizzard and one assembly.
   */
  const sectionsParam = typeof query.sections === 'string' ? query.sections : ''
  const sectionParam = typeof query.section === 'string' ? query.section : ''
  const view: CollectionViewOptions = {
    unobtainable: parseBoolFlag(query.unobtainable),
    upcoming: parseBoolFlag(query.upcoming),
    byAccount: parseBoolFlag(query.byAccount)
  }

  // A forced refresh spends Blizzard's quota on purpose, so it is charged to whoever asked for it before any
  // of the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)
  if (kind && !isCollectionKind(kind)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown collection "${kind}"` })
  }

  /**
   * Whose account-wide list this request may be answered with, when the site holds one.
   *
   * The row is the site's own (`accountOwnerId`): a pool belongs to the account that holds the character being
   * read, and it is the same pool for every reader. `accountAvailable` is that fact on its own, which is what a
   * page is told so it draws the switch only where pressing it can do something; `accountView` is the same row
   * read *because the reader asked for it* (`?byAccount=1`), which is what the ids are actually taken from - a
   * request without the flag is this character's shelf whoever it is from, and `null` there is what makes the
   * answer say so.
   */
  const poolOwner = accountOwnerId(region, realm, name)
  const accountAvailable = poolOwner !== null
  const accountView = view.byAccount ? poolOwner : null

  try {
    // Without a `kind` the request is for the summary: every shelf at once, under the default view.
    if (!kind) {
      // The shelves the site has read the account's own ids for, which may be some of them: decorations
      // are never among them (Blizzard's account collection endpoint refuses them) and a collection the
      // site has not read yet is not either. What is missing falls back to this character's journal, shelf
      // by shelf, and the answer says which is which.
      const pooled = accountView !== null ? accountCollectedByKind(accountView) : {}
      const accountKinds = new Set(
        ACCOUNT_SHELF_KINDS.filter((shelf) => Boolean(pooled[shelf]))
      ) as Set<CollectionKind>
      const account = accountKinds.size > 0

      return await summaries(
        `${region}:${locale}:${realm}:${name}${account ? `:a${accountView}` : ''}@${profileRevision(region, realm, name)}`,
        async () => {
          // The character is read for its faction and for the shelves the pool has nothing for - and the
          // shelves it *does* have are counted without a faction, which is what makes them the account's.
          const character = await getCharacter(realm, name, region, locale, force)
          const own = await getCollectedByKind(region, realm, name, locale)
          const collectedByKind = Object.fromEntries(
            COLLECTION_KINDS.map((shelf) => [shelf, pooled[shelf] || own[shelf]])
          ) as Record<CollectionKind, Set<number>>

          return {
            ...buildCollectionSummary(locale, collectedByKind, character?.faction ?? null, accountKinds),
            account,
            accountAvailable
          }
        },
        force
      )
    }

    const pooled = accountView !== null ? accountCollectedIds(accountView, kind as CollectionKind) : null
    const account = pooled !== null

    // The whole shelf is assembled here and kept by the store; what travels is the slice this request
    // named. The projection sits *after* the cache on purpose - and it copies rather than edits - so the
    // shelf in the store is never written to and every read (the first response and each section the page
    // asks for as it is scrolled to) is served from that one assembled shelf.
    const page = await shelves(
      `${region}:${locale}:${kind}:${realm}:${name}:${view.unobtainable ? 'u' : ''}${view.upcoming ? 'p' : ''}` +
        `${account ? `:a${accountView}` : ''}@${profileRevision(region, realm, name)}`,
      async () => {
        // The character is read for its faction as well as for its ids: an item only the other side
        // can hold is not on this shelf at all. It is the same profile the shell above the view
        // fetches, from the same ten-minute cache, so a visitor reading a character pays one read -
        // while the account's own shelf pays none, both its ids and its lack of a faction coming from
        // the site: the account's pool, and the fact that an account plays both sides.
        const character = account ? null : await getCharacter(realm, name, region, locale, force)
        const collected = pooled || (await getCollectedIds(region, realm, name, kind as CollectionKind, locale))

        return {
          ...buildCollectionPage(kind as CollectionKind, locale, region, collected, character?.faction ?? null, view),
          account,
          accountAvailable
        }
      },
      force
    )

    return selectCollectionView(page, { sections: sectionsParam, section: sectionParam })
  } catch (err) {
    mapBlizzardError(err, 'character collections')
  }
}
