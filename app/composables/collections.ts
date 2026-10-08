/**
 * One shelf of a character's collections, read from the endpoint that assembles it.
 *
 * The shelf is fetched through `useAsyncData` so a deep link carries it in the first response, and it
 * is keyed by the kind, the language and the two switches the view carries - mounts, pets and toys
 * reuse the one view component under the shell, and flipping a switch asks the endpoint for the shelf
 * that switch describes (`?unobtainable=1`, `?upcoming=1`), so the numbers change with the request
 * rather than being filtered here.
 */
import type { CollectionKind, CollectionPage, CollectionViewOptions } from '#shared/data/collectionsSchema'
import { useCharacterView } from './characterView'

export function useCollection(kind: () => CollectionKind, view: Ref<CollectionViewOptions>) {
  const { region, realm, name, apiLocale } = useCharacterView()

  /** The switches as the endpoint and the key read them: whether each is on. */
  const flags = computed(() => ({
    unobtainable: Boolean(view.value.unobtainable),
    upcoming: Boolean(view.value.upcoming)
  }))

  return useAsyncData<CollectionPage | null>(
    () =>
      `collection:${kind()}:${region}:${realm}:${name}:${apiLocale.value}:` +
      `${flags.value.unobtainable ? 'u' : ''}${flags.value.upcoming ? 'p' : ''}`,
    () => {
      const query = new URLSearchParams({ kind: kind(), locale: apiLocale.value })
      if (flags.value.unobtainable) query.set('unobtainable', '1')
      if (flags.value.upcoming) query.set('upcoming', '1')
      return $fetch<CollectionPage>(`/api/collections/${region}/${realm}/${name}?${query}`)
    },
    {
      default: () => null,
      watch: [() => kind(), apiLocale, () => flags.value.unobtainable, () => flags.value.upcoming]
    }
  )
}
