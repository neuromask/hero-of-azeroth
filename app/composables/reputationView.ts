/**
 * Whose reputation journal a page is reading: the character's own ladders, or the account's reading of them.
 *
 * A reputation is a character's - one hero raises it, not an account - so the journal is the character's by
 * default and stays so; what the account's reading adds is the one thing the site knows about an account's
 * reputations, which is *which* ladders some character of it has finished (`server/utils/accountPool`, the pool
 * the reputations tile and the site's score are read from). The switch only exists where the site holds that
 * pool (`ReputationJournal.accountAvailable`), and it is off to begin with, because the character's journal is
 * what the page has always been.
 *
 * The choice is kept in `localStorage` beside the collection switches - a reader who asked for the account's
 * reading of one page of the site has asked for it in the same words on another - and it is read after the page
 * has hydrated rather than while it is being set up: the journal the server sent is the character's, and reading
 * storage mid-hydration would draw a different journal than the one that arrived.
 */
export const REPUTATION_VIEW_KEY = 'reputationView'

export function useReputationView() {
  const view = useState<{ byAccount: boolean }>('reputationView', () => ({ byAccount: false }))

  onMounted(() => {
    if (!import.meta.client) return
    try {
      const stored = localStorage.getItem(REPUTATION_VIEW_KEY)
      if (stored) view.value.byAccount = JSON.parse(stored)?.byAccount === true
    } catch {
      // A browser that refuses storage keeps the default: the switch still works for the visit.
    }
  })

  watch(
    view,
    (next) => {
      if (!import.meta.client) return
      try {
        localStorage.setItem(REPUTATION_VIEW_KEY, JSON.stringify({ byAccount: next.byAccount === true }))
      } catch {
        // Ditto: there is nothing to remember, and nothing to fail at.
      }
    },
    { deep: true }
  )

  return view
}
