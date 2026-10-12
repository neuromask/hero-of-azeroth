/**
 * The characters this browser has saved for a quick comparison.
 *
 * Comparing two characters is an act a reader repeats - the same rival, the same guildmate, the same alt
 * week after week - and typing a name and a realm again for every look is the whole cost of it. So the
 * comparison page offers the same gesture the account page offers for a main: a star, and the character
 * behind it is kept (`app/pages/profile.vue`). What is saved here is that list, and it is exactly the shape
 * a remembered search has (`app/composables/searchHistory.ts`) - the three segments of a character's address
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
 * The list never leaves the browser: it is a convenience, kept in `localStorage`, bounded and deduplicated
 * the way the search history is.
 */
import { searchHistoryKey, toSearchHistoryEntry, type SearchHistoryEntry } from './searchHistory'

/** Where the list is kept, and how many characters it holds. */
export const VERSUS_FAVORITES_KEY = 'hoa_versus_favorites'
export const VERSUS_FAVORITES_LIMIT = 12

/**
 * A browser can refuse storage outright - a private window, site data blocked - so both directions are
 * wrapped: without it the star simply remembers nothing and everything else keeps working.
 */
function readStorage(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(VERSUS_FAVORITES_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(toSearchHistoryEntry).filter((entry): entry is SearchHistoryEntry => entry !== null)
  } catch {
    return []
  }
}

function writeStorage(entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(VERSUS_FAVORITES_KEY, JSON.stringify(entries))
  } catch {
    // Nothing to do: losing the list breaks nothing.
  }
}

/**
 * The saved characters and the ways the list changes. Every instance shares one state, so a star pressed in
 * the search form is a chip lit on the board beside it without either of them telling the other.
 */
export function useVersusFavorites() {
  const favorites = useState<SearchHistoryEntry[]>(VERSUS_FAVORITES_KEY, () => [])

  /** Reads what an earlier visit left behind. Call it from `onMounted`, when there is storage. */
  const load = () => {
    favorites.value = readStorage()
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
   * written twice.
   */
  const add = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const rest = readStorage().filter((saved) => searchHistoryKey(saved) !== key)
    const next = [entry, ...rest].slice(0, VERSUS_FAVORITES_LIMIT)

    writeStorage(next)
    favorites.value = next
  }

  /** Drops one character, by the triple the list is unique on. */
  const remove = (entry: { region: string; realm: string; name: string }) => {
    const key = searchHistoryKey(entry)
    const next = readStorage().filter((saved) => searchHistoryKey(saved) !== key)

    writeStorage(next)
    favorites.value = next
  }

  /** What the star does: saves a character that is not saved, and drops the one that is. */
  const toggle = (entry: SearchHistoryEntry) => {
    if (has(entry)) remove(entry)
    else add(entry)
  }

  return { favorites, load, has, add, remove, toggle }
}
