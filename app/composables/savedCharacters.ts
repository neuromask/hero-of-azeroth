/**
 * The bridge between the two lists a browser keeps for itself and the same two lists kept for an account.
 *
 * A reader who is signed in has their lookups and their saved characters follow them from device to device,
 * which is the one thing `localStorage` cannot do. So on every page the browser's copy is brought into step
 * with the account's: read from `/api/saved`, handed over the first time (`SAVED_ACCOUNT_KEY` records that it
 * was), and then adopted as the browser's own - which is what keeps a reader's list working with no account
 * at all, and what leaves a reader who signs out with the list they were just looking at.
 *
 * A request that fails changes nothing. The browser's own lists are what a search field has always drawn, and
 * an endpoint that is slow, refused or broken leaves them exactly as they were: losing a list breaks nothing,
 * while failing a page over one would.
 */
import {
  SAVED_ACCOUNT_KEY,
  SEARCH_HISTORY_KEY,
  VERSUS_FAVORITES_KEY,
  readSavedEntries,
  readStoredText,
  writeSavedEntries,
  writeStoredText,
  type SearchHistoryEntry
} from '#shared/utils/savedCharacters'

/** The answer `/api/saved` gives: the two lists and the account they belong to, or a visitor. */
interface SavedListsResponse {
  signedIn: boolean
  account: string | null
  starred: SearchHistoryEntry[]
  recent: SearchHistoryEntry[]
}

/** What a reader's lists turned out to be: an account's, with the browser's copy handed over on the way. */
export interface AccountSavedLists {
  account: string
  starred: SearchHistoryEntry[]
  recent: SearchHistoryEntry[]
}

/**
 * The one answer a page load shares.
 *
 * More than one component on a page reads these lists - the header's chip, the front page, the search form -
 * and one reader is one answer: the request is made once and every caller after it waits on the same promise,
 * which is also what keeps the hand-over of a browser's own lists from happening twice.
 */
let answer: Promise<AccountSavedLists | null> | null = null

/**
 * The account's lists, with the browser's copy brought into step with them - or `null` when there is no account
 * to bring it into step with: a visitor, or an endpoint that did not answer.
 */
export function accountSavedLists(): Promise<AccountSavedLists | null> {
  if (!import.meta.client) return Promise.resolve(null)
  if (!answer) answer = resolveAccountSavedLists()
  return answer
}

/** The read, the hand-over and the adoption, in that order. */
async function resolveAccountSavedLists(): Promise<AccountSavedLists | null> {
  try {
    const first = await $fetch<SavedListsResponse>('/api/saved')
    if (!first.signedIn || !first.account) return null

    let lists = { starred: first.starred, recent: first.recent }

    if (!readStoredText(SAVED_ACCOUNT_KEY)) {
      await $fetch('/api/saved/import', {
        method: 'POST',
        body: {
          starred: readSavedEntries(VERSUS_FAVORITES_KEY),
          recent: readSavedEntries(SEARCH_HISTORY_KEY)
        }
      })
      writeStoredText(SAVED_ACCOUNT_KEY, first.account)

      // Read rather than merged here: the union the hand-over just made is the account's answer, and a list
      // assembled on this side would be a second opinion about the order of the reader's own list.
      const after = await $fetch<SavedListsResponse>('/api/saved')
      if (after.signedIn) lists = { starred: after.starred, recent: after.recent }
    }

    writeSavedEntries(VERSUS_FAVORITES_KEY, lists.starred)
    writeSavedEntries(SEARCH_HISTORY_KEY, lists.recent)

    return { account: first.account, ...lists }
  } catch {
    // The browser's own lists stand, exactly as they did before there was an account.
    return null
  }
}

/** The account this browser's lists belong to, or `null` when they belong to nobody. */
function account(): Promise<string | null> {
  return accountSavedLists().then((lists) => lists?.account ?? null)
}

/**
 * Sends one intention to the account the browser's lists belong to, if they belong to one.
 *
 * A write-through rather than a request the page waits for: the browser's own list is already changed by the
 * time this is called (`useSearchHistory`, `useVersusFavorites`), nothing on the screen depends on the answer,
 * and a request that never arrives leaves a list that is still right on the device it was written on. It waits
 * for the page's one answer first, because that answer is what tells a visitor - whose lists are nobody's -
 * from a reader whose lists are on an account, and because it is what puts the hand-over before the first
 * write of a visit.
 */
function push(url: string, body: Record<string, unknown>): void {
  if (!import.meta.client) return

  void account().then((account) => {
    if (!account) return
    void $fetch(url, { method: 'POST', body }).catch(() => {})
  })
}

/** A character looked up: the same fact a character's own page records for itself. */
export function pushLookedUpCharacter(entry: SearchHistoryEntry): void {
  push('/api/saved', { entry })
}

/** The star, either way: `starred` is which way it went rather than a toggle. */
export function pushStarredCharacter(entry: { region: string; realm: string; name: string }, starred: boolean): void {
  push('/api/saved/star', { entry, starred })
}

/**
 * The cross: gone from both halves of the list on the account, as it is in the browser.
 *
 * The three segments are all this needs, and a caller that holds a whole entry - with the portrait and the
 * class on it - sends them along all the same: a row the account does not have yet is created from this body.
 */
export function pushForgottenCharacter(entry: { region: string; realm: string; name: string }): void {
  push('/api/saved/forget', { entry })
}
