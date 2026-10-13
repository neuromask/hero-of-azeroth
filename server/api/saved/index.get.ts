/**
 * The characters this reader's account remembers: the ones it looked up, and the ones it saved with a star.
 *
 * A visitor is answered rather than refused. `signedIn: false` and two empty lists say what `/api/profile`
 * says with `user: null`, and for the same reason: a search field reads this on every page, and a 401 would
 * turn a list that is simply the browser's own into an error state.
 *
 * `account` is the sign-in's own identifier rather than the BattleTag, because it is what a browser records
 * for itself when it hands its own lists over (`app/composables/savedCharacters.ts`) - and a BattleTag that a
 * reader renames is not an identity.
 */
import type { SearchHistoryEntry } from '#shared/utils/savedCharacters'

export interface SavedListsResponse {
  /** Whether anybody is signed in at all, which is what the rest of this answer is read with. */
  signedIn: boolean
  /** The account these lists belong to, or `null` for a visitor. */
  account: string | null
  /** The characters saved with a star, newest first. */
  starred: SearchHistoryEntry[]
  /** The characters looked up, newest first - the starred ones among them when they were looked up too. */
  recent: SearchHistoryEntry[]
}

export default defineEventHandler(async (event): Promise<SavedListsResponse> => {
  const user = await getCurrentUser(event)
  if (!user) return { signedIn: false, account: null, starred: [], recent: [] }

  return { signedIn: true, account: user.bnetSub, ...listSavedCharacters(user.id) }
})
