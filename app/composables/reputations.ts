/**
 * The reputation journal of the character whose page is open, read from the endpoint that assembles it.
 *
 * The journal is fetched through `useAsyncData` so a deep link carries it in the first response, and it
 * is keyed by the character and the language, so switching to Russian asks for the journal read in
 * Russian rather than re-drawing the English one. The two switches the shelf carries - the search box and
 * the one that hides the factions the character has not started - are deliberately *not* part of the key:
 * they filter rows the journal already holds, so flipping one never spends a request and the counters a
 * heading reads cannot move under it.
 */
import type { ReputationJournal } from '#shared/data/reputationsSchema'
import { useCharacterView } from './characterView'

export function useReputationJournal() {
  const { region, realm, name, apiLocale } = useCharacterView()

  return useAsyncData<ReputationJournal | null>(
    () => `reputations:${region}:${realm}:${name}:${apiLocale.value}`,
    () => $fetch<ReputationJournal>(`/api/reputations/${region}/${realm}/${name}?locale=${apiLocale.value}`),
    {
      default: () => null,
      watch: [apiLocale]
    }
  )
}
