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
import type {
  CollectionKind,
  CollectionPage,
  CollectionSection,
  CollectionSummary,
  CollectionViewOptions
} from '#shared/data/collectionsSchema'
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

  /**
   * The query every read of this shelf carries - the shelf, the language and the three switches. The first
   * response adds `sections=first` to it and each later read adds `section=<id>`; the switches are the same
   * in both, which is what makes the two slices of one shelf rather than two different shelves.
   */
  function baseQuery(): URLSearchParams {
    const query = new URLSearchParams({ kind: kind(), locale: apiLocale.value })
    if (flags.value.unobtainable) query.set('unobtainable', '1')
    if (flags.value.upcoming) query.set('upcoming', '1')
    if (flags.value.byAccount) query.set('byAccount', '1')
    return query
  }

  /**
   * Which shelf is on screen, as a number that changes whenever the answer does.
   *
   * A read of one section is slower than a click, so a reader who steps to another kind - or another
   * character - can have a section for the shelf they left still on the wire. Carrying this stamp across the
   * await is what lets the late answer be dropped rather than folded into the new page.
   */
  let shelf = 0

  /** The sections whose tiles were read back after the first response, by id. */
  const loaded = reactive(new Map<string, CollectionSection>())

  /** The ids whose read is in flight, so two reveals of one section never become two requests. */
  const loading = new Set<string>()

  const result = useAsyncData<CollectionPage | null>(
    () =>
      `collection:${kind()}:${region}:${realm}:${name}:${apiLocale.value}:` +
      `${flags.value.unobtainable ? 'u' : ''}${flags.value.upcoming ? 'p' : ''}${flags.value.byAccount ? 'a' : ''}`,
    () => {
      const query = baseQuery()
      // Only the shelf's first section of tiles travels with the document; the rest are read as the page is
      // scrolled to them (`loadSection`). The headings, the bars and the quick anchors are carried either
      // way, so the page is complete - and navigable - the moment it is painted.
      query.set('sections', 'first')
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

  // A new shelf - another kind, another language, a flipped switch, another character - is a new answer, and
  // the sections read for the old one go with it (and any answer still in flight is dropped by the stamp).
  watch(result.data, () => {
    shelf += 1
    loaded.clear()
  })

  /** The shelf as the page draws it: the first response, with every section read since folded in. */
  const sections = computed<CollectionSection[]>(() =>
    (result.data.value?.sections ?? []).map((section) => loaded.get(section.id) ?? section)
  )

  /**
   * Reads one section's tiles, and answers whether the page now holds them.
   *
   * A section already on hand, or one already being read, is a no-op: a scroll that crosses a section twice,
   * or two reveals of it in the same tick, cost one request between them. An answer that belongs to a shelf
   * the reader has already left is dropped, so flicking between characters can never paint one's tiles into
   * the other's page. `false` is returned when the read did not produce tiles, which is what tells the grid
   * to offer the section again rather than leave it empty for good.
   */
  async function loadSection(id: string): Promise<boolean> {
    if (loaded.has(id)) return true
    if (loading.has(id)) return false

    const asked = shelf
    loading.add(id)

    try {
      const query = baseQuery()
      query.set('section', id)
      const page = await $fetch<CollectionPage>(`/api/collections/${region}/${realm}/${name}?${query}`)

      if (asked !== shelf) return false

      const section = page.sections.find((entry) => entry.id === id)
      if (!section) return false

      loaded.set(id, section)
      return true
    } catch {
      // The section is left as it was; the grid re-offers it the next time it comes into view.
      return false
    } finally {
      loading.delete(id)
    }
  }

  // `useAsyncData` answers with a *thenable* object, and spreading one copies its `then`, `catch` and
  // `finally` along with its fields. A caller's `await` would then call that `then` and be handed the
  // AsyncData object again - the plain half, without the two things added here - which is exactly how a
  // section reader used to arrive undefined. So the thenable half is left behind: what is returned is a
  // plain object, `await` hands it back untouched, and the caller keeps `sections` and `loadSection`.
  const { then: _then, catch: _catch, finally: _finally, ...plain } = result as typeof result &
    Record<string, unknown>

  return { ...plain, sections, loadSection }
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
