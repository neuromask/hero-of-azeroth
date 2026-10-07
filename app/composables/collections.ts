/**
 * One shelf of a character's collections, read from the endpoint that assembles it.
 *
 * The shelf is fetched through `useAsyncData` so a deep link carries it in the first response, and
 * it is keyed by the kind and the language, so a switch between mounts, pets and toys - which reuse
 * the one view component under the shell - re-reads rather than showing the shelf before it.
 */
import type { CollectionKind, CollectionPage } from '#shared/data/collectionsSchema'
import { useCharacterView } from './characterView'

export function useCollection(kind: () => CollectionKind) {
  const { region, realm, name, apiLocale } = useCharacterView()

  return useAsyncData<CollectionPage | null>(
    () => `collection:${kind()}:${region}:${realm}:${name}:${apiLocale.value}`,
    () =>
      $fetch<CollectionPage>(
        `/api/collections/${region}/${realm}/${name}?kind=${kind()}&locale=${apiLocale.value}`
      ),
    { default: () => null, watch: [() => kind(), apiLocale] }
  )
}