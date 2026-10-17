/**
 * What the admin dashboard's diagnostics answer is made of.
 *
 * The panel is a read-only view of what the *running process* can honestly say about itself, so the shape
 * lives here - in front of the endpoint that builds it and the page that draws it - the same way the settings
 * an administrator edits live in `#shared/data/siteSettings`. A field added on one side and not the other is
 * then a type error rather than a card that prints nothing.
 *
 * Everything in here is measured, not estimated: no figure is stated unless something counted it. The whole
 * answer belongs to *this* process - the counters are module-level and the memory is the runtime's own - and
 * it is reset by a restart, which the panel says out loud rather than leaving a reader to guess
 * (`adminBlizzardExplain`, `adminErrorsExplain`).
 */

/** The categories an operator's log entry may carry. Anything else is filed as `other`. */
export const DIAGNOSTIC_CATEGORIES = ['blizzard', 'sync', 'database', 'migration', 'admin', 'request', 'other'] as const

export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number]

/** The three levels an entry may be written at: a fact, a worry, a failure. */
export type DiagnosticLevel = 'info' | 'warn' | 'error'

/** The fixed size of the in-process log: 100 entries, oldest dropped first. */
export const DIAGNOSTIC_LOG_LIMIT = 100

/** How many entries the panel draws of those. */
export const DIAGNOSTIC_LOG_SHOWN = 20

/** How many characters one background pass may read, and how long the timer waits between passes. */
export const SYNC_BATCH = 10
export const SYNC_INTERVAL_MS = 3 * 60 * 1000

/** The one window the diagnostics answer is cached for, in milliseconds (see `readAdminDiagnostics`). */
export const DIAGNOSTICS_TTL_MS = 20_000

/** The buckets the Blizzard counters are spread over: twelve five-minute slots, i.e. the last hour. */
export const BLIZZARD_BUCKET_MS = 5 * 60 * 1000
export const BLIZZARD_BUCKET_COUNT = 12

/** One entry of the in-process log, as the panel reads it. */
export interface DiagnosticEntry {
  /** Seconds since the epoch, of the *first* time this entry was filed. */
  at: number
  level: DiagnosticLevel
  category: DiagnosticCategory
  /** A sanitised, bounded message: never a token, a query string, a BattleTag or an upstream body. */
  message: string
  /** The upstream status where the failure had one, else absent. */
  status?: number
  /** Seconds since the epoch, of the newest occurrence of the same entry. */
  lastAt: number
  /** How many times the same thing has been filed inside the repeat window (1 for a one-off). */
  count: number
  /**
   * The safe identity of what failed, where the recorder knows it: an id, an address and the stage of the
   * read. Deliberately only these - a character's id and its normalized address are the most an operator needs
   * to find the row, and nothing here can carry a token, a URL or a BattleTag.
   */
  context?: DiagnosticContext
}

/** What a log entry may say about the thing that failed, and nothing more. */
export interface DiagnosticContext {
  characterId?: number
  /** `eu` or `us`. */
  region?: string
  /** The realm's slug, as the site stores it. */
  realm?: string
  /** Which step of a read failed: `profile`, `optional`, `sync`, `store`. */
  stage?: string
  /** How many times this character has failed in a row, where the retry state knows. */
  attempts?: number
  /** When the next attempt is allowed, in seconds since the epoch. */
  nextAttemptAt?: number
}

/** How long identical entries are folded into one: a repeated failure is one line with a count, not a flood. */
export const DIAGNOSTIC_REPEAT_WINDOW_MS = 30 * 60 * 1000

/** The steps a read can fail at, so a log entry can say which one it was. */
export const DIAGNOSTIC_STAGES = ['profile', 'optional', 'sync', 'store', 'maintenance'] as const
export type DiagnosticStage = (typeof DIAGNOSTIC_STAGES)[number]

/**
 * What one background pass or on-demand run did, as it is counted.
 *
 * The three outcomes are exclusive and exhaustive for the characters the pass examined, which is the invariant
 * the panel leans on:
 *
 *     checked = updated + skipped + errors
 *
 * `checked` is how many characters the pass *took from the query*, and every one of them ends in exactly one of
 * the other three - a read that moved the figures, a read that said what was already on file, or a read that
 * failed. A character the retry state parks (a `404` it has just been given, and the backoff that follows) is
 * *not* checked: it is never selected, so it is reported apart (`parked` in `SyncReport`), not as a skip.
 */
export interface SyncPassCounters {
  /** How many characters the pass examined. */
  checked: number
  /** How many of those reads moved the stored figures (a point was filed). */
  updated: number
  /** How many were read but said exactly what was already on file. */
  skipped: number
  /** How many reads failed. */
  errors: number
}

/** A one-minute-resolution view of a pass, kept small on purpose. */
export interface SyncReport extends SyncPassCounters {
  running: boolean
  /** What started the pass: the site's own timer, a page asking for its roster, or an administrator. */
  source: 'timer' | 'on-demand' | 'manual' | null
  lastStartAt: number | null
  lastFinishAt: number | null
  lastDurationMs: number | null
  /** How many passes have finished since the process started. */
  passes: number
  lastErrorAt: number | null
  lastErrorCategory: DiagnosticCategory | null
  /**
   * The timer, counted apart from the passes: how many times its callback ran, when it last did, and how many
   * of those ticks found a pass already running and did nothing. A tick that found the pass busy is not a pass
   * - which is exactly the number that says whether "three passes in forty minutes" was the timer not firing or
   * the pass being refused.
   */
  intervalMs: number
  timerTicks: number
  timerSkipped: number
  lastTickAt: number | null
  /** How many characters were left out of the last pass's query by the retry state. */
  parked: number
  /** The earliest moment a parked character may be tried again, in seconds since the epoch. */
  nextRetryAt: number | null
  /** The administrator's own single-character refreshes, counted apart from the passes. */
  manual: { count: number; lastAt: number | null; lastOutcome: 'updated' | 'unchanged' | 'failed' | null }
}

/**
 * What asked for a Blizzard call, as a fixed vocabulary.
 *
 * The counters alone could say *what* was called and *what came back*, never *why it happened* - which is the
 * question an operator has when a count is higher than the schedule explains. So every call is tagged at the
 * place that knows the answer (the timer, the profile page, a card, an administrator's own press) and the tag
 * travels down to the wrapper unseen by the code in between (`server/utils/blizzardSource.ts`, an
 * `AsyncLocalStorage`).
 *
 * The list is closed and every entry has a producer in this codebase:
 *
 *   background_scan      the site's own timer (`server/plugins/characterSync.ts`)
 *   profile_sync         the profile page asking for its roster to be filled (`/api/profile/sync`)
 *   profile_read         a page, a shelf or the profile reading a character (public reads)
 *   profile_refresh      the reader pressing Refresh (`?force=true`) on a character
 *   account_refresh      the account's roster and collections being re-read (sign-in, `/api/profile/refresh`)
 *   admin_manual_refresh an administrator refreshing one character from the panel
 *   card_render          a card being drawn, which reads the character it draws
 *   other                anything not tagged - a new caller that has not been classified yet
 *
 * `other` is not a dumping ground for convenience: it is the honest answer for a call nobody has attributed,
 * and a non-zero `other` beside a healthy total is the signal that a new producer needs a tag.
 */
export const BLIZZARD_SOURCES = [
  'background_scan',
  'profile_sync',
  'profile_read',
  'profile_refresh',
  'account_refresh',
  'admin_manual_refresh',
  'card_render',
  'other'
] as const

export type BlizzardSource = (typeof BLIZZARD_SOURCES)[number]

/** One row of the per-source breakdown. */
export interface BlizzardSourceReport {
  source: BlizzardSource
  calls: number
  ok: number
  failed: number
  rateLimited: number
  timeouts: number
  serverErrors: number
  /** The newest call from this source, in seconds since the epoch. */
  lastCallAt: number | null
  /** The newest call's latency, in milliseconds. */
  lastMs: number | null
  averageMs: number | null
  /**
   * The safe category of the last failure from this source, or `null` when it has not failed: a word, never a
   * status body - `timeout`, `rate-limited`, `server-5xx`, `client-4xx`, `network`.
   */
  lastError: string | null
}

/** One slot of the Blizzard call history. */
export interface BlizzardBucket {
  /** The slot's start, in seconds since the epoch. */
  at: number
  calls: number
  failed: number
  averageMs: number | null
}

/**
 * The kinds of call this site makes, as a fixed vocabulary.
 *
 * A category is derived from the *shape* of the endpoint - never from the character in the address - so the
 * panel can say "sixty of those failures were collection documents" without ever holding a URL, a realm or a
 * name. The list is closed, which is what keeps the breakdown a fixed number of rows.
 */
export const BLIZZARD_CATEGORIES = [
  'token',
  'profile',
  'media',
  'collections',
  'reputations',
  'mythic-keystone',
  'pvp',
  'titles',
  'quests',
  'professions',
  'index',
  'realms',
  'other'
] as const

export type BlizzardCategory = (typeof BLIZZARD_CATEGORIES)[number]

/** One row of the per-category breakdown. */
export interface BlizzardCategoryReport {
  category: BlizzardCategory
  calls: number
  ok: number
  failed: number
  averageMs: number | null
}

/** How many calls answered with one status - `0` is a call that never got an answer at all. */
export interface BlizzardStatusCount {
  status: number
  calls: number
}

/**
 * What the process saw of Blizzard - the requests it *made*, not what is left of any quota.
 *
 * Deliberately not called "quota remaining": nothing in this implementation can read a remaining allowance
 * off Blizzard, so the panel prints only what it counted (`adminBlizzardTitle`).
 */
export interface BlizzardReport {
  /** The moment the process started counting, in seconds since the epoch. */
  since: number
  total: number
  ok: number
  failed: number
  rateLimited: number
  timeouts: number
  serverErrors: number
  lastCallAt: number | null
  lastOkAt: number | null
  lastErrorCategory: DiagnosticCategory | null
  /** The newest call's latency in milliseconds. */
  lastMs: number | null
  /** The mean latency of every call this process measured. */
  averageMs: number | null
  /** The last hour in twelve fixed slots, oldest first. */
  buckets: BlizzardBucket[]
  /** The same counters, cut by the kind of endpoint that was called. */
  byCategory: BlizzardCategoryReport[]
  /** The same counters, cut by what asked for the call - the answer to "why is this number this big". */
  bySource: BlizzardSourceReport[]
  /** How many calls answered with each status, so a wave of 404s is visible as one. */
  byStatus: BlizzardStatusCount[]
  /**
   * Failures of *optional* documents - a character's Mythic+ history that does not exist, a collection Blizzard
   * will not answer for - which the profile read tolerates and the operation as a whole survives. They are still
   * counted in `failed` (they *were* failed requests, and nothing here turns one into a success); this is the
   * part of that number an operator does not have to act on.
   */
  toleratedAbsences: number
}

/** One file the database is made of, with the access error told apart from an absent file. */
export interface DatabaseFileReport {
  /** The file's own name - never an absolute path. */
  name: string
  /** The size in bytes, or `null` when the file could not be read for a reason other than absence. */
  bytes: number | null
  /** True when reading the file failed for a reason other than "there is no such file". */
  error: boolean
}

/** What the process can say about its own SQLite file and the rows in it. */
export interface DatabaseReport {
  files: {
    db: DatabaseFileReport
    wal: DatabaseFileReport
    shm: DatabaseFileReport
  }
  /** One count per table the site keeps, keyed by the table's own name. */
  rows: Record<string, number>
  /** The characters nobody signed in for. */
  guests: number
  /** The characters that belong to an account. */
  accountCharacters: number
  /** The accounts that asked to be kept out of the public table. */
  hiddenFromFame: number
  /** The newest `characters.stats_read_at`, in seconds, or `null` when nothing was ever read. */
  lastStatsReadAt: number | null
  /** The newest `snapshots.taken_at`, in seconds, or `null` when there is no history at all. */
  lastSnapshotAt: number | null
}

/** One memory reading, kept so the panel can show a trend rather than a single instant. */
export interface MemorySample {
  /** Seconds since the epoch. */
  at: number
  rssBytes: number
  heapUsedBytes: number
}

/** What the runtime says about itself. */
export interface SystemReport {
  /** When the process started, in seconds since the epoch. */
  startedAt: number
  uptimeSeconds: number
  node: string
  memory: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
    /** Buffers and typed arrays, which `external` also carries and a card cache is mostly made of. */
    arrayBuffersBytes: number
    /**
     * The largest RSS this process has reported since it started, in bytes.
     *
     * It exists because a single reading cannot tell "this is what the process holds" from "this is what it held
     * for a moment": an operator looking at one number cannot tell whether a leak is happening at all. The peak
     * and the trend below are what answer that.
     */
    peakRssBytes: number
    /**
     * The last hour, sampled at most once per diagnostics window, in fixed five-minute slots - the same shape
     * the Blizzard counters use, and for the same reason: a bounded array, never a sample per request.
     */
    samples: MemorySample[]
  }
}

/** The whole answer `/api/admin/diagnostics` gives, and the only shape the panel reads. */
export interface AdminDiagnostics {
  /** When this answer was built, in seconds since the epoch. */
  generatedAt: number
  /** How long building it took, in milliseconds - the cost the panel pays for one refresh. */
  durationMs: number
  /** True when the numbers were served out of the short server-side cache rather than measured again. */
  cached: boolean
  system: SystemReport
  database: DatabaseReport
  sync: SyncReport
  blizzardApi: BlizzardReport
  errors: DiagnosticEntry[]
}
