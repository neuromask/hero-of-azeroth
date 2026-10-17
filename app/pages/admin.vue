<script setup lang="ts">
/**
 * The admin panel: the numbers an operator owns, in one place, and the foundation the next ones stand on.
 *
 * The site reads almost everything it prints from Blizzard, and the few figures nobody publishes a size for are
 * *stated* rather than read (`#shared/data/siteSettings`): how many quests have been written, how many
 * appearance sources exist, how many recipes a book can hold. Those are the numbers this page exists for - the
 * comparison board measures a row against them (`app/components/CharacterVersus.vue`) - and they are kept in the
 * site's own database rather than in a file, so correcting one is a form rather than a deploy.
 *
 * It is a *page* and not a drawer of the account, because its writes are not the reader's own: the endpoint
 * behind the save refuses anybody the site does not list as an administrator, so what this page can do at all is
 * decided a layer down. The gate drawn here is the panel's own courtesy - a signed-out visitor is offered the
 * way in, and a signed-in one who is not an administrator is told so rather than shown an empty form.
 *
 * The second section is the foundation: a page's copy, keyed `page.slug`, stored and served by the very same
 * endpoint. Nothing reads it yet - a page still prints its own words - and that is deliberate: the store, the
 * validation and the way back in are the work, and the first page that reads a key is a page that chooses to.
 */
definePageMeta({ alias: '/ru/admin' })

// The hall of fame's own backdrop, so the panel stands on the picture the site is known by rather than on a
// second one of its own (`app/pages/index.vue`, `app/components/SiteDocument.vue`).
import backdrop from '~/assets/img/hf-bg_01.webp'
import { EDITABLE_METRIC_MAXIMA } from '#shared/data/siteSettings'
import type { MetricKey } from '#shared/data/historySchema'
// The shape the panel draws, shared with the endpoint that builds it (`server/api/admin/diagnostics`), so a
// figure added on one side is a type error on the other rather than a card that prints nothing.
import type { AdminDiagnostics, DiagnosticEntry } from '#shared/data/adminDiagnostics'
// The site's own spelling of a number and of a size: the panel prints figures the rest of the site prints.
import { formatBytes } from '#shared/utils/format-bytes'
import { formatNumber } from '#shared/utils/formatNumber'

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()

/**
 * Who is reading, from the answer the header's own corner is already drawn from: the same key, so the panel and
 * the Battle.net menu over it cost the site one request rather than two.
 */
const { data: profile } = await useFetch<{ user: { battletag: string | null; isAdmin?: boolean } | null }>(
  '/api/profile',
  { key: 'profile-identity' }
)

const user = computed(() => profile.value?.user ?? null)
const isAdmin = computed(() => user.value?.isAdmin === true)

usePageSeo({
  title: () => t('adminTitle'),
  description: () => t('adminDescription'),
  // An operator's panel is nobody's search result.
  noindex: true
})

const { data: settings, refresh } = await useSiteSettings()

/** The maxima as the fields hold them, which a first render fills and a save re-reads. */
const maximaDraft = reactive<Record<string, string>>({})

/** The stored copy as the rows hold it, in the order the panel drew them. */
const contentDraft = ref<Array<{ key: string; value: string }>>([])

/** Fills both drafts from an answer - what a first render and a refresh alike do. */
function fillDrafts() {
  const maxima = settings.value?.metricMaxima ?? {}

  for (const metric of EDITABLE_METRIC_MAXIMA) {
    const value = maxima[metric]
    maximaDraft[metric] = typeof value === 'number' ? String(value) : ''
  }

  contentDraft.value = Object.entries(settings.value?.content ?? {}).map(([key, value]) => ({ key, value }))
}

fillDrafts()
watch(settings, fillDrafts)

/**
 * What a metric is called, which is the message key the rest of the site already names it by - with the two
 * exceptions the locale files spell differently (`score` is the hall of fame's column, `mPlusScore` is the key).
 */
const METRIC_LABEL: Partial<Record<MetricKey, string>> = { score: 'lbColScore', mPlusScore: 'mPlus' }
const labelOf = (metric: MetricKey) => t(METRIC_LABEL[metric] || metric)

/** The three states a save can be in, said under the buttons rather than as a toast nobody is watching for. */
const saving = ref(false)
const failed = ref(false)
const saved = ref(false)

/**
 * The maxima as the store wants them: a whole number, or `null` for a field that was cleared - which is a figure
 * the operator has deliberately left without a scale, and not a figure that keeps its own total.
 */
function maximaPatch(): Record<string, number | null> {
  const patch: Record<string, number | null> = {}

  for (const metric of EDITABLE_METRIC_MAXIMA) {
    const raw = (maximaDraft[metric] ?? '').replace(/\s+/g, '')
    const value = Number(raw)
    patch[metric] = raw && Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  return patch
}

/** Adds an empty copy row, which is how a key is introduced - nothing is stored until the form is saved. */
function addContentRow() {
  contentDraft.value = [...contentDraft.value, { key: '', value: '' }]
}

/** Drops a row, which the next save turns into a key that is no longer stored. */
function removeContentRow(index: number) {
  contentDraft.value = contentDraft.value.filter((_, at) => at !== index)
}

/** Writes both halves, then re-reads them: what the panel shows is always the store's answer, never the form's. */
async function save() {
  if (saving.value || !isAdmin.value) return

  saving.value = true
  failed.value = false
  saved.value = false

  const content: Record<string, string> = {}
  for (const row of contentDraft.value) {
    const key = row.key.trim()
    if (key) content[key] = row.value
  }

  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { metricMaxima: maximaPatch(), content } })
    await refresh()
    saved.value = true
  } catch {
    failed.value = true
  } finally {
    saving.value = false
  }
}

/**
 * The dashboard half: what the running process says about itself, read from one read-only endpoint.
 *
 * It is fetched in the browser rather than awaited in the page, because it is the one thing here that has to
 * move while the page is open: the panel refreshes it every twenty seconds, and stops the moment the tab is
 * hidden (`visibilitychange`) so a panel left open in a background tab costs the server nothing. Two asks that
 * land together share one request (`inFlight`) rather than making two, and the endpoint behind them answers from
 * its own short cache, so a page that is watched is still one query a window (`server/api/admin/diagnostics`).
 *
 * Nothing here is measured: every figure is what the server counted, and a figure the server cannot measure is
 * drawn as `—` rather than as a zero.
 */
const diagnostics = ref<AdminDiagnostics | null>(null)
const diagnosticsLoading = ref(false)
const diagnosticsFailed = ref(false)
/** When this browser last heard from the endpoint, in milliseconds - the panel's own clock, not the server's. */
const diagnosticsUpdatedAt = ref<number | null>(null)

/** How often the panel asks, while it is the tab being looked at. */
const POLL_MS = 20_000

/** The request in flight, if any: a second ask joins it rather than making a second one. */
let inFlight: Promise<void> | null = null
let poller: ReturnType<typeof setInterval> | null = null

async function loadDiagnostics(): Promise<void> {
  if (!isAdmin.value) return
  if (inFlight) return inFlight

  diagnosticsLoading.value = true

  const request = (async () => {
    try {
      diagnostics.value = await $fetch<AdminDiagnostics>('/api/admin/diagnostics')
      diagnosticsUpdatedAt.value = Date.now()
      diagnosticsFailed.value = false
    } catch {
      // A failed refresh is said out loud and the last answer is kept: a panel that blanked itself because one
      // poll missed would be less useful than one that says "this is what I last saw".
      diagnosticsFailed.value = true
    } finally {
      diagnosticsLoading.value = false
      inFlight = null
    }
  })()

  inFlight = request
  return request
}

function startPolling(): void {
  if (poller) return
  poller = setInterval(() => {
    // The timer is left running and does nothing while the tab is hidden, so a return to the tab is immediate
    // (`onVisibility` asks once, at once) rather than up to twenty seconds away.
    if (!document.hidden) {
      void loadDiagnostics()
      void loadAutomation()
    }
  }, POLL_MS)
}

function stopPolling(): void {
  if (!poller) return
  clearInterval(poller)
  poller = null
}

function onVisibility(): void {
  if (document.hidden) {
    stopPolling()
    return
  }

  void loadDiagnostics()
  void loadAutomation()
  startPolling()
}

onMounted(() => {
  if (!isAdmin.value) return

  void loadDiagnostics()
  void loadAutomation()
  startPolling()
  document.addEventListener('visibilitychange', onVisibility)
})

onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', onVisibility)
})

/** The language the figures are spelled in, so a Russian panel prints `1 234` and an English one `1,234`. */
const timeFormat = computed(
  () => new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-GB', { timeStyle: 'medium' })
)

/**
 * A counted figure, or a dash where nothing was counted.
 *
 * The spelling is the site's own (`#shared/utils/formatNumber`: grouped by a plain space, the same figure on
 * both languages), so the panel a Russian administrator reads and the board every reader sees cannot disagree
 * about what a number looks like. A dash is what a figure the server does not have prints - never a zero, which
 * would read as "counted, and it was nothing".
 */
function num(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : '—'
}

/**
 * A size in bytes with its unit, from the one implementation of that rule (`#shared/utils/format-bytes`).
 *
 * It is a one-line wrapper rather than an alias so that the panel reads as the rest of the page does, and so
 * that the rule itself is testable without a component (see `test/unit/formatBytes.test.ts`).
 */
function bytes(value: number | null | undefined): string {
  return formatBytes(value)
}

/** A span of seconds as the two largest parts of it: `3h 12m`, `4m 05s`, `9s`. */
function duration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '—'

  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60

  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  return `${rest}s`
}

/** A moment in seconds since the epoch, as this browser's own clock prints it. */
function clock(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !seconds) return t('adminNever')
  return timeFormat.value.format(new Date(seconds * 1000))
}

/** Milliseconds, which the panel prints with their unit like every other figure. */
function milliseconds(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${num(value)} ms` : '—'
}

/**
 * The safe identity of a logged failure, as one line: which character, which step, how many attempts, and when
 * it will be tried again.
 *
 * It is drawn from the entry's own `context`, which the server fills with a character id, a region, a realm slug
 * and a stage word - and nothing else. A log that cannot say *which* row failed is a log an operator has to
 * reproduce a failure to understand; a log that says more than this is a log with a token in it.
 */
function entryContext(entry: DiagnosticEntry): string {
  const context = entry.context
  if (!context) return ''

  return [
    context.characterId ? `#${context.characterId}` : '',
    context.region && context.realm ? `${context.region}/${context.realm}` : '',
    context.stage || '',
    context.attempts ? `${t('adminErrorsAttempts')} ${context.attempts}` : '',
    context.nextAttemptAt ? `${t('adminErrorsNextAttempt')} ${clock(context.nextAttemptAt)}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Whether the panel has heard from the endpoint at all, and whether the last ask failed. */
const connection = computed<'loading' | 'online' | 'offline'>(() => {
  if (diagnosticsFailed.value) return 'offline'
  if (!diagnostics.value) return 'loading'
  return 'online'
})

const connectionLabel = computed(() => {
  if (connection.value === 'online') return t('adminDiagOnline')
  if (connection.value === 'offline') return t('adminDiagOffline')
  return t('adminDiagLoading')
})

const connectionClasses = computed(() => {
  if (connection.value === 'online') return 'text-emerald-300'
  if (connection.value === 'offline') return 'text-red-300'
  return 'text-gray-400'
})

const lastUpdatedLabel = computed(() =>
  diagnosticsUpdatedAt.value ? timeFormat.value.format(new Date(diagnosticsUpdatedAt.value)) : t('adminNever')
)

/** A row of a detail section: a translated label and an already-formatted figure. */
interface DetailRow {
  label: string
  value: string
}

/** The six cards of the overview, each a figure with the fact under it that makes it readable. */
const cards = computed(() => {
  const data = diagnostics.value
  const memory = data?.system.memory

  return [
    {
      key: 'memory',
      title: t('adminCardProcessMemory'),
      value: bytes(memory?.rssBytes),
      note: `${t('adminRowHeapUsed')} ${bytes(memory?.heapUsedBytes)}`
    },
    {
      key: 'sqlite',
      title: t('adminCardSqlite'),
      value: bytes(data?.database.files.db.bytes),
      note: `${t('adminRowWalFile')} ${bytes(data?.database.files.wal.bytes)}`
    },
    {
      key: 'leaderboard',
      title: t('adminCardLeaderboard'),
      value: num(data?.database.rows.leaderboard),
      note: t('adminRowMembers')
    },
    {
      key: 'sync',
      title: t('adminCardSync'),
      value: data?.sync.running ? t('adminSyncRunning') : t('adminSyncIdle'),
      note: `${t('adminRowSyncPasses')} ${num(data?.sync.passes)}`
    },
    {
      key: 'blizzard',
      title: t('adminCardBlizzard'),
      value: num(data?.blizzardApi.ok),
      note: `${t('adminBlizzardFailed')} ${num(data?.blizzardApi.failed)} · 429 ${num(data?.blizzardApi.rateLimited)}`
    },
    {
      key: 'uptime',
      title: t('adminCardUptime'),
      value: duration(data?.system.uptimeSeconds),
      note: `${t('adminRowNode')} ${data?.system.node ?? '—'}`
    }
  ]
})

const systemRows = computed<DetailRow[]>(() => {
  const data = diagnostics.value
  const memory = data?.system.memory

  return [
    { label: t('adminRowUptime'), value: duration(data?.system.uptimeSeconds) },
    { label: t('adminRowNode'), value: data?.system.node ?? '—' },
    { label: t('adminRowMemoryRss'), value: bytes(memory?.rssBytes) },
    { label: t('adminRowPeakRss'), value: bytes(memory?.peakRssBytes) },
    { label: t('adminRowHeapUsed'), value: bytes(memory?.heapUsedBytes) },
    { label: t('adminRowHeapTotal'), value: bytes(memory?.heapTotalBytes) },
    { label: t('adminRowExternal'), value: bytes(memory?.externalBytes) },
    { label: t('adminRowArrayBuffers'), value: bytes(memory?.arrayBuffersBytes) },
    { label: t('adminRowBuildMs'), value: milliseconds(data?.durationMs) }
  ]
})

/**
 * The last hour of RSS as bars, scaled between the lowest and the highest reading of the window.
 *
 * A single number cannot say whether a process is holding its memory or growing into it, and the question an
 * operator actually has is the second one - so the panel draws what it sampled (one reading per diagnostics
 * window, twelve fixed slots) rather than leaving them to be compared by eye. No chart library: the bars *are*
 * the data, and a page that pulled one in for twelve rectangles would be a page that stopped being a panel.
 */
const memoryTrend = computed(() => {
  const samples = diagnostics.value?.system.memory.samples ?? []
  if (samples.length < 2) return []

  const values = samples.map((sample) => sample.rssBytes)
  const lowest = Math.min(...values)
  const span = Math.max(1, Math.max(...values) - lowest)

  return samples.map((sample) => ({
    at: sample.at,
    rssBytes: sample.rssBytes,
    // 15%..100%, so the smallest reading is still a visible bar rather than a line.
    height: 15 + Math.round(((sample.rssBytes - lowest) / span) * 85)
  }))
})

const syncRows = computed<DetailRow[]>(() => {
  const state = diagnostics.value?.sync

  const source =
    state?.source === 'timer'
      ? t('adminSyncSourceTimer')
      : state?.source === 'on-demand'
        ? t('adminSyncSourceOnDemand')
        : state?.source === 'manual'
          ? t('adminSyncSourceManual')
          : '—'

  const lastError = state?.lastErrorCategory
    ? `${state.lastErrorCategory} · ${clock(state.lastErrorAt)}`
    : t('adminNever')

  const manual = state?.manual.count
    ? `${num(state.manual.count)} · ${state.manual.lastOutcome ?? '—'} · ${clock(state.manual.lastAt)}`
    : num(0)

  return [
    { label: t('adminRowSyncState'), value: state?.running ? t('adminSyncRunning') : t('adminSyncIdle') },
    { label: t('adminRowSyncSource'), value: source },
    { label: t('adminRowSyncLastStart'), value: clock(state?.lastStartAt) },
    { label: t('adminRowSyncLastFinish'), value: clock(state?.lastFinishAt) },
    { label: t('adminRowSyncDuration'), value: milliseconds(state?.lastDurationMs) },
    // The timer, next to the passes it produced: the pair is what says whether a quiet pass counter is a timer
    // that did not fire or a pass that refused its ticks.
    { label: t('adminRowSyncInterval'), value: milliseconds(state?.intervalMs) },
    { label: t('adminRowSyncTicks'), value: num(state?.timerTicks) },
    { label: t('adminRowSyncTicksSkipped'), value: num(state?.timerSkipped) },
    { label: t('adminRowSyncLastTick'), value: clock(state?.lastTickAt) },
    { label: t('adminRowSyncChecked'), value: num(state?.checked) },
    { label: t('adminRowSyncUpdated'), value: num(state?.updated) },
    { label: t('adminRowSyncSkipped'), value: num(state?.skipped) },
    { label: t('adminRowSyncErrors'), value: num(state?.errors) },
    { label: t('adminRowSyncPasses'), value: num(state?.passes) },
    // What the retry state is holding back, which is neither an error nor a skip: those characters were not
    // looked at at all.
    { label: t('adminRowSyncParked'), value: num(state?.parked) },
    { label: t('adminRowSyncNextRetry'), value: clock(state?.nextRetryAt) },
    { label: t('adminRowSyncManual'), value: manual },
    { label: t('adminRowSyncLastError'), value: lastError }
  ]
})

const blizzardRows = computed<DetailRow[]>(() => {
  const data = diagnostics.value?.blizzardApi

  return [
    { label: t('adminBlizzardTotal'), value: num(data?.total) },
    { label: t('adminBlizzardOk'), value: num(data?.ok) },
    { label: t('adminBlizzardFailed'), value: num(data?.failed) },
    { label: t('adminBlizzard429'), value: num(data?.rateLimited) },
    { label: t('adminBlizzardTimeouts'), value: num(data?.timeouts) },
    { label: t('adminBlizzard5xx'), value: num(data?.serverErrors) },
    { label: t('adminBlizzardTolerated'), value: num(data?.toleratedAbsences) },
    { label: t('adminBlizzardLastCall'), value: clock(data?.lastCallAt) },
    { label: t('adminBlizzardLastOk'), value: clock(data?.lastOkAt) },
    { label: t('adminBlizzardLastMs'), value: milliseconds(data?.lastMs) },
    { label: t('adminBlizzardAvg'), value: milliseconds(data?.averageMs) }
  ]
})

/** The database's own lines; the table counts are drawn as their own grid beside them. */
const databaseRows = computed<DetailRow[]>(() => {
  const data = diagnostics.value
  const files = data?.database.files

  const fileLine = [files?.db, files?.wal, files?.shm]
    .map((file) => `${file?.name ?? '—'} ${file?.error ? t('adminFileUnreadable') : bytes(file?.bytes)}`)
    .join(' · ')

  return [
    { label: t('adminRowFiles'), value: fileLine },
    { label: t('adminRowGuests'), value: num(data?.database.guests) },
    { label: t('adminRowAccountCharacters'), value: num(data?.database.accountCharacters) },
    { label: t('adminRowHiddenFromFame'), value: num(data?.database.hiddenFromFame) },
    { label: t('adminRowLastStatsRead'), value: clock(data?.database.lastStatsReadAt) },
    { label: t('adminRowLastSnapshot'), value: clock(data?.database.lastSnapshotAt) }
  ]
})

/** The table counts, keyed by the table's own name - an identifier, and the one thing here not translated. */
const tableCounts = computed(() => Object.entries(diagnostics.value?.database.rows ?? {}))

/** What `/api/admin/automation` answers: the stored settings, the scheduler's own state, and what a pass would cost. */
interface AutomationView {
  settings: { characterScan: { enabled: boolean; intervalMs: number; batchSize: number } }
  scheduler: {
    enabled: boolean
    armed: boolean
    intervalMs: number
    batchSize: number
    nextRunAt: number | null
    lastTickAt: number | null
    appliedAt: number
  }
  limits: { intervalsMs: number[]; batchMin: number; batchMax: number; requestsPerCharacter: number }
  estimate: { due: number; batchSize: number; potentialRequests: number }
}

/** What the save answered: the settings as stored, and the scheduler as it now stands. */
interface AutomationSaveAnswer {
  settings: AutomationView['settings']
  scheduler: AutomationView['scheduler']
}

const automation = ref<AutomationView | null>(null)
const automationLoading = ref(false)
const automationFailed = ref(false)

/**
 * The form's own state, kept apart from the polling on purpose.
 *
 * A panel that refreshes its figures every twenty seconds must not overwrite a field somebody is halfway through
 * editing - so the draft is filled once, refilled only when the server's settings have changed *and* the form has
 * no unsaved edits (`automationDirty`), and refilled after a save, which is the moment the server's answer is the
 * truth the operator asked for.
 */
const automationDraft = reactive({ enabled: true, intervalMs: 180_000, batchSize: 10 })
/** The settings the draft was filled from, so "unsaved changes" is a comparison rather than a guess. */
const automationServer = ref<AutomationView['settings'] | null>(null)

const automationDirty = computed(() => {
  const server = automationServer.value?.characterScan
  if (!server) return false

  return (
    automationDraft.enabled !== server.enabled ||
    automationDraft.intervalMs !== server.intervalMs ||
    automationDraft.batchSize !== server.batchSize
  )
})

const automationSaving = ref(false)
/** What the last save answered, kept so the panel can show "3 min → 5 min" rather than only the new value. */
const automationSaved = ref<{ from: AutomationView['settings']; to: AutomationView['settings'] } | null>(null)
const automationSaveErrors = ref<string[]>([])
const automationSaveFailed = ref(false)

/** The manual pass: its confirmation, its state, and what it answered. */
const runConfirming = ref(false)
const runState = ref<'idle' | 'running' | 'done' | 'busy' | 'failed' | 'throttled'>('idle')
const runResult = ref<{
  counters: { checked: number; updated: number; skipped: number; errors: number }
  due: number
} | null>(null)

/** Writes the server's settings into the form - only when there is nothing to lose. */
function fillAutomationDraft(settings: AutomationView['settings']) {
  automationServer.value = settings
  automationDraft.enabled = settings.characterScan.enabled
  automationDraft.intervalMs = settings.characterScan.intervalMs
  automationDraft.batchSize = settings.characterScan.batchSize
}

async function loadAutomation(): Promise<void> {
  if (!isAdmin.value) return

  automationLoading.value = true
  try {
    const answer = await $fetch<AutomationView>('/api/admin/automation')
    const firstFill = automationServer.value === null
    const serverChanged = JSON.stringify(answer.settings) !== JSON.stringify(automationServer.value)

    automation.value = answer
    automationFailed.value = false

    // The first answer fills the form; a later one only when the form is clean and the server moved (a second
    // administrator's save, a deploy). An operator's half-typed change is never thrown away by a poll.
    if (firstFill || (!automationDirty.value && serverChanged)) fillAutomationDraft(answer.settings)
  } catch {
    automationFailed.value = true
  } finally {
    automationLoading.value = false
  }
}

/**
 * Saves the form.
 *
 * The three answers are told apart rather than collapsed into "failed": a 400 names the fields the server refused
 * (an interval it does not offer, a batch beyond the pass's ceiling), a 429 is "you just saved", and anything else
 * is the site having a bad moment. On success the panel shows what changed and what the scheduler now says.
 */
async function saveAutomation(): Promise<void> {
  if (automationSaving.value) return

  const from = automationServer.value
  automationSaving.value = true
  automationSaveErrors.value = []
  automationSaveFailed.value = false

  try {
    const answer = await $fetch<AutomationSaveAnswer>('/api/admin/automation', {
      method: 'POST',
      body: {
        characterScan: {
          enabled: automationDraft.enabled,
          intervalMs: automationDraft.intervalMs,
          batchSize: automationDraft.batchSize
        }
      }
    })

    automationSaved.value = from ? { from, to: answer.settings } : null
    fillAutomationDraft(answer.settings)
    if (automation.value) {
      automation.value = { ...automation.value, settings: answer.settings, scheduler: answer.scheduler }
    }

    // The estimate follows the batch, so the card is re-read rather than recomputed here.
    await loadAutomation()
    await loadDiagnostics()
  } catch (error) {
    const failure = error as { statusCode?: number; data?: { errors?: string[] } }

    if (Number(failure?.statusCode) === 400) automationSaveErrors.value = failure?.data?.errors ?? ['body']
    else automationSaveFailed.value = true
  } finally {
    automationSaving.value = false
  }
}

/** Runs one batch of the scanner, after the operator has confirmed what it may cost. */
async function runScanNow(): Promise<void> {
  if (runState.value === 'running') return

  runConfirming.value = false
  runState.value = 'running'
  runResult.value = null

  try {
    const answer = await $fetch<{
      counters: { checked: number; updated: number; skipped: number; errors: number }
      due: number
    }>('/api/admin/automation/run', { method: 'POST' })

    runResult.value = answer
    runState.value = 'done'
    await loadAutomation()
    await loadDiagnostics()
  } catch (error) {
    const status = Number((error as { statusCode?: number })?.statusCode)
    runState.value = status === 409 ? 'busy' : status === 429 ? 'throttled' : 'failed'
  }
}

/**
 * The jobs this site really runs, as the panel draws them.
 *
 * Every row is a thing found in the codebase (a `setTimeout`/`setInterval`, a Nitro plugin's startup work, the
 * endpoints that read on a request), and the ones that are not periodic say so instead of pretending to be jobs.
 * Only the scanner has a control, because only the scanner is ours to schedule: a reader's page read and the
 * sign-in's roster read are the reader's actions, and a switch that stopped them would be a switch that stopped
 * the site.
 */
const AUTOMATION_JOBS = [
  { id: 'character_scan', nameKey: 'adminJobScan', kindKey: 'adminJobKindPeriodic', managed: true, reasonKey: '' },
  { id: 'profile_sync', nameKey: 'adminJobProfileSync', kindKey: 'adminJobKindRequest', managed: false, reasonKey: 'adminJobReasonReader' },
  { id: 'account_refresh', nameKey: 'adminJobAccountRefresh', kindKey: 'adminJobKindRequest', managed: false, reasonKey: 'adminJobReasonSignIn' },
  { id: 'profile_reads', nameKey: 'adminJobProfileReads', kindKey: 'adminJobKindRequest', managed: false, reasonKey: 'adminJobReasonReader' },
  { id: 'statistics_migration', nameKey: 'adminJobMigration', kindKey: 'adminJobKindStartup', managed: false, reasonKey: 'adminJobReasonStartup' },
  { id: 'db_optimize', nameKey: 'adminJobOptimize', kindKey: 'adminJobKindManual', managed: false, reasonKey: 'adminJobReasonManual' }
] as const

/** How the scanner's own row reads, from the live state rather than from the settings it was saved with. */
const scanRowStatus = computed(() => {
  const running = diagnostics.value?.sync.running

  if (running) return t('adminJobStatusRunning')
  if (!automation.value?.scheduler.armed) return t('adminJobStatusPaused')
  return t('adminJobStatusArmed')
})

/** The interval, as the panel prints it: the stored milliseconds in minutes. */
function minutes(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return `${Math.round(ms / 60_000)} ${t('adminAutomationMinutes')}`
}

/** The job's status word, from its kind - and, for the scanner, from the live scheduler rather than the setting. */
function jobStatus(job: (typeof AUTOMATION_JOBS)[number]): string {
  if (job.id === 'character_scan') return scanRowStatus.value
  if (job.kindKey === 'adminJobKindStartup') return t('adminJobStatusAtStartup')
  if (job.kindKey === 'adminJobKindManual') return t('adminJobStatusManual')
  return t('adminJobStatusOnRequest')
}

/** When the job runs: an interval for the scanner, and a sentence for everything that is not a schedule. */
function jobSchedule(job: (typeof AUTOMATION_JOBS)[number]): string {
  if (job.id === 'character_scan') return minutes(automation.value?.scheduler.intervalMs)
  if (job.kindKey === 'adminJobKindStartup') return t('adminJobScheduleStartup')
  if (job.kindKey === 'adminJobKindManual') return t('adminJobScheduleManual')
  return t('adminJobScheduleRequest')
}

/**
 * The two maintenance actions, each its own POST to its own endpoint.
 * They are the only things on this page that write besides the settings form, so they are drawn as such: a
 * button that stands down while it runs (a second press cannot start a second run), a result that says what
 * happened rather than that something did, and an explicit confirmation in front of the database step, which is
 * the one action here that touches the file the whole site reads from.
 */
const refreshForm = reactive({ region: 'eu', realm: '', name: '' })

/** What the character refresh is doing, and what it answered. */
const refreshState = ref<'idle' | 'running' | 'updated' | 'unchanged' | 'busy' | 'failed'>('idle')

const refreshRunnable = computed(
  () => Boolean(refreshForm.realm.trim() && refreshForm.name.trim()) && refreshState.value !== 'running'
)

async function runCharacterRefresh(): Promise<void> {
  if (!refreshRunnable.value) return

  refreshState.value = 'running'
  try {
    const answer = await $fetch<{ status: 'updated' | 'unchanged' }>('/api/admin/character-refresh', {
      method: 'POST',
      body: { region: refreshForm.region, realm: refreshForm.realm.trim(), name: refreshForm.name.trim() }
    })

    refreshState.value = answer.status
    await loadDiagnostics()
  } catch (error) {
    // The three answers the endpoint can give besides success, told apart: another operation holds the slot
    // (`409`), or the read itself failed - which the endpoint has already mapped to the site's own status.
    refreshState.value = Number((error as { statusCode?: number })?.statusCode) === 409 ? 'busy' : 'failed'
  }
}

/** Whether the database step is waiting for its confirmation. */
const optimizeConfirming = ref(false)
const optimizeState = ref<'idle' | 'running' | 'ok' | 'failed'>('idle')

async function runOptimize(): Promise<void> {
  if (optimizeState.value === 'running') return

  optimizeConfirming.value = false
  optimizeState.value = 'running'

  try {
    await $fetch('/api/admin/optimize', { method: 'POST' })
    optimizeState.value = 'ok'
    await loadDiagnostics()
  } catch {
    optimizeState.value = 'failed'
  }
}
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black"
  >
    <SiteBackdrop :image="backdrop" />

    <SiteHeader :title="t('adminTitle')" :meta="t('adminMeta')" />

    <main class="relative z-10 container mx-auto w-full flex-1 px-4 pb-10 pt-4">
      <!-- The way in, drawn exactly as the account page draws it: the panel is an account's, so a reader who is
           nobody is offered the sign-in rather than a form they cannot save. -->
      <div v-if="!user" class="hoa-panel mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
        <p class="text-lg text-gray-200">{{ t('profileSignedOut') }}</p>
        <a href="/api/auth/login" class="hoa-tab hoa-liquid-glass mt-4 inline-flex px-5 py-2 text-sm font-semibold">
          {{ t('signInBattleNet') }}
        </a>
      </div>

      <!-- Signed in, and not one of the administrators: said plainly rather than drawn as a broken page - the
           endpoint behind the save would refuse this reader anyway (`server/api/admin/settings`). -->
      <div v-else-if="!isAdmin" class="hoa-panel mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
        <p class="text-lg font-semibold text-red-400">{{ t('adminDeniedTitle') }}</p>
        <p class="mt-2 text-sm leading-relaxed text-gray-400">{{ t('adminDeniedBody') }}</p>
        <NuxtLink :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass mt-4 inline-flex px-5 py-2 text-sm font-semibold">
          {{ t('backToSearch') }}
        </NuxtLink>
      </div>

      <div v-else class="mx-auto max-w-5xl space-y-6">
        <!-- The top row: the panel's name, whether the diagnostics endpoint is answering, when it last did, and
             the one control that asks it again. The status is drawn rather than implied - a panel that cannot say
             whether it is current is a panel an operator has to guess about. -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 class="text-lg font-bold text-white sm:text-xl">{{ t('adminDashboardTitle') }}</h1>

          <span class="hoa-panel inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold">
            <span class="h-1.5 w-1.5 rounded-full bg-current" :class="connectionClasses" aria-hidden="true" />
            <span :class="connectionClasses">{{ connectionLabel }}</span>
          </span>

          <span class="text-[11px] text-gray-400">
            {{ t('adminUpdatedAt') }}: <span class="tabular-nums text-gray-300">{{ lastUpdatedLabel }}</span>
          </span>

          <button
            type="button"
            class="hoa-tab hoa-liquid-glass ml-auto inline-flex px-3 py-1.5 text-xs font-semibold"
            :disabled="diagnosticsLoading"
            @click="loadDiagnostics"
          >
            {{ diagnosticsLoading ? t('adminLoading') : t('adminRefresh') }}
          </button>
        </div>

        <p v-if="diagnosticsFailed" class="text-[11px] font-semibold text-amber-300">
          {{ t('adminStale') }}
        </p>

        <!-- The overview: six figures, and under each the fact that makes it readable. Nothing here is a total
             the server cannot measure - a figure it does not have is a dash, never a zero. -->
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div v-for="card in cards" :key="card.key" class="hoa-panel rounded-xl p-3.5">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{{ card.title }}</p>
            <p class="mt-1 text-xl font-bold tabular-nums text-wow-goldLight">{{ card.value }}</p>
            <p class="mt-0.5 truncate text-[11px] text-gray-500" :title="card.note">{{ card.note }}</p>
          </div>
        </div>

        <!-- The measured half: the runtime, and the file the whole site reads from. -->
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="hoa-panel rounded-2xl p-4 sm:p-5">
            <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
              {{ t('adminSystemTitle') }}
            </h2>

            <dl class="mt-3">
              <div
                v-for="row in systemRows"
                :key="row.label"
                class="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0"
              >
                <dt class="text-xs text-gray-400">{{ row.label }}</dt>
                <dd class="truncate text-xs font-semibold tabular-nums text-gray-100">{{ row.value }}</dd>
              </div>
            </dl>

            <!-- The trend, drawn from the fixed slots the server sampled - one reading per diagnostics window,
                 newest last. A single number cannot say whether the process is holding its memory or growing
                 into it, and that is the question an operator actually has. -->
            <div v-if="memoryTrend.length" class="mt-3">
              <p class="text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminMemoryTrend') }}</p>
              <div class="mt-1 flex h-10 items-end gap-0.5">
                <span
                  v-for="sample in memoryTrend"
                  :key="sample.at"
                  class="min-w-0 flex-1 rounded-t bg-wow-gold/50"
                  :style="{ height: `${sample.height}%` }"
                  :title="`${clock(sample.at)} · ${bytes(sample.rssBytes)}`"
                />
              </div>
            </div>
          </section>

          <section class="hoa-panel rounded-2xl p-4 sm:p-5">
            <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
              {{ t('adminDatabaseTitle') }}
            </h2>

            <dl class="mt-3">
              <div
                v-for="row in databaseRows"
                :key="row.label"
                class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-white/5 py-1.5 last:border-0"
              >
                <dt class="text-xs text-gray-400">{{ row.label }}</dt>
                <dd class="text-left text-xs font-semibold tabular-nums text-gray-100 sm:text-right">{{ row.value }}</dd>
              </div>
            </dl>

            <!-- The tables, drawn as a dense grid of their own: the names are identifiers rather than copy, so
                 they are printed as the database spells them. -->
            <ul class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              <li v-for="[table, count] in tableCounts" :key="table" class="flex items-baseline justify-between gap-2">
                <span class="truncate font-mono text-[11px] text-gray-500">{{ table }}</span>
                <span class="text-[11px] font-semibold tabular-nums text-gray-300">{{ num(count) }}</span>
              </li>
            </ul>
          </section>
        </div>
        <!-- What the background pass actually did: not a queue length, because there is no queue - the pass
             reads its batch and the next tick takes the next one. -->
        <div class="grid gap-4 lg:grid-cols-2">
          <section class="hoa-panel rounded-2xl p-4 sm:p-5">
            <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
              {{ t('adminSyncTitle') }}
            </h2>
            <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminSyncHint') }}</p>

            <dl class="mt-3">
              <div
                v-for="row in syncRows"
                :key="row.label"
                class="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0"
              >
                <dt class="text-xs text-gray-400">{{ row.label }}</dt>
                <dd class="truncate text-xs font-semibold tabular-nums text-gray-100">{{ row.value }}</dd>
              </div>
            </dl>
          </section>

          <section class="hoa-panel rounded-2xl p-4 sm:p-5">
            <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
              {{ t('adminBlizzardTitle') }}
            </h2>
            <!-- The counters cover this process and nothing else. Deliberately not called "quota": nothing here
                 can read what is left of a limit, only what was asked for. -->
            <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminBlizzardExplain') }}</p>

            <dl class="mt-3">
              <div
                v-for="row in blizzardRows"
                :key="row.label"
                class="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0"
              >
                <dt class="text-xs text-gray-400">{{ row.label }}</dt>
                <dd class="truncate text-xs font-semibold tabular-nums text-gray-100">{{ row.value }}</dd>
              </div>
            </dl>

            <!-- What those calls *were*, cut by the kind of endpoint: the whole point of it is that "132 failed"
                 becomes "most of them were collection documents a read tolerates". A category is a word out of a
                 closed list, derived from the shape of the address and never from the address itself. -->
            <template v-if="diagnostics?.blizzardApi.byCategory.length">
              <p class="mt-3 text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminBlizzardByCategory') }}</p>
              <ul class="mt-1 space-y-0.5">
                <li
                  v-for="row in diagnostics.blizzardApi.byCategory"
                  :key="row.category"
                  class="flex items-baseline justify-between gap-2 text-[11px]"
                >
                  <span class="min-w-0 truncate font-mono text-gray-400">{{ row.category }}</span>
                  <span class="shrink-0 tabular-nums text-gray-300">
                    {{ num(row.calls) }}
                    <span class="text-gray-600">·</span>
                    <span :class="row.failed ? 'text-red-300' : 'text-gray-500'">{{ num(row.failed) }}</span>
                    <span class="text-gray-600">·</span>
                    {{ milliseconds(row.averageMs) }}
                  </span>
                </li>
              </ul>
            </template>

            <template v-if="diagnostics?.blizzardApi.byStatus.length">
              <p class="mt-3 text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminBlizzardByStatus') }}</p>
              <ul class="mt-1 flex flex-wrap gap-1.5">
                <li
                  v-for="row in diagnostics.blizzardApi.byStatus"
                  :key="row.status"
                  class="rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] tabular-nums text-gray-300"
                >
                  {{ row.status || t('adminBlizzardStatusNone') }} × {{ num(row.calls) }}
                </li>
              </ul>
            </template>

            <!-- And *who* asked. This is the row that answers "why is the total this big when the timer has not
                 ticked yet": a page read, a card, a sign-in and the scanner each have their own line, and
                 anything nobody has classified is `other` rather than quietly pooled. -->
            <template v-if="diagnostics?.blizzardApi.bySource.length">
              <p class="mt-3 text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminBlizzardBySource') }}</p>
              <ul class="mt-1 space-y-0.5">
                <li
                  v-for="row in diagnostics.blizzardApi.bySource"
                  :key="row.source"
                  class="flex items-baseline justify-between gap-2 text-[11px]"
                  :title="`${t('adminBlizzardLastCall')}: ${clock(row.lastCallAt)} · ${t('adminBlizzardAvg')}: ${milliseconds(row.averageMs)}`"
                >
                  <span class="min-w-0 truncate font-mono text-gray-400">{{ row.source }}</span>
                  <span class="shrink-0 tabular-nums text-gray-300">
                    {{ num(row.calls) }}
                    <span class="text-gray-600">·</span>
                    <span :class="row.failed ? 'text-red-300' : 'text-gray-500'">{{ num(row.failed) }}</span>
                    <span v-if="row.lastError" class="text-red-300/80">({{ row.lastError }})</span>
                  </span>
                </li>
              </ul>
            </template>
          </section>
        </div>

        <!-- The one job the site schedules: what it is set to, what it is doing, and how to run one batch by hand.
             Nothing here spends a Blizzard request until a button says so, and the estimate says what that button
             may cost before it is pressed. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
              {{ t('adminAutomationTitle') }}
            </h2>
            <span
              class="hoa-panel rounded-full px-2.5 py-1 text-[11px] font-semibold"
              :class="automation?.scheduler.armed ? 'text-emerald-300' : 'text-amber-300'"
            >
              {{ automation?.scheduler.armed ? t('adminScanArmed') : t('adminScanPaused') }}
            </span>
            <span v-if="automationDirty" class="text-[11px] font-semibold text-amber-300">
              {{ t('adminScanUnsaved') }}
            </span>
            <span v-if="automationFailed" class="text-[11px] font-semibold text-red-400">
              {{ t('adminScanLoadFailed') }}
            </span>
          </div>
          <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminAutomationHint') }}</p>

          <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <!-- On or paused: the one switch, and it says what pressing it does rather than what state it is in. -->
            <div class="rounded-xl border border-white/10 bg-black/20 p-3">
              <p class="text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminScanState') }}</p>
              <button
                type="button"
                class="hoa-tab hoa-liquid-glass mt-1 w-full px-3 py-1.5 text-xs font-semibold"
                :class="{ 'hoa-tab-active': automationDraft.enabled }"
                :disabled="!automation"
                @click="automationDraft.enabled = !automationDraft.enabled"
              >
                {{ automationDraft.enabled ? t('adminScanTogglePause') : t('adminScanToggleEnable') }}
              </button>
              <p class="mt-1 text-[10px] text-gray-500">
                {{ automationDraft.enabled ? t('adminScanEnabledHint') : t('adminScanPausedHint') }}
              </p>
            </div>

            <label class="rounded-xl border border-white/10 bg-black/20 p-3">
              <span class="text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminScanInterval') }}</span>
              <select
                v-model.number="automationDraft.intervalMs"
                class="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-wow-gold/60"
                :disabled="!automation"
              >
                <option v-for="option in automation?.limits.intervalsMs ?? []" :key="option" :value="option">
                  {{ minutes(option) }}
                </option>
              </select>
            </label>

            <label class="rounded-xl border border-white/10 bg-black/20 p-3">
              <span class="text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminScanBatch') }}</span>
              <input
                v-model.number="automationDraft.batchSize"
                type="number"
                inputmode="numeric"
                :min="automation?.limits.batchMin ?? 1"
                :max="automation?.limits.batchMax ?? 10"
                :disabled="!automation"
                class="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs font-semibold tabular-nums text-white outline-none focus:border-wow-gold/60"
              >
              <p class="mt-1 text-[10px] text-gray-500">
                {{ t('adminScanBatchRange') }} {{ num(automation?.limits.batchMin) }}–{{ num(automation?.limits.batchMax) }}
              </p>
            </label>

            <div class="rounded-xl border border-white/10 bg-black/20 p-3">
              <p class="text-[11px] uppercase tracking-wider text-gray-500">{{ t('adminScanNextRun') }}</p>
              <p class="mt-1 text-sm font-semibold tabular-nums text-gray-100">
                {{ clock(automation?.scheduler.nextRunAt) }}
              </p>
              <p class="mt-1 text-[10px] text-gray-500">
                {{ t('adminScanLastTick') }}: {{ clock(automation?.scheduler.lastTickAt) }}
              </p>
            </div>
          </div>

          <!-- What the last pass did: the *batch*, not the schedule. The counters are the same ones the Background
               sync section prints, shown here because the switch and the thing it switched on should be read in
               one place. -->
          <div class="mt-3 grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
            <p>
              <span class="text-gray-500">{{ t('adminRowSyncLastStart') }}:</span>
              <span class="tabular-nums text-gray-300">{{ clock(diagnostics?.sync.lastStartAt) }}</span>
            </p>
            <p>
              <span class="text-gray-500">{{ t('adminRowSyncLastFinish') }}:</span>
              <span class="tabular-nums text-gray-300">{{ clock(diagnostics?.sync.lastFinishAt) }}</span>
            </p>
            <p>
              <span class="text-gray-500">{{ t('adminRowSyncDuration') }}:</span>
              <span class="tabular-nums text-gray-300">{{ milliseconds(diagnostics?.sync.lastDurationMs) }}</span>
            </p>
            <p>
              <span class="text-gray-500">{{ t('adminRowSyncTicks') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.timerTicks) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncTicksSkipped') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.timerSkipped) }}</span>
            </p>
            <p class="sm:col-span-2">
              <span class="text-gray-500">{{ t('adminRowSyncChecked') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.checked) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncUpdated') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.updated) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncSkipped') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.skipped) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncErrors') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.errors) }}</span>
            </p>
            <p class="sm:col-span-2 lg:col-span-3">
              <span class="text-gray-500">{{ t('adminRowSyncParked') }}:</span>
              <span class="tabular-nums text-gray-300">{{ num(diagnostics?.sync.parked) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncNextRetry') }}:</span>
              <span class="tabular-nums text-gray-300">{{ clock(diagnostics?.sync.nextRetryAt) }}</span>
              <span class="text-gray-500">· {{ t('adminRowSyncLastError') }}:</span>
              <span class="text-gray-300">
                {{ diagnostics?.sync.lastErrorCategory ?? t('adminNever') }}
                <span v-if="diagnostics?.sync.lastErrorAt" class="tabular-nums">
                  · {{ clock(diagnostics?.sync.lastErrorAt) }}
                </span>
              </span>
            </p>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="hoa-tab hoa-liquid-glass px-4 py-2 text-xs font-semibold"
              :disabled="automationSaving || !automation"
              @click="saveAutomation"
            >
              {{ automationSaving ? t('adminScanSaving') : t('adminScanSave') }}
            </button>

            <!-- The server's own answer, not the form's: what changed, and what the scheduler says now. -->
            <p v-if="automationSaved" class="text-[11px] font-semibold text-emerald-400">
              {{ t('adminScanSaved') }}:
              {{ minutes(automationSaved.from.characterScan.intervalMs) }} →
              {{ minutes(automationSaved.to.characterScan.intervalMs) }},
              {{ num(automationSaved.from.characterScan.batchSize) }} →
              {{ num(automationSaved.to.characterScan.batchSize) }} ·
              {{ automationSaved.to.characterScan.enabled ? t('adminScanArmed') : t('adminScanPaused') }} ·
              {{ t('adminScanNextRun') }} {{ clock(automation?.scheduler.nextRunAt) }}
            </p>
            <p v-else-if="automationSaveErrors.length" class="text-[11px] font-semibold text-red-400">
              {{ t('adminScanInvalid') }}: <span class="font-mono">{{ automationSaveErrors.join(', ') }}</span>
            </p>
            <p v-else-if="automationSaveFailed" class="text-[11px] font-semibold text-red-400">
              {{ t('adminScanSaveFailed') }}
            </p>
          </div>

          <!-- One batch, on demand. It is the scanner's own batch: the same due characters, the same saved batch
               size, the same retry state and the same one-pass-at-a-time claim - so a press can never read more
               than one batch and can never run beside the timer. -->
          <div class="mt-4 rounded-xl border border-wow-gold/25 bg-wow-gold/[0.06] p-3">
            <p class="text-xs font-bold text-wow-goldLight">{{ t('adminRunTitle') }}</p>
            <p class="mt-0.5 text-[11px] leading-relaxed text-gray-400">{{ t('adminRunHint') }}</p>
            <p class="mt-1 text-[11px] text-gray-300">
              {{ t('adminRunEstimate') }}: {{ num(automation?.estimate.due) }} {{ t('adminRunDue') }} ·
              {{ num(automation?.estimate.batchSize) }} × {{ num(automation?.limits.requestsPerCharacter) }} ≈
              {{ num(automation?.estimate.potentialRequests) }} {{ t('adminRunRequests') }}
            </p>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <template v-if="!runConfirming">
                <button
                  type="button"
                  class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs font-semibold"
                  :disabled="runState === 'running' || !automation"
                  @click="runConfirming = true"
                >
                  {{ runState === 'running' ? t('adminRunRunning') : t('adminRunGo') }}
                </button>
              </template>

              <template v-else>
                <button
                  type="button"
                  class="hoa-tab hoa-liquid-glass hoa-tab-active px-3 py-1.5 text-xs font-semibold"
                  @click="runScanNow"
                >
                  {{ t('adminRunConfirm') }}
                </button>
                <button
                  type="button"
                  class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs font-semibold"
                  @click="runConfirming = false"
                >
                  {{ t('adminCancel') }}
                </button>
                <span class="basis-full text-[11px] font-semibold text-amber-300">{{ t('adminRunWarning') }}</span>
              </template>

              <p v-if="runState === 'done' && runResult" class="basis-full text-[11px] font-semibold text-emerald-400">
                {{ t('adminRunDone') }}: {{ t('adminRowSyncChecked') }} {{ num(runResult.counters.checked) }},
                {{ t('adminRowSyncUpdated') }} {{ num(runResult.counters.updated) }},
                {{ t('adminRowSyncSkipped') }} {{ num(runResult.counters.skipped) }},
                {{ t('adminRowSyncErrors') }} {{ num(runResult.counters.errors) }} ·
                {{ t('adminRunRemaining') }} {{ num(runResult.due) }}
              </p>
              <p v-else-if="runState === 'busy'" class="text-[11px] font-semibold text-amber-300">
                {{ t('adminRunBusy') }}
              </p>
              <p v-else-if="runState === 'throttled'" class="text-[11px] font-semibold text-amber-300">
                {{ t('adminRunThrottled') }}
              </p>
              <p v-else-if="runState === 'failed'" class="text-[11px] font-semibold text-red-400">
                {{ t('adminRunFailed') }}
              </p>
            </div>
          </div>
        </section>

        <!-- Every automation the site really has, one row each - including the ones the panel cannot switch, with
             the reason rather than a dead toggle. It is the inventory the code was searched for, drawn from the
             live state: the scanner's row reads the same scheduler and the same pass counters as the card above. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">{{ t('adminJobsTitle') }}</h2>
          <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminJobsHint') }}</p>

          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[36rem] text-left text-[11px]">
              <thead class="text-[10px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th class="py-1 pr-3 font-semibold">{{ t('adminJobsColName') }}</th>
                  <th class="py-1 pr-3 font-semibold">{{ t('adminJobsColStatus') }}</th>
                  <th class="py-1 pr-3 font-semibold">{{ t('adminJobsColSchedule') }}</th>
                  <th class="py-1 pr-3 font-semibold">{{ t('adminJobsColLastRun') }}</th>
                  <th class="py-1 pr-3 font-semibold">{{ t('adminJobsColResult') }}</th>
                  <th class="py-1 font-semibold">{{ t('adminJobsColControl') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="job in AUTOMATION_JOBS" :key="job.id" class="border-t border-white/5 align-top">
                  <td class="py-1.5 pr-3">
                    <span class="font-semibold text-gray-100">{{ t(job.nameKey) }}</span>
                    <span class="block text-[10px] text-gray-500">{{ t(job.kindKey) }}</span>
                  </td>
                  <td class="py-1.5 pr-3 text-gray-300">{{ jobStatus(job) }}</td>
                  <td class="py-1.5 pr-3 tabular-nums text-gray-300">{{ jobSchedule(job) }}</td>
                  <td class="py-1.5 pr-3 tabular-nums text-gray-300">
                    {{ job.id === 'character_scan' ? clock(diagnostics?.sync.lastStartAt) : '—' }}
                  </td>
                  <td class="py-1.5 pr-3 tabular-nums text-gray-300">
                    <template v-if="job.id === 'character_scan'">
                      {{ num(diagnostics?.sync.checked) }} / {{ num(diagnostics?.sync.errors) }}
                    </template>
                    <template v-else>—</template>
                  </td>
                  <td class="py-1.5 text-gray-400">
                    <span v-if="job.managed">{{ t('adminJobsControlCard') }}</span>
                    <span v-else>
                      {{ t('adminJobNotManaged') }}
                      <span class="block text-[10px] text-gray-500">{{ t(job.reasonKey) }}</span>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- The last twenty entries of the in-process log: a note, a worry or a failure, with the category
             that says which part of the site filed it. The buffer is bounded and dies with the process. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ t('adminErrorsTitle') }}
          </h2>
          <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminErrorsExplain') }}</p>

          <p v-if="!diagnostics?.errors.length" class="mt-3 text-xs text-gray-500">{{ t('adminErrorsEmpty') }}</p>

          <ul v-else class="mt-3 space-y-1">
            <li
              v-for="(entry, index) in diagnostics.errors.slice(0, 20)"
              :key="`${entry.at}-${index}`"
              class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5"
            >
              <span class="text-[11px] tabular-nums text-gray-500" :title="clock(entry.at)">
                {{ clock(entry.lastAt) }}
              </span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                :class="
                  entry.level === 'error'
                    ? 'bg-red-500/15 text-red-300'
                    : entry.level === 'warn'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-white/10 text-gray-300'
                "
              >
                {{ entry.level }}
              </span>
              <span class="font-mono text-[10px] uppercase text-gray-400">{{ entry.category }}</span>
              <span v-if="entry.status" class="text-[10px] tabular-nums text-gray-500">{{ entry.status }}</span>
              <!-- A repeated failure is one line with a count, so a broken character cannot fill the log. -->
              <span
                v-if="entry.count > 1"
                class="rounded bg-white/10 px-1 text-[10px] font-bold tabular-nums text-gray-200"
                :title="t('adminErrorsRepeats')"
              >
                ×{{ entry.count }}
              </span>
              <span class="min-w-0 flex-1 basis-full break-words text-xs text-gray-200 sm:basis-auto">
                {{ entry.message }}
              </span>
              <!-- Which character it was, which step failed, and when it will be tried again: the four facts an
                   operator needs to act, and none of them a token, a URL or a BattleTag. -->
              <span v-if="entryContext(entry)" class="basis-full font-mono text-[10px] text-gray-500">
                {{ entryContext(entry) }}
              </span>
            </li>
          </ul>
        </section>

        <!-- The dangerous half, kept apart from everything above it: each action is its own request, checked on
             the server, and only one of them may run at a time. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">{{ t('adminToolsTitle') }}</h2>
          <p class="mt-1 text-[11px] leading-relaxed text-gray-500">{{ t('adminToolsHint') }}</p>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <!-- One character, named. The site's own reader does the work, so its cache, its cooldown and its
                 history rules all apply - and the character must already be one the site holds. -->
            <div class="rounded-xl border border-white/10 bg-black/20 p-3">
              <p class="text-xs font-bold text-white">{{ t('adminRefreshCharacterTitle') }}</p>
              <p class="mt-0.5 text-[11px] leading-relaxed text-gray-500">{{ t('adminRefreshCharacterHint') }}</p>

              <div class="mt-2 flex flex-wrap gap-2">
                <select
                  v-model="refreshForm.region"
                  class="rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-wow-gold/60"
                >
                  <option value="eu">EU</option>
                  <option value="us">US</option>
                </select>
                <input
                  v-model="refreshForm.realm"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="t('adminRefreshCharacterRealm')"
                  class="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-wow-gold/60"
                >
                <input
                  v-model="refreshForm.name"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="t('adminRefreshCharacterName')"
                  class="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-wow-gold/60"
                >
              </div>

              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs font-semibold"
                  :disabled="!refreshRunnable"
                  @click="runCharacterRefresh"
                >
                  {{ refreshState === 'running' ? t('adminRefreshCharacterRunning') : t('adminRefreshCharacterRun') }}
                </button>

                <p v-if="refreshState === 'updated'" class="text-[11px] font-semibold text-emerald-400">
                  {{ t('adminRefreshCharacterOk') }}
                </p>
                <p v-else-if="refreshState === 'unchanged'" class="text-[11px] font-semibold text-gray-400">
                  {{ t('adminRefreshCharacterUnchanged') }}
                </p>
                <p v-else-if="refreshState === 'busy'" class="text-[11px] font-semibold text-amber-300">
                  {{ t('adminRefreshCharacterBusy') }}
                </p>
                <p v-else-if="refreshState === 'failed'" class="text-[11px] font-semibold text-red-400">
                  {{ t('adminRefreshCharacterFailed') }}
                </p>
              </div>
            </div>

            <!-- SQLite's own light maintenance: one pragma, on request, behind a confirmation. -->
            <div class="rounded-xl border border-white/10 bg-black/20 p-3">
              <p class="text-xs font-bold text-white">{{ t('adminOptimizeTitle') }}</p>
              <p class="mt-0.5 text-[11px] leading-relaxed text-gray-500">{{ t('adminOptimizeHint') }}</p>

              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button
                  v-if="!optimizeConfirming"
                  type="button"
                  class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs font-semibold"
                  :disabled="optimizeState === 'running'"
                  @click="optimizeConfirming = true"
                >
                  {{ optimizeState === 'running' ? t('adminOptimizeRunning') : t('adminOptimizeRun') }}
                </button>

                <template v-else>
                  <button
                    type="button"
                    class="hoa-tab hoa-liquid-glass hoa-tab-active px-3 py-1.5 text-xs font-semibold"
                    @click="runOptimize"
                  >
                    {{ t('adminConfirm') }}
                  </button>
                  <button
                    type="button"
                    class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs font-semibold"
                    @click="optimizeConfirming = false"
                  >
                    {{ t('adminCancel') }}
                  </button>
                </template>

                <p v-if="optimizeState === 'ok'" class="text-[11px] font-semibold text-emerald-400">
                  {{ t('adminOptimizeOk') }}
                </p>
                <p v-else-if="optimizeState === 'failed'" class="text-[11px] font-semibold text-red-400">
                  {{ t('adminOptimizeFailed') }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <!-- The maxima the comparison board measures a row against. Only the figures whose size nobody publishes,
             and only those: a collection's total arrives with its own reading and is never stated here. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ t('adminMetricMaximaTitle') }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('adminMetricMaximaHint') }}</p>

          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <label v-for="metric in EDITABLE_METRIC_MAXIMA" :key="metric" class="block">
              <span class="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {{ labelOf(metric) }}
              </span>
              <input
                v-model="maximaDraft[metric]"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :placeholder="t('adminMetricEmpty')"
                class="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold tabular-nums text-white outline-none transition-colors placeholder:font-normal placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60"
              >
            </label>
          </div>

          <p class="mt-3 text-[11px] leading-relaxed text-gray-500">{{ t('adminMetricEmptyHint') }}</p>
        </section>
        <!-- The foundation: a page's copy, keyed `page.slug`. Nothing reads it yet - the store, the validation and
             the way in are what this section establishes - so it draws the shape of a row and no more. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ t('adminContentTitle') }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('adminContentHint') }}</p>

          <p v-if="!contentDraft.length" class="mt-4 text-xs text-gray-500">{{ t('adminContentEmpty') }}</p>

          <ul v-else class="mt-4 space-y-2">
            <li v-for="(row, index) in contentDraft" :key="index" class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="row.key"
                type="text"
                autocomplete="off"
                spellcheck="false"
                :placeholder="t('adminContentKey')"
                class="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs font-semibold text-white outline-none transition-colors placeholder:font-normal placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60 sm:w-64"
              >
              <input
                v-model="row.value"
                type="text"
                autocomplete="off"
                :placeholder="t('adminContentValue')"
                class="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60"
              >
              <button
                type="button"
                class="shrink-0 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:border-red-400/50 hover:bg-red-500/20"
                :aria-label="t('adminContentRemove')"
                :title="t('adminContentRemove')"
                @click="removeContentRow(index)"
              >
                {{ t('adminContentRemove') }}
              </button>
            </li>
          </ul>

          <button
            type="button"
            class="hoa-tab hoa-liquid-glass mt-3 inline-flex px-4 py-2 text-xs font-semibold"
            @click="addContentRow"
          >
            {{ t('adminContentAdd') }}
          </button>
        </section>

        <!-- The save, with the three answers it can give under it: what the panel shows afterwards is the store's
             own reply rather than the form's, so a value the store dropped does not look like a value it kept. -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-5 py-2.5 text-sm font-semibold"
            :class="{ 'hoa-tab-active': saved }"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? t('adminSaving') : t('adminSave') }}
          </button>

          <p v-if="saved" class="text-xs font-semibold text-emerald-400">{{ t('adminSaved') }}</p>
          <p v-else-if="failed" class="text-xs font-semibold text-red-400">{{ t('adminSaveFailed') }}</p>
        </div>
      </div>
    </main>

    <!-- The same sign-off every page of the site carries, in the same place and the same size: the footer is
         the page's last row rather than a block of its own, and the flex column above is what holds it at the
         bottom of a short panel (`flex-1` on the main) exactly as the front page and the documents do. -->
    <footer class="relative container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>
  </div>
</template>

