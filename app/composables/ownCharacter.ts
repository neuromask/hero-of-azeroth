/**
 * Whether the character a page is about belongs to the account this browser is signed in as.
 *
 * The site has one view that is the reader's own and nobody else's: a collection shelf read as the whole
 * account's rather than as one character's (`CollectionViewOptions.byAccount`). It is read from Blizzard with
 * that reader's own token and drawn from the site's pool of the account's ids - a private roster of alts - so
 * the server refuses it for everybody else (`server/api/collections/[...]`). This is the same rule one layer
 * up, where a page decides whether to draw the switch at all: offering a control that can do nothing is worse
 * than not offering it, and a guest has no account to read.
 *
 * It costs no request: `/api/profile` is what the header's account plate, the profile page and the front
 * door already read, under one key, so a character page pays for no second one - and the roster in the answer
 * is exactly the list of characters that account holds.
 */
import { useCharacterView } from './characterView'

export function useOwnCharacter() {
  const { region, realm, name } = useCharacterView()

  const { data } = useFetch<{
    user: unknown | null
    characters: { region: string; realmSlug: string; name: string }[]
  }>('/api/profile', { key: 'profile-identity' })

  return computed(() => {
    if (!data.value?.user) return false

    // The identity is the one an address is written in: the region, the realm's slug and the name, all
    // three lowercased, because the roster stores the name as Blizzard spelled it and an address carries
    // whatever the reader's keyboard produced.
    const wanted = `${region}:${realm}:${name}`.toLowerCase()
    return (data.value.characters || []).some(
      (entry) => `${entry.region}:${entry.realmSlug}:${entry.name}`.toLowerCase() === wanted
    )
  })
}