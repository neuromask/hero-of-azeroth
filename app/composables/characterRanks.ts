/**
 * The places the character a page is about holds in the site's rankings, and the address of a ranking turned to the
 * one it holds in it.
 *
 * It is the composable behind every door a character's page opens into a table: the six stat tiles beside the
 * character, the six figures of the drawer under the summary plate, and the rating itself. Each of those prints one
 * figure of one character, and each is a link into the ranking of that very figure (`metricLeaderboardPath`) - and
 * a reader who pressed "Mounts 1 266" wants the mount ranking *at their own row*, not at its first page. So the
 * address carries their place (`?rank=N`, `app/composables/metricLeaderboard`) and the table opens the page that
 * holds it and brings the row into view.
 *
 * The places arrive in one answer for the whole page (`/api/leaderboard/character-ranks`), read while the page is
 * rendered rather than after it: what a link points at is part of what the server renders, so the rows a reader
 * follows it to are in the HTML (see the composable above, which is the mechanism this one writes addresses for).
 * A character the table does not hold - an alt that is neither its account's main nor a row of its own - answers
 * `null` in every ranking, and the door falls back to the ranking's own address, plain, because there is no row to
 * turn to.
 *
 * The key is the character, lowercased the way the table keys a row, so every component of one page reads one
 * answer whatever the spelling of the address it was handed.
 */
import type { Ref } from 'vue'
import { metricLeaderboardPath, metricLeaderboardRankQuery } from './metricLeaderboard'
import { useCharacterView } from './characterView'
import type { CharacterRanks, MetricLeaderboardSlug } from '#shared/data/leaderboardSchema'

/** A link into a ranking: its address, and the place in it when the character holds one. */
export interface CharacterRankLink {
  path: string
  query?: Record<string, string>
}

export interface CharacterRanksView {
  /** The places themselves, for a page that wants to print one rather than link to it. */
  ranks: Ref<CharacterRanks | undefined>
  /**
   * Where one figure's ranking stands, turned to the place this character holds in it.
   *
   * A `to` rather than a string, because a place travels as a query and the two halves of an address belong
   * together: a caller that built one of them itself could point at a place in a ranking it is not the ranking of.
   */
  urlFor: (slug: MetricLeaderboardSlug) => CharacterRankLink
}

export async function useCharacterRanks(): Promise<CharacterRanksView> {
  const { region, realm, name } = useCharacterView()
  const localeUrl = useLocaleUrl()

  // The key is the character, so two components of one page - and two views of one character - read one answer
  // rather than two, exactly as `/api/profile` is read under one key by the header and the page below it.
  const { data } = await useAsyncData<CharacterRanks>(
    () => `character-ranks:${region}:${realm}:${name}`.toLowerCase(),
    () => $fetch<CharacterRanks>('/api/leaderboard/character-ranks', { query: { region, realm, name } })
  )

  function urlFor(slug: MetricLeaderboardSlug): CharacterRankLink {
    const path = localeUrl(metricLeaderboardPath(slug))
    const place = data.value?.[slug]

    return place ? { path, query: metricLeaderboardRankQuery(place) } : { path }
  }

  return { ranks: data, urlFor }
}
