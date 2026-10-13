/**
 * The characters this browser has looked up.
 *
 * A search that found its character is worth keeping: the front page can then offer the name
 * to type and the realm to search it on. The list is a convenience rather than a log, so it is
 * bounded, deduplicated and kept in `localStorage` - it outlives the tab, which is what makes
 * it useful next visit.
 *
 * A reader who is signed in has the same list kept for their account as well, and it is the account's copy
 * that decides what is on screen once it has been read: every page brings the browser's copy into step with it
 * (`app/composables/savedCharacters.ts`, which reads `/api/saved` and hands the browser's own list over the
 * first time). Nothing about that changes a visitor's list - it is the browser's own, exactly as it was before
 * there was an account - and nothing about it changes what a *successful* search means here.
 *
 * `remember` is called wherever a search proves successful, which is wherever a character was actually
 * found: a character's own page, once it has rendered one (`app/pages/[region]/[realm]/[name].vue`), and
 * the comparison board, once it has read the character it compares against - a second character is looked
 * up without a page of its own ever being opened (`app/components/CharacterVersus.vue`). A miss remembers
 * nothing, so a mistyped name never reaches the list. Every search field on the site reads the same list
 * under its name field (`app/components/CharacterSearchForm.vue`).
 */
import {
  SAVED_RECENT_LIMIT,
  SEARCH_HISTORY_KEY,
  readSavedEntries,
  searchHistoryKey,
  writeSavedEntries,
  type SearchHistoryEntry
} from '#shared/utils/savedCharacters'
import { accountSavedLists, pushForgottenCharacter, pushLookedUpCharacter } from './savedCharacters'

/** How many characters the list holds, in the browser and on an account alike (`#shared/utils/savedCharacters`). */
export const SEARCH_HISTORY_LIMIT = SAVED_RECENT_LIMIT

/**
 * The list of searched characters and the ways it changes. Every instance keeps its own copy, because a page
 * fills its own on mount and reads it in one place (`app/components/MyProfile.vue`,
 * `app/pages/index.vue`) - and every copy reads the same two sources, so no two of them can disagree about
 * what the reader has looked at.
 */
export function useSearchHistory() {
  const history = ref<SearchHistoryEntry[]>([])

  /**
   * Reads what an earlier visit left behind, and then what the reader's account holds.
   *
   * The browser's own list is read first, so a field that has one never waits for a request to draw it; then
   * the same list is read again once the account has answered, because the account's two lists are handed to
   * the browser's copy on the way (`accountSavedLists`). For a visitor both reads return the same list, and
   * for a reader whose account has none the second read returns an empty one, which is the honest answer.
   *
   * Call it from `onMounted`: there is no storage and no account on the server.
   */
  const load = async () => {
    history.value = readSavedEntries(SEARCH_HISTORY_KEY)
    await accountSavedLists()
    history.value = readSavedEntries(SEARCH_HISTORY_KEY)
  }

  /**
   * Puts a character at the front of the list: the pair it is unique on is dropped from
   * wherever it sat, and the oldest past the limit falls off the end. Reads the stored list
   * rather than the in-memory copy, so a page that never called `load` - the character page,
   * which only writes - cannot overwrite the rest of the history with one entry. The same fact
   * then goes to the reader's account, if they have one.
   */
  const remember = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const rest = readSavedEntries(SEARCH_HISTORY_KEY).filter((existing) => searchHistoryKey(existing) !== key)
    const next = [entry, ...rest].slice(0, SEARCH_HISTORY_LIMIT)

    writeSavedEntries(SEARCH_HISTORY_KEY, next)
    history.value = next
    pushLookedUpCharacter(entry)
  }

  /**
   * Drops one character, by the pair the list is unique on.
   *
   * On the account the row goes entirely rather than only its lookup, because that is what the cross means to
   * the reader who pressed it: not this one any more, in either list (`app/components/CharacterSearchForm.vue`
   * takes the star off the same row).
   */
  const forget = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const next = readSavedEntries(SEARCH_HISTORY_KEY).filter((existing) => searchHistoryKey(existing) !== key)

    writeSavedEntries(SEARCH_HISTORY_KEY, next)
    history.value = next
    pushForgottenCharacter(entry)
  }

  return { history, load, remember, forget }
}
