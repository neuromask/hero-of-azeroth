/**
 * The characters this browser - or, for a reader who is signed in, this account - has saved for a quick
 * comparison.
 *
 * Comparing two characters is an act a reader repeats - the same rival, the same guildmate, the same alt
 * week after week - and typing a name and a realm again for every look is the whole cost of it. So the
 * comparison page offers the same gesture the account page offers for a main: a star, and the character
 * behind it is kept (`app/pages/profile.vue`). What is saved here is that list, and it is exactly the shape
 * a remembered search has (`#shared/utils/savedCharacters`) - the three segments of a character's address
 * plus the portrait and the class a chip draws them with - because it is the same thing remembered for a
 * different purpose. The reader is reused from there (`toSearchHistoryEntry`), so the two lists can never
 * disagree about what a character is.
 *
 * It is `useState` rather than a `ref` of its own, and that is load-bearing: the star is offered in two
 * places on one page - on the row of a looked-up character inside the search form, and on the card of the
 * character a page is comparing against (`app/components/CharacterVersus.vue`) - and both have to see the
 * one list as it changes. `useSearchHistory` keeps a private copy per component because a page only ever
 * reads it in one place; here the form writes a star and the board beside it must light up a moment later.
 *
 * The list is a convenience: bounded, deduplicated the way the search history is, and kept in `localStorage`
 * for a visitor. A reader who is signed in has it kept for their account as well, and it is the account's copy
 * that decides what is on screen once it has been read (`app/composables/savedCharacters.ts`).
 */
import {
  SAVED_STARRED_LIMIT,
  VERSUS_FAVORITES_KEY,
  readSavedEntries,
  searchHistoryKey,
  writeSavedEntries,
  type SearchHistoryEntry
} from '#shared/utils/savedCharacters'
import { accountSavedLists, pushStarredCharacter } from './savedCharacters'

/** How many characters the list holds, in the browser and on an account alike (`#shared/utils/savedCharacters`). */
export const VERSUS_FAVORITES_LIMIT = SAVED_STARRED_LIMIT

/**
 * The saved characters and the ways the list changes. Every instance shares one state, so a star pressed in
 * the search form is a chip lit on the board beside it without either of them telling the other.
 */
export function useVersusFavorites() {
  const favorites = useState<SearchHistoryEntry[]>(VERSUS_FAVORITES_KEY, () => [])

  /**
   * Reads what an earlier visit left behind, and then what the reader's account holds.
   *
   * The browser's own list is drawn first, so a page that has one never waits for a request to show it; then
   * the same list is read again once the account has answered, because the account's lists are handed to the
   * browser's copy on the way (`accountSavedLists` and the two reads of the same kind in `useSearchHistory`).
   * A visitor gets their own list back both times, which is what they had before there was an account at all.
   */
  const load = async () => {
    favorites.value = readSavedEntries(VERSUS_FAVORITES_KEY)
    await accountSavedLists()
    favorites.value = readSavedEntries(VERSUS_FAVORITES_KEY)
  }

  /** Whether this character is already saved, by the same key the list is deduplicated on. */
  const has = (entry: { region: string; realm: string; name: string }): boolean => {
    const key = searchHistoryKey(entry)
    return favorites.value.some((saved) => searchHistoryKey(saved) === key)
  }

  /**
   * Saves a character at the front of the list. Reads the stored list rather than the in-memory copy, so a
   * component that never called `load` cannot overwrite the rest of the list with one entry - the same rule
   * `useSearchHistory.remember` follows. A character that is already saved keeps its place rather than being
   * written twice. The star then goes to the reader's account, if they have one.
   */
  const add = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const rest = readSavedEntries(VERSUS_FAVORITES_KEY).filter((saved) => searchHistoryKey(saved) !== key)
    const next = [entry, ...rest].slice(0, VERSUS_FAVORITES_LIMIT)

    writeSavedEntries(VERSUS_FAVORITES_KEY, next)
    favorites.value = next
    pushStarredCharacter(entry, true)
  }

  /**
   * Drops one character, by the triple the list is unique on - from the account as well, where the star is
   * cleared rather than the row deleted: the character may still be one the account looked up, and that half
   * of the list is not this one's to take away (`app/composables/searchHistory.ts` forgets a row entirely).
   */
  const remove = (entry: { region: string; realm: string; name: string }) => {
    const key = searchHistoryKey(entry)
    const next = readSavedEntries(VERSUS_FAVORITES_KEY).filter((saved) => searchHistoryKey(saved) !== key)

    writeSavedEntries(VERSUS_FAVORITES_KEY, next)
    favorites.value = next
    pushStarredCharacter(entry, false)
  }

  /** What the star does: saves a character that is not saved, and drops the one that is. */
  const toggle = (entry: SearchHistoryEntry) => {
    if (has(entry)) remove(entry)
    else add(entry)
  }

  return { favorites, load, has, add, remove, toggle }
}
