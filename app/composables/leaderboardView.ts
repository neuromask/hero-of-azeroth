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
 *
 * One piece of the page's state travels in the address as well as in this composable: which columns
 * the table shows. It is here because a tile on a character page links *into* the table - pressing
 * the decor tile opens the hall of fame with the decor chip lit - so the page has to be able to open
 * with the chips already chosen. The two functions below are that agreement, written once, so a link
 * and the chip row that answers it can never spell it differently.
 */
import { LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
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

/** The query parameter the chips are written into, and the one a link into the table names. */
export const LEADERBOARD_COLUMNS_PARAM = 'columns'

/**
 * The chips a set of columns means in an address: the figures it lights, or nothing at all for the
 * overall state - which is what a table showing everything already says by saying nothing.
 */
export function leaderboardColumnsQuery(columns: LeaderboardSort[]): Record<string, string> {
  const picked = columns.filter((key) => key !== 'total')
  return picked.length ? { [LEADERBOARD_COLUMNS_PARAM]: picked.join(',') } : {}
}

/**
 * The chips an address names, in the order the table draws them.
 *
 * Read back through `LEADERBOARD_SORTS`, so a word this build does not know - a link written before a
 * figure existed, or a typo in one copied by hand - is dropped rather than turning into a column with
 * nothing in it, and `null` says the address names no chips at all. `total` is not one column among
 * the others: an address that names it means every column, which is the state `null` already stands
 * for, so it is left out here and the overall chip is what the table falls back to.
 */
export function leaderboardColumnsFromQuery(value: unknown): LeaderboardSort[] | null {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (typeof raw !== 'string' || !raw.trim()) return null

  const said = raw.split(',').map((entry) => entry.trim())
  const picked = LEADERBOARD_SORTS.filter((key) => key !== 'total' && said.includes(key))

  return picked.length ? picked : null
}

export function useLeaderboardView() {
  const route = useRoute()
  const router = useRouter()

  /**
   * Which columns the table shows.
   *
   * The model is one of two states rather than a free set of columns, because that is how the row of
   * chips above reads. `total` - the overall score - means *every* column: that is where the page
   * opens, and it is the only chip lit while it holds. Picking any other chip steps out of that state
   * and the table shows exactly the figures that are lit; clearing the last one steps back into it.
   * So a reader is never looking at a table with no figures in it, and the overall chip is never lit
   * beside the others.
   *
   * The state opens with whatever the address names (`leaderboardColumnsFromQuery`), which is what
   * makes a link from a character page's tile land on the figure it pointed at.
   */
  const linked = leaderboardColumnsFromQuery(route.query[LEADERBOARD_COLUMNS_PARAM])
  const columns = ref<LeaderboardSort[]>(linked || ['total'])

  /** True while every column is shown, which is what the overall chip means. */
  const showsAllColumns = computed(() => columns.value.includes('total'))

  /**
   * Switches the chips and writes the same choice into the address, in one place: a reader who
   * arrived at the table by a link and then lit another figure must not be left with an address that
   * says something the table does not show.
   */
  function applyColumns(next: LeaderboardSort[]) {
    columns.value = next

    const query = { ...route.query }
    delete query[LEADERBOARD_COLUMNS_PARAM]
    Object.assign(query, leaderboardColumnsQuery(next))

    // The address is rebuilt from the one being read (`route.path`), rather than from the route's name:
    // the page serves its Russian address as an alias of the English one, and a name resolves to the
    // English path alone - which would drop the `/ru` a reader arrived with and hand them the table in
    // the other language. `replace` rather than `push`, because the chips are a view of one table
    // rather than a row of pages, and the way back belongs to wherever the reader came from.
    void router.replace({ path: route.path, query })
  }

  function toggleColumn(key: LeaderboardSort) {
    // The overall chip is not one column among the others: it is the state the others leave behind.
    if (key === 'total') {
      applyColumns(['total'])
      return
    }

    const picked = columns.value.filter((entry) => entry !== 'total')
    const next = picked.includes(key)
      ? picked.filter((entry) => entry !== key)
      : [...picked, key]

    // The last figure switched off hands the table back to the overall chip.
    applyColumns(next.length ? next : ['total'])
  }

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

  /**
   * Drops every filter back to the overall table, which is what a reader starts from.
   */
  function reset() {
    filters.sort = 'total'
    filters.faction = 'all'
    filters.realm = ''
    filters.classId = 'all'
    filters.page = 1
    search.value = ''
    query.value = ''
  }

  /**
   * Hands the table the place a reader holds, which is what the reader's own row needs.
   *
   * A place is the one number a reader has that the table can be asked for: it is where the overall
   * table puts them, and turning it into a page is arithmetic that belongs here rather than to a page,
   * because how many rows a page holds is decided here (`LEADERBOARD_PER_PAGE`). Every filter goes on
   * the way: a place is a place in the overall table, and a faction or a search left in front of it
   * would land the reader on a page that cannot hold their row. The page number is set rather than
   * clamped, because `setPage` clamps against the answer being replaced - which is the filtered one,
   * and the one that has nothing to do with where this place falls.
   */
  function revealRank(rank: number) {
    reset()
    filters.page = Math.max(1, Math.ceil(rank / LEADERBOARD_PER_PAGE))
  }

  return {
    filters,
    search,
    columns,
    showsAllColumns,
    toggleColumn,
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
    revealRank,
    reset
  }
}
