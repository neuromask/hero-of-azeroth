/**
 * What the running process can honestly say about itself, and where the panel reads it.
 *
 * One small module, holding three things that are the same kind of thing:
 *
 *   - a **log** of the last hundred things worth telling an operator (a note, a worry, a failure), written by
 *     the handful of places that already handle a failure - the Blizzard wrapper, the background sync, a
 *     character read, the migrations, an administrator's own action. It is deliberately *not* a hook on
 *     `console`: swallowing the whole process's output to build a panel would be a larger, riskier change than
 *     the panel is for, so the points that matter call `recordDiagnostic` for themselves;
 *   - **counters** for the Blizzard calls the process made (how many, how many failed, how many were 429s,
 *     timeouts, 5xx, and how slow) spread over twelve fixed five-minute slots - a fixed array, never one
 *     entry per call;
 *   - the **state of the background pass**: whether one is running, what started it, when it started and
 *     finished, and what it found.
 *
 * Nothing here is written to SQLite: the buffers live in the process and reset with it, which is stated in the
 * panel rather than left for a reader to discover (`adminBlizzardExplain`, `adminErrorsExplain`). Nothing here
 * changes what a request returns or which error it throws - every recorder is a side-effect beside the real
 * answer.
 *
 * The log is bounded and *sanitised*: a message that reaches it may have carried a token, a query string, a
 * BattleTag, a character's name or an upstream body, so `sanitise` strips those shapes before the entry is
 * stored - a diagnostics panel is the last place that may become a leak.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  BLIZZARD_BUCKET_COUNT,
  BLIZZARD_BUCKET_MS,
  BLIZZARD_CATEGORIES,
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_LOG_LIMIT,
  DIAGNOSTIC_REPEAT_WINDOW_MS,
  DIAGNOSTICS_TTL_MS,
  SYNC_INTERVAL_MS,
  type AdminDiagnostics,
  type BlizzardBucket,
  type BlizzardCategory,
  type BlizzardCategoryReport,
  type BlizzardReport,
  type BlizzardStatusCount,
  type DatabaseFileReport,
  type DiagnosticCategory,
  type DiagnosticContext,
  type DiagnosticEntry,
  type DiagnosticLevel,
  type MemorySample,
  type SyncPassCounters,
  type SyncReport
} from '#shared/data/adminDiagnostics'
import { dataDirectory } from './appPaths'
import { nowSec } from './db'

/**
 * The RSS above which the process files a warning about itself, in bytes (512 MiB).
 *
 * The site is documented to run in about 416 MiB, so a reading past this is a fact an operator has to be told -
 * and told with a timestamp, which is the one thing a single glance at the panel cannot give. It is deliberately
 * a *warning* and not a bound: nothing here evicts or restarts anything, because a panel that silently killed
 * caches to keep a number small would be hiding the thing it exists to show.
 */
export const MEMORY_WARN_BYTES = 512 * 1024 * 1024

/** What the buffers were holding when the panel asked, which is all the endpoint merges. */
export interface DiagnosticBuffers {
  errors: DiagnosticEntry[]
  blizzardApi: BlizzardReport
  sync: SyncReport
}

/** Which of the two passes ran: the site's own timer, or a page asking for its roster. */
export type SyncSource = 'timer' | 'on-demand'

/** The log: a ring of at most `DIAGNOSTIC_LOG_LIMIT` entries, oldest first. */
const log: DiagnosticEntry[] = []

/** Everything the process has seen of Blizzard since it started. */
const blizzard = {
  since: nowSec(),
  total: 0,
  ok: 0,
  failed: 0,
  rateLimited: 0,
  timeouts: 0,
  serverErrors: 0,
  lastCallAt: null as number | null,
  lastOkAt: null as number | null,
  lastErrorCategory: null as DiagnosticCategory | null,
  lastMs: null as number | null,
  sumMs: 0,
  toleratedAbsences: 0
}

/** The last hour in twelve fixed slots, keyed by the slot's start so a slot never has to be searched for. */
const buckets = new Map<number, { calls: number; failed: number; sumMs: number }>()

/**
 * The same counters cut by what was called and by what came back.
 *
 * Both maps are keyed by a *closed* vocabulary - the fourteen categories the site knows, and an HTTP status -
 * so neither can grow with the amount of traffic, and neither can hold a URL, a realm or a name.
 */
const byCategory = new Map<BlizzardCategory, { calls: number; ok: number; failed: number; sumMs: number }>()
const byStatus = new Map<number, number>()

/** The last hour of process memory in twelve fixed slots, keyed the same way the Blizzard buckets are. */
const memorySlots = new Map<number, MemorySample>()

/** The largest RSS this process has reported since it started. */
let peakRssBytes = 0

/** The background pass, as it is running or as it last ran. */
const sync = {
  running: false,
  source: null as SyncSource | null,
  startedAtMs: null as number | null,
  lastStartAt: null as number | null,
  lastFinishAt: null as number | null,
  lastDurationMs: null as number | null,
  checked: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  passes: 0,
  lastErrorAt: null as number | null,
  lastErrorCategory: null as DiagnosticCategory | null,
  manualCount: 0,
  manualLastAt: null as number | null,
  manualOutcome: null as 'updated' | 'unchanged' | 'failed' | null,
  timerTicks: 0,
  timerSkipped: 0,
  lastTickAt: null as number | null,
  parked: 0,
  nextRetryAt: null as number | null
}

/** The one manual operation in flight, or `null`: an administrator's action runs one at a time. */
let manualOperation: string | null = null

/** How long a manual character refresh is refused after the last one, in milliseconds. */
export const MANUAL_REFRESH_COOLDOWN_MS = 5_000

let manualRefreshAt = 0

/** The cached answer and its moment: the endpoint reads this rather than rebuilding it. */
let cachedReport: { at: number; value: AdminDiagnostics } | null = null

/**
 * A message an operator may read, with the shapes that must not leave the process taken out of it.
 *
 * A failure's own text is the most likely place for a token, a query string, a BattleTag or a long opaque
 * identifier to be sitting, so the entry that is *kept* is a bounded, neutral line - never the raw exception
 * text. The category the panel prints is the recorder's argument, never something parsed out of the message.
 */
function sanitise(message: unknown): string {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return 'unspecified failure'

  return (
    text
      // A whole URL becomes one word: host, path and any query a caller put in it all go.
      .replace(/\bhttps?:\/\/\S+/gi, '[url]')
      // `Authorization: Bearer …` / `Basic …`, and a bare `Bearer …`.
      .replace(/\b(?:authorization\s*:\s*)?(?:bearer|basic)\s+[A-Za-z0-9\-._~+/=]+/gi, '[redacted]')
      // A BattleTag, which names a reader.
      .replace(/\b[A-Za-z][A-Za-z0-9]{2,11}#\d{3,7}\b/g, '[battletag]')
      // A long opaque run of characters: a token, a secret, a signed blob.
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
      // Anything left of a query string.
      .replace(/[?&][A-Za-z0-9_%.-]+=\S{1,64}/g, '[query]')
      .slice(0, 200)
  )
}

/**
 * The key two entries are the same entry by: the same thing, from the same place, about the same character.
 *
 * The *message* is deliberately not in the key beyond its text - two failures of the retry loop a pass apart are
 * one line with a count of two, which is what keeps a broken character from filling the whole hundred-entry ring
 * and hiding everything else.
 */
function repeatKey(entry: DiagnosticEntry): string {
  const context = entry.context || {}
  return [
    entry.level,
    entry.category,
    entry.message,
    entry.status ?? '',
    context.characterId ?? '',
    context.stage ?? ''
  ].join('|')
}

/** Files an entry, folding it into an identical recent one instead of pushing a copy. Never throws. */
export function recordDiagnostic(input: {
  level: DiagnosticLevel
  category: DiagnosticCategory | string
  message: unknown
  status?: number
  context?: DiagnosticContext
}): DiagnosticEntry {
  const category = (DIAGNOSTIC_CATEGORIES as readonly string[]).includes(input.category)
    ? (input.category as DiagnosticCategory)
    : 'other'

  const at = nowSec()
  const entry: DiagnosticEntry = {
    at,
    level: input.level,
    category,
    message: sanitise(input.message),
    lastAt: at,
    count: 1
  }

  // A status is kept only when it is a real HTTP status, so the panel can print it beside the category
  // without ever guessing.
  if (typeof input.status === 'number' && input.status >= 100 && input.status < 600) entry.status = input.status

  // The context is only there when something in it survived: a context whose every field was refused says
  // nothing, and an empty one printed beside the message would suggest it does.
  if (input.context) {
    const context = sanitiseContext(input.context)
    if (Object.keys(context).length) entry.context = context
  }

  const key = repeatKey(entry)
  const existing = log.findIndex((held) => repeatKey(held) === key && held.lastAt > at - DIAGNOSTIC_REPEAT_WINDOW_MS / 1000)

  if (existing >= 0) {
    const held = log[existing]!
    held.count += 1
    held.lastAt = at
    // The newest attempt's own facts replace the older ones, so the line is about the failure as it stands now.
    if (entry.status !== undefined) held.status = entry.status
    if (entry.context) held.context = entry.context

    // Moved to the end, so "newest first" still reads as "what just happened" and the ring drops the oldest.
    log.splice(existing, 1)
    log.push(held)
    return held
  }

  log.push(entry)
  if (log.length > DIAGNOSTIC_LOG_LIMIT) log.splice(0, log.length - DIAGNOSTIC_LOG_LIMIT)

  return entry
}

/** The context as it may be stored: a bounded number, a region the site serves, a slug, a stage word. */
function sanitiseContext(context: DiagnosticContext): DiagnosticContext {
  const kept: DiagnosticContext = {}

  if (typeof context.characterId === 'number' && Number.isInteger(context.characterId) && context.characterId > 0) {
    kept.characterId = context.characterId
  }

  if (context.region === 'eu' || context.region === 'us') kept.region = context.region
  if (typeof context.realm === 'string' && /^[a-z0-9'-]{1,40}$/.test(context.realm)) kept.realm = context.realm
  if (typeof context.stage === 'string' && /^[a-z-]{1,20}$/.test(context.stage)) kept.stage = context.stage
  if (typeof context.attempts === 'number' && Number.isFinite(context.attempts) && context.attempts > 0) {
    kept.attempts = Math.round(context.attempts)
  }
  if (typeof context.nextAttemptAt === 'number' && Number.isFinite(context.nextAttemptAt)) {
    kept.nextAttemptAt = Math.round(context.nextAttemptAt)
  }

  return kept
}

/** The slot a moment belongs to, swept to the window the panel draws. */
function slotOf(atMs: number): number {
  return Math.floor(atMs / BLIZZARD_BUCKET_MS) * BLIZZARD_BUCKET_MS
}

/**
 * Counts one call to Blizzard, as the wrapper sees it.
 *
 * Called with the *outcome* rather than the error, so the classification this module does not own (is a 429 a
 * rate limit, did a call run past the deadline) is decided where it already is - in the Blizzard wrapper - and
 * nothing here has to guess it a second time.
 *
 * The `category` is the *shape* of the endpoint, never its address: it is what lets the panel say "sixty of
 * those failures were collection documents" without holding a URL, a realm or a name.
 */
export function recordBlizzardCall(input: {
  ok: boolean
  durationMs: number
  status?: number
  timeout?: boolean
  category?: BlizzardCategory | string
}): void {
  const now = Date.now()
  const at = nowSec()
  // A call that was answered *is* a `2xx`, even though nothing here reads the exact code: ofetch resolves on
  // any 2xx and rejects otherwise. A call that was not answered at all - a timeout, a dead connection - is a
  // `0`, which is what makes the status breakdown readable rather than a soup of zeroes.
  const status = input.ok ? Number(input.status || 200) : Number(input.status || 0)
  const duration = Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0
  const category = (BLIZZARD_CATEGORIES as readonly string[]).includes(String(input.category))
    ? (input.category as BlizzardCategory)
    : 'other'

  blizzard.total += 1
  blizzard.lastCallAt = at
  blizzard.lastMs = duration
  blizzard.sumMs += duration

  // A fixed map, swept to twelve slots: a hot hour cannot make this grow.
  const slot = slotOf(now)
  const bucket = buckets.get(slot) ?? { calls: 0, failed: 0, sumMs: 0 }
  bucket.calls += 1
  bucket.sumMs += duration

  // The two breakdowns are keyed by a closed vocabulary, so they are bounded by construction.
  const cut = byCategory.get(category) ?? { calls: 0, ok: 0, failed: 0, sumMs: 0 }
  cut.calls += 1
  cut.sumMs += duration
  byCategory.set(category, cut)

  byStatus.set(status, (byStatus.get(status) ?? 0) + 1)

  if (input.ok) {
    blizzard.ok += 1
    blizzard.lastOkAt = at
    cut.ok += 1
  } else {
    bucket.failed += 1
    blizzard.failed += 1
    cut.failed += 1

    if (input.timeout) blizzard.timeouts += 1
    else if (status === 429) blizzard.rateLimited += 1
    else if (status >= 500) blizzard.serverErrors += 1

    blizzard.lastErrorCategory = 'blizzard'
  }

  buckets.set(slot, bucket)

  const cutoff = slotOf(now) - (BLIZZARD_BUCKET_COUNT - 1) * BLIZZARD_BUCKET_MS
  for (const held of buckets.keys()) if (held < cutoff) buckets.delete(held)
}

/**
 * Files a failed *optional* document - one the profile read tolerates and the operation survives.
 *
 * It is counted apart from `failed`, and never *instead* of it: the request really did fail, and nothing here
 * turns it into a success. What it adds is the one thing the panel could not say before - how much of a wave of
 * failures an operator does not have to act on. A character whose Mythic+ history does not exist is not a broken
 * character, and a page that reports it as one is a page nobody reads twice.
 */
export function recordToleratedAbsence(): void {
  // Only the classification: the call itself was already counted as a failed request when it failed, and
  // counting its status twice would make the breakdown disagree with the totals.
  blizzard.toleratedAbsences += 1
}

/**
 * Claims the background pass, or refuses because one is already running.
 *
 * One flag for both the timer and a page's on-demand run, which is the whole point: two passes over the same
 * rosters at the same moment would spend the site's Blizzard quota twice on the same characters. The answer is
 * a verdict rather than a thrown error, because the caller of a background pass is a timer that has nothing to
 * tell anybody - it simply skips this tick.
 */
export function beginSyncPass(source: SyncSource): boolean {
  if (sync.running) return false

  sync.running = true
  sync.source = source
  sync.startedAtMs = Date.now()
  sync.lastStartAt = nowSec()

  return true
}

/** Closes the pass `beginSyncPass` claimed, with what it found. */
export function finishSyncPass(source: SyncSource, counters: SyncPassCounters): void {
  // A pass that was refused never started; only the one that holds the claim closes it - so a late `finish`
  // from a stale caller cannot clear a pass somebody else is running.
  if (!sync.running || sync.source !== source) return

  const now = Date.now()
  sync.running = false
  sync.lastFinishAt = nowSec()
  sync.lastDurationMs = sync.startedAtMs === null ? null : Math.max(0, now - sync.startedAtMs)
  sync.checked = counters.checked
  sync.updated = counters.updated
  sync.skipped = counters.skipped
  sync.errors = counters.errors
  sync.passes += 1

  if (counters.errors > 0) {
    sync.lastErrorAt = nowSec()
    sync.lastErrorCategory = 'sync'
  }
}

/** Files why a pass ended badly, which the panel prints beside the pass it belongs to. */
export function recordSyncError(category: DiagnosticCategory = 'sync'): void {
  sync.lastErrorAt = nowSec()
  sync.lastErrorCategory = category
}

/**
 * Counts one tick of the background timer, and whether it found a pass already running.
 *
 * This is the counter that answers "three passes in forty minutes": a tick is the timer *firing*, a pass is the
 * work it started. A timer that fired fourteen times with eleven refusals, and a timer that fired three times at
 * all, look identical in the pass count and are entirely different problems.
 */
export function recordTimerTick(skipped: boolean): void {
  sync.timerTicks += 1
  sync.lastTickAt = nowSec()
  if (skipped) sync.timerSkipped += 1
}

/**
 * Takes the single manual-operation slot, or answers who holds it.
 *
 * A character refresh and a database maintenance run both write, and an operator who pressed twice should be
 * told the second press did nothing rather than be given two runs at once. The slot is a string naming the
 * operation, which the panel echoes back when it refuses.
 */
export function claimManualOperation(name: string): boolean {
  if (manualOperation) return false
  manualOperation = name
  return true
}

/** Releases the slot, however the operation ended. */
export function releaseManualOperation(name: string): void {
  if (manualOperation === name) manualOperation = null
}

/** The name of the operation in flight, or `null`. */
export function manualOperationRunning(): string | null {
  return manualOperation
}

/**
 * Counts an administrator's own single-character refresh, apart from the passes.
 *
 * It is deliberately not folded into `sync`: a manual action is charged to a person who can be told its result
 * (`/api/admin/character-refresh`), while a pass is the site's own and has nobody to report to.
 */
export function recordManualRefresh(outcome: 'updated' | 'unchanged' | 'failed'): void {
  sync.manualCount += 1
  sync.manualLastAt = nowSec()
  sync.manualOutcome = outcome
}

/** Whether a manual refresh is inside its cooldown, and for how many more seconds. */
export function manualRefreshCoolingDown(): number {
  const since = Date.now() - manualRefreshAt
  if (since >= MANUAL_REFRESH_COOLDOWN_MS) return 0
  return Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - since) / 1000)
}

/** Charges the manual-refresh cooldown. */
export function chargeManualRefresh(): void {
  manualRefreshAt = Date.now()
}

/** The last hour in twelve slots, oldest first, including the quiet ones the process has no entry for. */
function blizzardBuckets(): BlizzardBucket[] {
  const newestSlot = slotOf(Date.now())
  const slots: BlizzardBucket[] = []

  for (let index = BLIZZARD_BUCKET_COUNT - 1; index >= 0; index -= 1) {
    const slot = newestSlot - index * BLIZZARD_BUCKET_MS
    const held = buckets.get(slot)

    if (!held) {
      slots.push({ at: Math.floor(slot / 1000), calls: 0, failed: 0, averageMs: null })
      continue
    }

    slots.push({
      at: Math.floor(slot / 1000),
      calls: held.calls,
      failed: held.failed,
      averageMs: held.calls ? Math.round(held.sumMs / held.calls) : null
    })
  }

  return slots
}

/** The Blizzard counters as the panel reads them. */
function blizzardReport(): BlizzardReport {
  return {
    since: blizzard.since,
    total: blizzard.total,
    ok: blizzard.ok,
    failed: blizzard.failed,
    rateLimited: blizzard.rateLimited,
    timeouts: blizzard.timeouts,
    serverErrors: blizzard.serverErrors,
    lastCallAt: blizzard.lastCallAt,
    lastOkAt: blizzard.lastOkAt,
    lastErrorCategory: blizzard.lastErrorCategory,
    lastMs: blizzard.lastMs,
    averageMs: blizzard.total ? Math.round(blizzard.sumMs / blizzard.total) : null,
    buckets: blizzardBuckets(),
    // Categories with no calls are left out rather than printed as zeroes: a row that says "nothing was ever
    // asked of this endpoint" is noise in a panel that is read while something is wrong.
    byCategory: (BLIZZARD_CATEGORIES as readonly BlizzardCategory[])
      .filter((category) => (byCategory.get(category)?.calls ?? 0) > 0)
      .map((category): BlizzardCategoryReport => {
        const cut = byCategory.get(category)!
        return {
          category,
          calls: cut.calls,
          ok: cut.ok,
          failed: cut.failed,
          averageMs: cut.calls ? Math.round(cut.sumMs / cut.calls) : null
        }
      })
      .sort((left, right) => right.calls - left.calls),
    byStatus: [...byStatus.entries()]
      .map(([status, calls]): BlizzardStatusCount => ({ status, calls }))
      .sort((left, right) => right.calls - left.calls),
    toleratedAbsences: blizzard.toleratedAbsences
  }
}

/** The pass as the panel reads it, with the timer and the retry state's own figures. */
function syncReport(): SyncReport {
  const retry = syncRetrySummary()

  return {
    running: sync.running,
    source: sync.source,
    lastStartAt: sync.lastStartAt,
    lastFinishAt: sync.lastFinishAt,
    lastDurationMs: sync.lastDurationMs,
    checked: sync.checked,
    updated: sync.updated,
    skipped: sync.skipped,
    errors: sync.errors,
    passes: sync.passes,
    lastErrorAt: sync.lastErrorAt,
    lastErrorCategory: sync.lastErrorCategory,
    intervalMs: SYNC_INTERVAL_MS,
    timerTicks: sync.timerTicks,
    timerSkipped: sync.timerSkipped,
    lastTickAt: sync.lastTickAt,
    parked: retry.parked,
    nextRetryAt: retry.nextRetryAt,
    manual: { count: sync.manualCount, lastAt: sync.manualLastAt, lastOutcome: sync.manualOutcome }
  }
}

/**
 * How many characters the retry state is holding back, and when the earliest of them may be tried again.
 *
 * Read from the table rather than from a counter, so the figure is what the database says *now* - an operator who
 * has just looked at the pass should see the parked set the next pass will see, whether or not this process has
 * run a pass since. A database without those columns (an older build, a test's smaller schema) answers `0`, and
 * the panel says "nothing is parked" rather than failing.
 */
function syncRetrySummary(): { parked: number; nextRetryAt: number | null } {
  const now = nowSec()
  return {
    parked: scalar('SELECT COUNT(*) FROM characters WHERE sync_retry_at > ?', now) ?? 0,
    nextRetryAt: scalar('SELECT MIN(sync_retry_at) FROM characters WHERE sync_retry_at > ?', now)
  }
}

/**
 * Everything the in-memory buffers hold, which is the half of the answer no query produces.
 *
 * Exported because the endpoint merges it with the database's own half, and because a test can read it without
 * touching SQLite at all.
 */
export function readDiagnosticBuffers(): DiagnosticBuffers {
  return {
    // Newest first, because a panel is read from the top: the thing that just went wrong is the thing being
    // looked for, and the quiet entries above it are noise.
    errors: [...log].reverse(),
    blizzardApi: blizzardReport(),
    sync: syncReport()
  }
}

/**
 * One file of the database, told apart from the others by its access error rather than by being absent.
 *
 * A file that is simply not there - the `-wal` sidecar of a database that has never been written in WAL mode
 * since it was last checkpointed - is `0` bytes, which is the honest reading of it. A file that *is* there and
 * cannot be read is `null` with `error: true`, because reporting that as `0` would be the one thing this panel
 * must not do: make a permission problem look like an empty database.
 */
function fileReport(name: string): DatabaseFileReport {
  try {
    return { name, bytes: statSync(join(dataDirectory(), name)).size, error: false }
  } catch (error) {
    if ((error as { code?: string })?.code === 'ENOENT') return { name, bytes: 0, error: false }
    return { name, bytes: null, error: true }
  }
}

/** The tables the panel counts, in the order it draws them. */
const COUNTED_TABLES = [
  'users',
  'sessions',
  'characters',
  'snapshots',
  'account_snapshots',
  'leaderboard',
  'account_pool',
  'saved_characters',
  'settings'
] as const

/**
 * A single number out of the database, or `null` when the query itself failed.
 *
 * Every count goes through here so a table this build does not have - a database written by an older one, a
 * test's own smaller schema - is a missing figure rather than a broken panel.
 */
function scalar(query: string, ...params: (string | number)[]): number | null {
  try {
    const row = (useDb().prepare(query).get(...(params as never[])) ?? {}) as Record<string, unknown>
    const value = Object.values(row)[0]
    if (value === null || value === undefined) return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  } catch {
    recordDiagnostic({ level: 'error', category: 'database', message: 'diagnostics query failed' })
    return null
  }
}

/** The database's own half of the answer. */
function databaseReport(): AdminDiagnostics['database'] {
  const rows: Record<string, number> = {}

  for (const table of COUNTED_TABLES) {
    const count = scalar(`SELECT COUNT(*) FROM ${table}`)
    if (count !== null) rows[table] = count
  }

  return {
    files: {
      db: fileReport('hoa.db'),
      wal: fileReport('hoa.db-wal'),
      shm: fileReport('hoa.db-shm')
    },
    rows,
    guests: scalar('SELECT COUNT(*) FROM characters WHERE user_id IS NULL') ?? 0,
    accountCharacters: scalar('SELECT COUNT(*) FROM characters WHERE user_id IS NOT NULL') ?? 0,
    hiddenFromFame: scalar('SELECT COUNT(*) FROM users WHERE hide_from_fame = 1') ?? 0,
    lastStatsReadAt: scalar('SELECT MAX(stats_read_at) FROM characters'),
    lastSnapshotAt: scalar('SELECT MAX(taken_at) FROM snapshots')
  }
}

/**
 * What the runtime says about itself, sampled the way the Blizzard counters are.
 *
 * The sample is taken *here* - once per diagnostics build, i.e. at most once per twenty-second window - so a
 * panel left open for an hour produces twelve readings, not a hundred and eighty. The peak and the trend are the
 * answer to the question a single number cannot answer: is this process holding this much, or did it hold it for
 * a moment?
 */
function systemReport(): AdminDiagnostics['system'] {
  const memory = process.memoryUsage()
  const at = nowSec()

  const slot = slotOf(Date.now())
  memorySlots.set(slot, {
    at,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed
  })

  const cutoff = slot - (BLIZZARD_BUCKET_COUNT - 1) * BLIZZARD_BUCKET_MS
  for (const held of memorySlots.keys()) if (held < cutoff) memorySlots.delete(held)

  peakRssBytes = Math.max(peakRssBytes, memory.rss)

  if (memory.rss > MEMORY_WARN_BYTES) {
    // Repeated readings fold into one line with a count (the log does that itself), so a process that sits above
    // the threshold for an hour leaves one entry that says how long it has been like that - which is the fact an
    // operator needs to correlate with whatever else was happening at the time.
    recordDiagnostic({
      level: 'warn',
      category: 'request',
      message: 'process RSS is above 512 MiB',
      context: { stage: 'maintenance' }
    })
  }

  return {
    startedAt: Math.floor(Date.now() / 1000 - process.uptime()),
    uptimeSeconds: Math.round(process.uptime()),
    node: process.version,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
      peakRssBytes,
      samples: [...memorySlots.keys()]
        .sort((left, right) => left - right)
        .map((held) => memorySlots.get(held)!)
    }
  }
}

/** Builds the answer from scratch: the measured half and the counted half, merged. */
export function buildAdminDiagnostics(): AdminDiagnostics {
  const startedAtMs = Date.now()
  const buffers = readDiagnosticBuffers()
  const system = systemReport()
  const database = databaseReport()

  return {
    generatedAt: nowSec(),
    // Measured last, so the figure the panel prints is the cost of everything above it.
    durationMs: Date.now() - startedAtMs,
    cached: false,
    system,
    database,
    sync: buffers.sync,
    blizzardApi: buffers.blizzardApi,
    errors: buffers.errors
  }
}

/**
 * The answer, cached for `DIAGNOSTICS_TTL_MS`.
 *
 * The panel refreshes itself every twenty seconds while it is open, and a page left open is a page that counts
 * nine tables a minute - so a second reader, or the same reader's refresh a few seconds later, is handed the
 * answer already built. The window is short on purpose: this is a diagnostic, and one that lags a change by
 * half a minute is worse than one whose numbers are a moment old.
 */
export function readAdminDiagnostics(): AdminDiagnostics {
  const now = Date.now()
  if (cachedReport && now - cachedReport.at < DIAGNOSTICS_TTL_MS) return { ...cachedReport.value, cached: true }

  const value = buildAdminDiagnostics()
  cachedReport = { at: now, value }
  return value
}

/** Forgets the cached answer without touching the counters, which a manual action does after it writes. */
export function invalidateDiagnosticsCache(): void {
  cachedReport = null
}

/**
 * Forgets everything this module has counted.
 *
 * The buffers belong to the process, so the only caller with any business clearing them is a test that has to
 * start from a known state - and it is exported for exactly that reason rather than reached into.
 */
export function clearAdminDiagnostics(): void {
  log.length = 0
  buckets.clear()
  byCategory.clear()
  byStatus.clear()
  memorySlots.clear()
  peakRssBytes = 0

  blizzard.since = nowSec()
  blizzard.total = 0
  blizzard.ok = 0
  blizzard.failed = 0
  blizzard.rateLimited = 0
  blizzard.timeouts = 0
  blizzard.serverErrors = 0
  blizzard.lastCallAt = null
  blizzard.lastOkAt = null
  blizzard.lastErrorCategory = null
  blizzard.lastMs = null
  blizzard.sumMs = 0
  blizzard.toleratedAbsences = 0

  sync.running = false
  sync.source = null
  sync.startedAtMs = null
  sync.lastStartAt = null
  sync.lastFinishAt = null
  sync.lastDurationMs = null
  sync.checked = 0
  sync.updated = 0
  sync.skipped = 0
  sync.errors = 0
  sync.passes = 0
  sync.lastErrorAt = null
  sync.lastErrorCategory = null
  sync.manualCount = 0
  sync.manualLastAt = null
  sync.manualOutcome = null
  sync.timerTicks = 0
  sync.timerSkipped = 0
  sync.lastTickAt = null
  sync.parked = 0
  sync.nextRetryAt = null

  manualOperation = null
  manualRefreshAt = 0
  cachedReport = null
}




