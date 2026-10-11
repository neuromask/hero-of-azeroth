/**
 * One shelf of a character's collections, read from the endpoint that assembles it.
 *
 * The shelf is fetched through `useAsyncData` so a deep link carries it in the first response, and it
 * is keyed by the kind, the language and the switches the view carries - mounts, pets and toys
 * reuse the one view component under the shell, and flipping a switch asks the endpoint for the shelf
 * that switch describes (`?unobtainable=1`, `?upcoming=1`), so the numbers change with the request
 * rather than being filtered here.
 *
 * The fourth switch travels the same way (`?byAccount=1`): whether the shelf is the whole account's rather
 * than this character's is the server's answer, not the browser's guess - it hands the same ids to the same
 * assembler - so asking for it is what changes the numbers, and the response says which of the two it ended
 * up being (`CollectionPage.account`).
 */
import { ACCOUNT_SHELF_KINDS } from '#shared/data/collectionsSchema'
import type { CollectionKind, CollectionPage, CollectionSummary, CollectionViewOptions } from '#shared/data/collectionsSchema'
import { useCharacterView } from './characterView'

export function useCollection(kind: () => CollectionKind, view: Ref<CollectionViewOptions>) {
  const { region, realm, name, apiLocale } = useCharacterView()

  /**
   * Whether this shelf's account-wide list may be asked for at all: only the ones Blizzard serves
   * (`ACCOUNT_SHELF_KINDS`). A decorated shelf is this character's own whatever the switch says, so the flag
   * is not sent for it - the endpoint would answer with the character's journal anyway, under a second cache
   * key for the same page.
   */
  const scoped = computed(() => ACCOUNT_SHELF_KINDS.includes(kind()))

  /** The switches as the endpoint and the key read them: whether each is on. */
  const flags = computed(() => ({
    unobtainable: Boolean(view.value.unobtainable),
    upcoming: Boolean(view.value.upcoming),
    byAccount: Boolean(view.value.byAccount) && scoped.value
  }))

  return useAsyncData<CollectionPage | null>(
    () =>
      `collection:${kind()}:${region}:${realm}:${name}:${apiLocale.value}:` +
      `${flags.value.unobtainable ? 'u' : ''}${flags.value.upcoming ? 'p' : ''}${flags.value.byAccount ? 'a' : ''}`,
    () => {
      const query = new URLSearchParams({ kind: kind(), locale: apiLocale.value })
      if (flags.value.unobtainable) query.set('unobtainable', '1')
      if (flags.value.upcoming) query.set('upcoming', '1')
      if (flags.value.byAccount) query.set('byAccount', '1')
      return $fetch<CollectionPage>(`/api/collections/${region}/${realm}/${name}?${query}`)
    },
    {
      default: () => null,
      watch: [
        () => kind(),
        apiLocale,
        () => flags.value.unobtainable,
        () => flags.value.upcoming,
        () => flags.value.byAccount
      ]
    }
  )
}

/**
 * The root page's read: every shelf at once, summarised. It asks the same endpoint as a shelf and
 * simply leaves the `kind` off, so the one endpoint answers both shapes and the server decides from
 * the request rather than the client naming two addresses.
 *
 * It takes the same view a shelf does, for the same reason: the account's shelf and the character's are two
 * readings of the site's own data, and a summary that ignored the choice above it would disagree with the
 * shelves it summarises.
 */
export function useCollectionSummary(view: Ref<CollectionViewOptions>) {
  const { region, realm, name, apiLocale } = useCharacterView()

  /** Whether the page is asking for the account's numbers, which is the one flag this read carries. */
  const byAccount = computed(() => Boolean(view.value.byAccount))

  return useAsyncData<CollectionSummary | null>(
    () => `collections:summary:${region}:${realm}:${name}:${apiLocale.value}${byAccount.value ? ':a' : ''}`,
    () =>
      $fetch<CollectionSummary>(
        `/api/collections/${region}/${realm}/${name}?locale=${apiLocale.value}${byAccount.value ? '&byAccount=1' : ''}`
      ),
    {
      default: () => null,
      watch: [apiLocale, byAccount]
    }
  )
}
