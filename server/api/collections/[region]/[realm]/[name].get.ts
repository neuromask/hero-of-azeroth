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
 * A reader who is signed in may read their own character's shelf as the *account's* instead (`?byAccount=1`,
 * which the shelf page's own switch sends): a WoW collection is shared across every character of a Battle.net
 * account, and the account's own ids were read into the site's pool when that reader signed in. Three rules
 * make that safe and honest:
 *
 *   1. **Only the owner.** The flag is honoured for the reader whose account holds the character being viewed
 *      (`accountOwnerId`) and for nobody else: the pool is a private roster of alts, and the ids in it were
 *      read with that reader's own Blizzard token. For everybody else the flag is ignored and the answer is
 *      the character's own shelf - a link copied out of a signed-in browser opens the usual shelf for
 *      whoever it reaches.
 *   2. **The answer says which it is.** The `account` flag in the payload is `true` only when the account's
 *      ids were really used; a collection the site has never read for that account - Blizzard refuses the
 *      account's decorations today - falls back to the character's journal and says `false`, so a page can
 *      tell "nought collected" from "nothing known".
 *   3. **The cache is the reader's.** An account's shelf is cached under a key carrying that account's user
 *      id, so the two views of one character can never be served to each other's readers.
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
    upcoming: isOn(query.upcoming),
    byAccount: isOn(query.byAccount)
  }

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }
  if (kind && !isCollectionKind(kind)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown collection "${kind}"` })
  }

  /**
   * Whose ids this request may be answered with: the reader's own account's, or this character's.
   *
   * Both halves are read here rather than taken from the address - the session is the reader's, and the
   * roster row is the site's - and a reader who asks for an account they do not own is simply answered with
   * the character's shelf. `null` therefore means "this is not your account's shelf to read", which is the
   * answer for every guest, every stranger's character, and every collection the account's pool has nothing
   * for.
   */
  const reader = view.byAccount ? await getCurrentUser(event) : null
  const accountView = reader !== null && accountOwnerId(region, realm, name) === reader.id ? reader.id : null

  try {
    // Without a `kind` the request is for the summary: every shelf at once, under the default view.
    if (!kind) {
      const pooled = accountView !== null ? accountCollectedByKind(accountView) : null
      const account = pooled !== null

      return await summaries(
        `${region}:${locale}:${realm}:${name}${account ? `:a${accountView}` : ''}`,
        async () => {
          // The character is read only for the shelf that needs it: the account's numbers are the
          // account's, and reading Blizzard for a faction they are not filtered by would be a call
          // bought for nothing.
          const character = account ? null : await getCharacter(realm, name, region, locale)
          const collectedByKind = pooled || (await getCollectedByKind(region, realm, name, locale))

          return {
            ...buildCollectionSummary(locale, collectedByKind, character?.faction ?? null),
            account
          }
        },
        force
      )
    }

    const pooled = accountView !== null ? accountCollectedIds(accountView, kind) : null
    const account = pooled !== null

    return await shelves(
      `${region}:${locale}:${kind}:${realm}:${name}:${view.unobtainable ? 'u' : ''}${view.upcoming ? 'p' : ''}` +
        `${account ? `:a${accountView}` : ''}`,
      async () => {
        // The character is read for its faction as well as for its ids: an item only the other side
        // can hold is not on this shelf at all. It is the same profile the shell above the view
        // fetches, from the same ten-minute cache, so a visitor reading a character pays one read -
        // while the account's own shelf pays none, both its ids and its lack of a faction coming from
        // the site: the account's pool, and the fact that an account plays both sides.
        const character = account ? null : await getCharacter(realm, name, region, locale)
        const collected = pooled || (await getCollectedIds(region, realm, name, kind, locale))

        return {
          ...buildCollectionPage(kind, locale, region, collected, character?.faction ?? null, view),
          account
        }
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