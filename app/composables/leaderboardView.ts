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
 * the table shows - and with it which character's row a link asked for. Beyond that the page has one thing
 * the composable owns rather than derives: the answer is asked for again when the browser draws the page
 * without the server having just rendered it, because the table is written to by the pages themselves and an
 * answer kept from the start of a session is stale by construction (see `revalidate` below).
 */
import { LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
import type {
  LeaderboardFaction,
  LeaderboardPage,
  LeaderboardQuery,
  LeaderboardSort
} from '#shared/data/leaderboardSchema'
// The key a row is compared by, and the region an address segment names: the pair below turns a character into
// an address and an address back into a character, in the one spelling the table and the link both write.
import { searchHistoryKey } from '#shared/utils/savedCharacters'
import { regionFromPath } from '~/composables/urls'

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

/** The query parameter a character's row is asked for by, and the one a link from a character page names. */
export const LEADERBOARD_ROW_PARAM = 'row'

/**
 * The row a link into the table names: the character whose page it was pressed on, written the way a row of
 * the table is keyed (`searchHistoryKey`), so the address and the table agree on *who* is meant rather than on
 * how the name happens to be spelled.
 */
export function leaderboardRowQuery(entry: { region: string; realm: string; name: string }): Record<string, string> {
  return { [LEADERBOARD_ROW_PARAM]: searchHistoryKey(entry) }
}

/**
 * The row an address names, in the one spelling a row is compared by - or `null` when it names none.
 *
 * The three segments are normalised the way the table's own keys are: a region is read through
 * `regionFromPath` (so `EU` and `eu` are one region, and a segment that names none is dropped), a realm is a
 * slug and a name is compared case-insensitively (`searchHistoryKey`). So an address that was typed by hand
 * with a capital letter in it still finds the row it means, and one that reads as nothing at all asks the page
 * for nothing rather than for a row at the top of the table.
 */
export function leaderboardRowFromQuery(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return null

  const [region, realm, name] = raw.split(':')
  if (!region || !realm || !name) return null

  const code = regionFromPath(region)
  if (!code) return null

  return searchHistoryKey({ region: code, realm: realm.toLowerCase(), name })
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
    /**
     * Every request of this page asks to be answered afresh.
     *
     * The endpoint's answer is public and a browser may keep it for the hour Nitro puts on a cached answer
     * (`max-age`, built from the endpoint's own `maxAge`) - and an hour is longer than this table stays true, even
     * though the server's copy of it is exact to the second (the stamp in the endpoint's cache key). Without this
     * a filter the reader has asked for before - a row of chips they come back to, the address of a link they
     * followed an hour ago - would be answered out of the browser's own store, and the figures under it would be
     * the ones they were shown then.
     *
     * It costs one request the server answers from memory in single-digit milliseconds, which is what the hour of
     * caching is *for*; nothing on screen waits for it (`revalidate` below is the same ask, made silently).
     */
    headers: { 'cache-control': 'no-cache' },
    // A failure of the table is a row of dashes, not a broken page: the shell still renders.
    default: () => null
  })

  /** The page being drawn, or `null` before the first answer has landed. */
  const page = computed(() => data.value || null)

  const rows = computed(() => page.value?.players || [])
  const stats = computed(() => page.value?.stats || null)

  /** The question this page is asking, as one string: what a reply has to match to still answer it. */
  const requestKey = computed(() => JSON.stringify(request.value))

  /**
   * The answer itself, as Nuxt holds it under this page's key (`useNuxtData`): the ref `useFetch` above draws
   * from, the one a later visit to this page is initialised from, and therefore the only place a corrected answer
   * belongs - a re-read that wrote into a copy of its own would leave the next visit reading the old one.
   */
  const answer = useNuxtData<LeaderboardPage | null>('hoa-leaderboard').data

  /**
   * The table asked for again, in the background, when the page opens without the server having just rendered it.
   *
   * A reader who steps into a character page and comes back is shown the answer this browser read earlier in the
   * session. It is not Nuxt's cache of the HTTP response and not a stale hour of the endpoint's own: it is the
   * answer `useFetch` already holds, which the client keeps for as long as the app lives and does not ask for
   * again - a mounted page whose key is already `success` fetches nothing (see `useAsyncData`). A full reload is
   * what has been correcting it, and that is the tell: the page never asked.
   *
   * It matters here more than on any other page, because this table is written to by the pages themselves: every
   * character page anybody renders adds its figures to the table (`server/utils/leaderboardStorage`), so a reader
   * who has just looked a character up has very likely moved the very total they are about to be shown - and the
   * browser's own minute of the answer (`cache-control` in `server/api/leaderboard/index.ts`) is a second, smaller
   * window of the same staleness.
   *
   * So the page asks once more and writes what comes back straight into the data it is drawing. Nothing is
   * awaited and `pending` is deliberately left alone: the reader keeps the table already on screen - nothing
   * dims, nothing re-orders under their hands, the wait is not theirs to pay - and the figures correct themselves
   * the moment the answer lands. That is the endpoint's own stale-while-revalidate, one layer out, and it costs
   * one request the process answers from memory, which is where the hour of caching actually lives. A failure is
   * dropped: the answer on screen is a real answer, and a reader whose second request failed has lost nothing.
   *
   * Once per opening is the whole of it, and deliberately: a reader who *stays* on the table is reading the
   * answer they were given, and a beat on a timer would ask the same question over and over for a page most
   * readers leave again within the minute (`app/composables/presence.ts` beats because presence goes out on its
   * own; these figures do not).
   */
  async function revalidate(): Promise<void> {
    const asked = requestKey.value

    try {
      const fresh = await $fetch<LeaderboardPage>('/api/leaderboard', {
        query: request.value,
        // A re-ask the browser answers from its own copy of the answer is not an ask at all, and `no-cache` on a
        // request is exactly what says the stored copy may not be used without asking the server.
        headers: { 'cache-control': 'no-cache' }
      })

      // A reader who changed a filter while this was in flight is reading the answer to *their* question: the
      // reply to a question nobody is asking any more is dropped rather than written over it.
      if (fresh && requestKey.value === asked) answer.value = fresh
    } catch {
      // Nothing to do: the answer being drawn stands.
    }
  }

  /**
   * And the one call of it, at the one moment the distinction can still be made: this composable's own setup,
   * where `isHydrating` says whether the page being drawn is the one the server has just sent. A page the server
   * rendered keeps its answer - it is the freshest thing this browser has - and a page the browser navigated to
   * on its own asks again.
   *
   * The call is not awaited, and nothing is registered for a later lifecycle to hold: the composable is called by
   * the page's own script, and a hook registered after an `await` belongs to no component at all (see the note on
   * that in `app/composables/presence.ts`).
   */
  if (import.meta.client && !useNuxtApp().isHydrating) void revalidate()

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
