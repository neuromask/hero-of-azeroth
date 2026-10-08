/**
 * The two switches a shelf carries, kept for the visit and remembered in the browser.
 *
 * SimpleArmory's own pages carry the same pair - one uncovers the items the game has done away with,
 * the other the items it has not shipped yet - and the endpoint takes them as its `unobtainable` and
 * `upcoming` flags, so what a visitor asks for here is what that site reads with its own setting on.
 * Both are off to begin with, which is the shelf that site shows a first-time visitor, and a choice
 * made once is kept in `localStorage` so a collector who wants the retired items does not have to ask
 * for them again.
 *
 * The stored choice is read after the page has hydrated rather than while it is being set up: the
 * numbers in the response are the default shelf's, and reading storage mid-hydration would render a
 * different shelf than the one the server sent.
 */
import type { CollectionViewOptions } from '#shared/data/collectionsSchema'

/** Where the choice is remembered, next to the other settings a visitor's browser holds. */
export const COLLECTION_VIEW_KEY = 'collectionView'

export function useCollectionView() {
  const view = useState<CollectionViewOptions>('collectionView', () => ({
    unobtainable: false,
    upcoming: false
  }))

  onMounted(() => {
    if (!import.meta.client) return
    try {
      const stored = localStorage.getItem(COLLECTION_VIEW_KEY)
      if (stored) Object.assign(view.value, JSON.parse(stored))
    } catch {
      // A browser that refuses storage keeps the defaults: the switches still work for the visit.
    }
  })

  watch(
    view,
    (next) => {
      if (!import.meta.client) return
      try {
        localStorage.setItem(COLLECTION_VIEW_KEY, JSON.stringify(next))
      } catch {
        // Ditto: there is nothing to remember, and nothing to fail at.
      }
    },
    { deep: true }
  )

  return view
}
