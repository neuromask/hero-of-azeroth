/**
 * The one switch an achievement shelf carries, kept for the visit and remembered in the browser.
 *
 * It is this site's own, and the same one the collections shelves carry: `collected` hides the tiles
 * the character has already earned, so the shelf reads as what is left to chase. It is on by default
 * - a shelf that opens on nothing but gaps would be a strange thing to meet first - and a choice made
 * once is kept in `localStorage`, so a collector who wants the gaps does not have to ask for them
 * again.
 *
 * The stored choice is read after the page has hydrated rather than while it is being set up: the
 * numbers in the response are the default shelf's, and reading storage mid-hydration would render a
 * different shelf than the one the server sent.
 */

/** Where the choice is remembered, next to the other settings a visitor's browser holds. */
export const ACHIEVEMENT_VIEW_KEY = 'achievementView'

/** The switch as this site's achievement shelves hold it. */
export interface AchievementSwitches {
  collected: boolean
}

export function useAchievementView() {
  const view = useState<AchievementSwitches>('achievementView', () => ({ collected: true }))

  onMounted(() => {
    if (!import.meta.client) return
    try {
      const stored = localStorage.getItem(ACHIEVEMENT_VIEW_KEY)
      if (stored) Object.assign(view.value, JSON.parse(stored))
    } catch {
      // A browser that refuses storage keeps the default: the switch still works for the visit.
    }
  })

  watch(
    view,
    (next) => {
      if (!import.meta.client) return
      try {
        localStorage.setItem(ACHIEVEMENT_VIEW_KEY, JSON.stringify(next))
      } catch {
        // Ditto: there is nothing to remember, and nothing to fail at.
      }
    },
    { deep: true }
  )

  return view
}
