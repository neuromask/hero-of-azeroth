/**
 * What the leaderboard page asks for, and the answer it is drawing.
 *
 * The page is a table with a row of filters above it, and every one of them is the same request
 * with a different query string - the sorting, the faction, the realm, the class and the page all
 * end up in `/api/leaderboard`, which is cached for an hour (see `server/api/leaderboard/index.ts`).
 * So the state here is not the table: it is what the reader asked for. The rows arrive already
 * filtered, ordered and sliced, and the components draw them without knowing anything about the
 * storage behind them.
 *
 * The one thing the server is not asked on every keystroke is the search box. A name is typed a
 * letter at a time, so the box keeps its own value and hands the server a debounced copy - a
 * reader typing `neromask` asks once, not eight times.
 */
import type {
  LeaderboardFaction,
  LeaderboardPage,
  LeaderboardQuery,
  LeaderboardSort
} from '#shared/data/leaderboardSchema'

/** How long the search box waits after the last keystroke before it asks the server. */
const SEARCH_DEBOUNCE = 300

/** How many players one page of the table holds. */
export const LEADERBOARD_PER_PAGE = 25

export function useLeaderboardView() {
  /**
   * What the reader has chosen. `page` is reset by every other filter, because a page number means
   * nothing once the list under it has changed: asking for page 7 of a filtered table would land
   * on whatever happens to be there rather than on what the reader was looking at.
   */
  const filters = reactive<{
    sort: LeaderboardSort
    faction: LeaderboardFaction | 'all'
    realm: string
    classId: number | 'all'
    page: number
  }>({
    sort: 'total',
    faction: 'all',
    realm: '',
    classId: 'all',
    page: 1
  })

  /** What is in the search box, and what the server has actually been asked for. */
  const search = ref('')
  const query = ref('')
  let debounce: ReturnType<typeof setTimeout> | null = null

  watch(search, (value) => {
    if (debounce) clearTimeout(debounce)

    debounce = setTimeout(() => {
      const next = value.trim()
      if (next === query.value) return

      query.value = next
      filters.page = 1
    }, SEARCH_DEBOUNCE)
  })

  /**
   * The request, and its answer. The query is a computed object rather than a plain one, so that
   * changing a filter re-runs the fetch while an unrelated re-render does not - and because it is
   * a `useFetch`, the first page is rendered on the server and arrives with the document, which is
   * what makes the page fast for a reader and legible for a crawler.
   */
  const request = computed<LeaderboardQuery>(() => ({
    sort: filters.sort,
    faction: filters.faction,
    realm: filters.realm || undefined,
    classId: filters.classId,
    q: query.value || undefined,
    page: filters.page,
    perPage: LEADERBOARD_PER_PAGE
  }))

  const { data, pending, error, refresh } = useFetch<LeaderboardPage>('/api/leaderboard', {
    key: 'hoa-leaderboard',
    query: request,
    // A failure of the table is a row of dashes, not a broken page: the shell still renders.
    default: () => null
  })

  /** The page being drawn, or `null` before the first answer has landed. */
  const page = computed(() => data.value || null)

  const rows = computed(() => page.value?.players || [])
  const stats = computed(() => page.value?.stats || null)

  /** Every setter resets the page, so a filter change always lands on the top of the new list. */
  function setSort(sort: LeaderboardSort) {
    filters.sort = sort
    filters.page = 1
  }

  function setFaction(faction: LeaderboardFaction | 'all') {
    filters.faction = faction
    filters.page = 1
  }

  function setRealm(realm: string) {
    filters.realm = realm
    filters.page = 1
  }

  function setClass(classId: number | 'all') {
    filters.classId = classId
    filters.page = 1
  }

  function setPage(next: number) {
    const last = page.value?.pages || 1
    filters.page = Math.min(Math.max(1, next), last)
  }

  /** Drops every filter back to the overall table, which is what a reader starts from. */
  function reset() {
    filters.sort = 'total'
    filters.faction = 'all'
    filters.realm = ''
    filters.classId = 'all'
    filters.page = 1
    search.value = ''
    query.value = ''
  }

  return {
    filters,
    search,
    page,
    rows,
    stats,
    pending,
    error,
    refresh,
    setSort,
    setFaction,
    setRealm,
    setClass,
    setPage,
    reset
  }
}
