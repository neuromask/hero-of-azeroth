/**
 * What a metric leaderboard page asks for, and the address it is asked at.
 *
 * A metric leaderboard is one figure's ranking (`/leaderboards/<slug>`) at one scope - the world, a region, or a
 * realm inside it - and its state is two numbers: which page of it is drawn, and which *place* a link asked to be
 * shown. The second is the interesting one. A place is not a page: `?rank=46` means "the member standing
 * forty-sixth in this ranking", which is a fact about the table rather than about how many rows a page holds, and
 * this composable is where the two are turned into each other - which is why how many rows a page holds is read
 * from the front door's own constant (`LEADERBOARD_PER_PAGE`) rather than decided again here.
 *
 * The rules the address obeys, and they are the rules a reader can rely on:
 *
 *   - no `rank` and no `page` is the top of the ranking, which is what the address of a metric leaderboard means
 *     before anybody has asked for more;
 *   - `?rank=N` opens the page that holds the Nth member and marks their row, and the page number is derived
 *     rather than written, so a link never has to know how many rows a page holds;
 *   - a `rank` that is not a positive whole number is ignored rather than guessed at - a typo is the top of the
 *     ranking, not a walk off the end of it;
 *   - a `rank` past the last member lands on the last page (the read clamps the page itself), and a `rank` whose
 *     member has moved since the link was written is reported as stale rather than silently dropped;
 *   - paging *clears* `rank`, because a reader who has stepped to another page has left the place they were
 *     shown - the two cannot both be true of one address, and an address that said both would be a page number
 *     and a place disagreeing about what the reader is looking at.
 *
 * Everything here is synchronous, so the server renders the very page a link asked for - the rows a reader
 * follows a `?rank=` link to are in the HTML, not filled in afterwards.
 */
import { LEADERBOARD_PER_PAGE } from '#shared/data/leaderboardSchema'
import type { MaybeRefOrGetter } from 'vue'
import type {
  LeaderboardFaction,
  MetricLeaderboard,
  MetricLeaderboardPage,
  MetricLeaderboardScope,
  MetricLeaderboardSlug
} from '#shared/data/leaderboardSchema'

/** How long the search box waits after the last keystroke before it asks the server, as the front door waits. */
const SEARCH_DEBOUNCE = 300

/** The query parameter a link into a ranking names a place by. */
export const METRIC_LEADERBOARD_RANK_PARAM = 'rank'

/** The query parameter the page number travels in, which is what a shared link to a deep page carries. */
export const METRIC_LEADERBOARD_PAGE_PARAM = 'page'

/**
 * The place an address asks for, or `null` for an address that names none.
 *
 * Only a positive whole number is a place: `0`, `-3`, `1.5`, `abc` and an absent parameter all mean the same
 * thing - nobody asked for a place - and the ranking opens at the top. A number written with a thousands
 * separator (`1 200`) is deliberately *not* read as 1200: the site prints places that way, and a link is written
 * from the number rather than from its printed form (`metricLeaderboardRankParam`).
 */
export function metricLeaderboardRankFromQuery(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' && typeof raw !== 'number') return null

  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) return null

  const rank = Number(text)
  return Number.isSafeInteger(rank) && rank > 0 ? rank : null
}

/** The page that holds a place, one-based, which is the whole of the arithmetic between the two. */
export function metricLeaderboardPageForRank(rank: number, perPage = LEADERBOARD_PER_PAGE): number {
  const size = Math.max(1, Math.floor(perPage))
  return Math.max(1, Math.ceil(rank / size))
}

/** The page an address names, or `1` for an address that names none - which is what the front door does. */
export function metricLeaderboardPageFromQuery(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const page = Number(String(raw ?? '').trim())

  return Number.isSafeInteger(page) && page > 0 ? page : 1
}

/** The query a link into a ranking carries: the place, and nothing else - the page follows from it. */
export function metricLeaderboardRankQuery(rank: number): Record<string, string> {
  return { [METRIC_LEADERBOARD_RANK_PARAM]: String(Math.max(1, Math.floor(rank))) }
}

/** The query a page of a ranking carries: the page number, and no place. */
export function metricLeaderboardPageQuery(page: number): Record<string, string> {
  return page > 1 ? { [METRIC_LEADERBOARD_PAGE_PARAM]: String(Math.floor(page)) } : {}
}

/**
 * The address of a metric leaderboard, without a language: the slug, then the region, then the realm inside it.
 *
 * The language is the caller's to add (`useLocaleUrl`), because it is the one part of the address that comes
 * from the reader rather than from the scope - and a realm is only ever spelled beside its region, so an address
 * can never name one on its own.
 */
export function metricLeaderboardPath(
  slug: MetricLeaderboardSlug,
  scope: MetricLeaderboardScope = {}
): string {
  const region = (scope.region || '').trim().toLowerCase()
  const realm = (scope.realm || '').trim().toLowerCase()

  return ['/leaderboards', slug, ...(region ? [region] : []), ...(region && realm ? [realm] : [])].join('/')
}

/**
 * One metric leaderboard page's own state: the page being drawn, and the place a link asked to be shown.
 *
 * The answer arrives already ordered and sliced (`/api/leaderboard/metrics`), so nothing here sorts anything:
 * what this owns is *which* page of the ranking the reader is on and where in it the row a link named stands.
 *
 * The page a link asks for is worked out before anything is fetched - `?rank=46` is page 2 at twenty-five rows a
 * page, and that is arithmetic rather than a guess - so the server renders the page the link meant and the rows
 * are in the HTML. What cannot be known before the answer arrives is whether the place still *is* a place: a
 * ranking moves as its members' figures move, and a link written a week ago can name a position nobody holds any
 * more. That is answered rather than hidden (`stale`), and the row is marked and scrolled to only when it is
 * really on the page (`highlighted`).
 */
export function useMetricLeaderboardView(options: {
  /**
   * The ranking the page is drawn for.
   *
   * Handed in as something *reactive* - the page's own props are (`app/components/leaderboard/MetricLeaderboard.vue`
   * passes them whole) - and read through `toValue` inside the computeds below rather than once when this composable
   * is set up: a ranking's address *is* its question, and a table that read the address once would go on drawing the
   * ranking it was built with after the reader stepped to another one.
   */
  metric: MaybeRefOrGetter<MetricLeaderboard>
  /** The region the address named, or absent for the world. */
  region?: MaybeRefOrGetter<string | undefined>
  /** The realm the address named, which is only ever read beside a region. */
  realm?: MaybeRefOrGetter<string | undefined>
}) {
  const route = useRoute()
  const router = useRouter()

  /**
   * The address this table is drawn for: the ranking, the region and the realm, which is the first half of every
   * question asked below.
   *
   * One computed rather than three reads, so the three travel together: they are one address, and the realm is only
   * ever a realm *within* the region named beside it.
   */
  const scope = computed(() => ({
    metric: toValue(options.metric),
    region: toValue(options.region) || '',
    realm: toValue(options.realm) || ''
  }))

  /** The place a link asked for, which paging later clears - the address and this ref are kept in step below. */
  const asked = ref<number | null>(metricLeaderboardRankFromQuery(route.query[METRIC_LEADERBOARD_RANK_PARAM]))

  const filters = reactive({
    page: asked.value
      ? metricLeaderboardPageForRank(asked.value)
      : metricLeaderboardPageFromQuery(route.query[METRIC_LEADERBOARD_PAGE_PARAM])
  })

  /**
   * The two narrowing choices the filter bar makes, which are the front door's own: which side, and a fragment of
   * a name.
   *
   * Neither travels in the address, exactly as neither does on the front door - the chips and the field narrow
   * *the table the address names*, and a filtered answer is that table's state rather than a page of its own. The
   * name is typed a letter at a time and handed to the server only when the reader has stopped typing, the same
   * 300 ms the front door waits (the box keeps its own value and the request holds a debounced copy).
   */
  const faction = ref<LeaderboardFaction | 'all'>('all')
  const search = ref('')
  const narrowed = ref('')
  let debounce: ReturnType<typeof setTimeout> | null = null

  watch(search, (value) => {
    if (debounce) clearTimeout(debounce)

    debounce = setTimeout(() => {
      const next = value.trim()
      if (next === narrowed.value) return

      narrowed.value = next
      narrowing()
    }, SEARCH_DEBOUNCE)
  })

  /** Whether anything is narrowing the table, which is what the bar's reset button appears for. */
  const filtered = computed(() => faction.value !== 'all' || Boolean(search.value.trim()))

  /**
   * Steps back to the top of the ranking when what is being ranked has changed.
   *
   * A place and a page are both about a *particular* list: a reader who narrows the table by a side or a name is
   * looking at another list, and a page number or a marked row from the one before would be pointing at nothing.
   * So the address is rewritten to the plain top of the new list.
   */
  function narrowing() {
    asked.value = null
    filters.page = 1
    writeAddress()
  }

  /** Picks a side. */
  function setFaction(next: LeaderboardFaction | 'all') {
    faction.value = next
    narrowing()
  }

  /** Drops every narrowing choice, leaving the ranking alone. */
  function clearFilters() {
    faction.value = 'all'
    search.value = ''
    narrowed.value = ''
    narrowing()
  }

  /**
   * Writes the address this state means: the page of the ranking, or the place a reveal asked to be shown.
   *
   * Every other parameter is carried through, so a reader who arrived with something the page does not use does
   * not lose it - and `replace` rather than `push`, because a page number and a place are views of one ranking
   * rather than pages of their own.
   */
  function writeAddress() {
    const carried: Record<string, string> = {}

    for (const [key, value] of Object.entries(route.query)) {
      if (key === METRIC_LEADERBOARD_RANK_PARAM || key === METRIC_LEADERBOARD_PAGE_PARAM) continue
      if (typeof value === 'string') carried[key] = value
    }

    const state = asked.value ? metricLeaderboardRankQuery(asked.value) : metricLeaderboardPageQuery(filters.page)

    void router.replace({ path: route.path, query: { ...carried, ...state } })
  }

  /**
   * The question, as a computed object so that paging re-runs the fetch and an unrelated re-render does not - and
   * as a `useFetch`, so the first page of the ranking is rendered on the server and arrives with the document.
   *
   * `no-cache` on the request is the front door's own rule, for its own reason: the answer is public and a browser
   * may keep it for the hour Nitro puts on it, while the ranking behind it is written to by the very pages a
   * reader opens (`server/utils/leaderboardRows`). Asking the server is what makes the browser's copy a copy of
   * the *current* answer rather than of the one it happened to see first.
   */
  const request = computed(() => ({
    metric: scope.value.metric.slug,
    region: scope.value.region || undefined,
    realm: scope.value.realm || undefined,
    faction: faction.value,
    q: narrowed.value || undefined,
    page: filters.page,
    perPage: LEADERBOARD_PER_PAGE
  }))

  /**
   * The question as one string, which is the name its answer is filed under.
   *
   * A table's rows belong to the question that asked for them, so the key this fetch is filed under has to be the
   * question and not the *page*: with one fixed key, a page the router has rebuilt for another address - another
   * ranking, another region or realm, another page of one - is handed the answer to the previous question, because
   * `useAsyncData` finds a key it already has an answer for and does not ask again (`useFetch` skips the initial
   * fetch when its key's data is already there). A reader meets that as a table which only changes when the whole
   * document is reloaded: the address moved, the request did not.
   *
   * Written out of the request itself rather than spelled field by field, so that a parameter added to the request
   * can never be forgotten here - a key that misses one field is a key that hands one question's answer to another.
   * The plate of a character reads its own key from the same two halves for the same reason
   * (`app/components/leaderboard/MetricLeaderboardYou.vue`).
   */
  const requestKey = computed(() => JSON.stringify(request.value))

  const { data, pending, error, refresh } = useFetch<MetricLeaderboardPage>('/api/leaderboard/metrics', {
    key: () => `hoa-metric-leaderboard:${requestKey.value}`,
    query: request,
    headers: { 'cache-control': 'no-cache' }
  }) as unknown as {
    data: Ref<MetricLeaderboardPage | undefined>
    pending: Ref<boolean>
    error: Ref<Error | null>
    refresh: () => Promise<void>
  }

  /** The page being drawn, or `null` before the first answer has landed. */
  const page = computed(() => data.value || null)
  const rows = computed(() => page.value?.players || [])
  const total = computed(() => page.value?.total || 0)
  const pages = computed(() => page.value?.pages || 1)

  /**
   * The realms this ranking holds members in, which is what the realm menu of the filter bar offers.
   *
   * It comes from the answer rather than from the site's realm list, because the menu's own rule is that it never
   * offers a choice that empties the table: a realm nobody has been read for *this* figure in is a realm this
   * ranking does not hold (`readMetricRealms` in `server/utils/leaderboardRows`).
   */
  const realms = computed(() => page.value?.realms || [])

  /**
   * Where the first row of this page stands in the whole ranking, which is what its number is read from: a page
   * shows absolute places rather than `1` again, because a place is what a reader came for.
   */
  const offset = computed(() => (page.value ? (page.value.page - 1) * page.value.perPage : 0))

  /** The absolute place of a row drawn on this page. */
  function rankOf(index: number): number {
    return offset.value + index + 1
  }

  /**
   * The place the address asked for, or `null` when it is not on the page that was served.
   *
   * It is judged against the answer rather than assumed from the address: a place is a fact about a ranking, and
   * the ranking the reader is being shown is the one that decides whether it still holds.
   */
  const highlighted = computed<number | null>(() => {
    if (!asked.value || !page.value) return null

    const index = asked.value - offset.value
    return index >= 0 && index < rows.value.length ? asked.value : null
  })

  /** A place that was asked for and is no longer there, which the page says out loud rather than hiding. */
  const stale = computed(() => asked.value !== null && highlighted.value === null)

  /**
   * The page the read answered with, which is the one the rows on screen belong to.
   *
   * A page past the end of the ranking is the last page rather than an empty one (`readMetricLeaderboardPage`),
   * and a reader who followed a `?rank=` link that now points past the end lands there - so the state this
   * composable keeps is corrected to what was actually drawn. A watch runs in the browser alone, so the server
   * renders one answer and the correction can never become a second render.
   */
  watch(
    () => page.value?.page,
    (served) => {
      if (served && served !== filters.page) filters.page = served
    }
  )

  /**
   * Steps to another page, which is the one act that *ends* a place: a reader who has moved on is no longer
   * looking at the position the link named, and an address carrying both would be two answers to one question.
   * So the place is dropped from the state and from the address, and the page number is written in its place -
   * what the address says is one thing at every moment.
   */
  function setPage(next: number) {
    const target = Math.min(Math.max(1, Math.floor(next)), pages.value)
    asked.value = null
    filters.page = target
    writeAddress()
  }

  /**
   * Shows the place a reader holds in *this* ranking, which is what the plate above the table offers.
   *
   * The place is the one in the table being drawn - the world's on a world page, the region's in a region - and it
   * is the very number the plate prints, so the row the table turns to is the row the reader was told about. The
   * reveal is the same mechanism a `?rank=` link uses, which is why the row is marked and scrolled to by the same
   * code below.
   */
  function reveal(rank: number) {
    if (!(rank > 0)) return

    asked.value = rank
    filters.page = metricLeaderboardPageForRank(rank)
    writeAddress()
  }

  /**
   * Brings the row a link named into view, once the page has been drawn.
   *
   * It runs on mount rather than during the render, and the row is found by the place it holds (`data-rank`)
   * rather than by an index: the row exists by then - the page was rendered with it, on the server - so there is
   * nothing to scroll to that is not there, and no attempt to scroll before the browser has laid the table out.
   *
   * A reveal *after* that is the same act, and is watched for the same reason: the plate's own button and a
   * `?rank=` link end in one marked row, and a reader who pressed either of them should be looking at it. Both
   * walks happen in the browser alone, so the server renders one table and neither can become a second render.
   */
  function revealHighlight(): void {
    const place = highlighted.value
    if (!place) return

    void nextTick(() => {
      const row = document.querySelector(`[data-rank="${place}"]`)
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  if (import.meta.client) {
    onMounted(revealHighlight)
    watch(highlighted, revealHighlight)
  }

  return {
    page,
    rows,
    total,
    pages,
    realms,
    offset,
    rankOf,
    highlighted,
    stale,
    asked,
    faction,
    search,
    filtered,
    setFaction,
    clearFilters,
    reveal,
    pending,
    error,
    refresh,
    setPage
  }
}
