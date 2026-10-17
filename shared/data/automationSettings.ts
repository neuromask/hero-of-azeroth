/**
 * The automation an administrator owns, and the bounds it may be set to.
 *
 * The site runs exactly one periodic job (`server/plugins/characterSync.ts`): a pass over a few characters whose
 * newest reading is missing or a day old. Everything else that reaches Blizzard is *work a request asked for* -
 * a page being opened, a card being drawn, a reader pressing Refresh, an administrator asking for one character -
 * and this file deliberately says nothing about those: they are not jobs, they have no interval, and a switch
 * that pretended to own them would be a switch over somebody else's request.
 *
 * What is here is therefore small on purpose: whether that one job runs, how often, and how many characters it
 * takes at a time. The values are validated on the server (`server/utils/siteSettings.ts`) and stored in the
 * site's own settings table, in a namespace of its own, so they survive a restart and cost no schema of their
 * own (see `#shared/data/siteSettings` for the store they join).
 */

import { SYNC_BATCH } from './adminDiagnostics'

/**
 * The intervals an administrator may choose, in milliseconds: 3, 5, 10, 15, 30 and 60 minutes.
 *
 * Three minutes is the floor, and it is the floor because nothing measured justifies going below it: one pass
 * can spend up to `batchSize × 12` requests, so a one-minute cadence would be a way to spend the site's quota on
 * the same stale characters. The list is closed, so a request cannot invent a cadence.
 */
export const SCAN_INTERVAL_OPTIONS_MS = [180_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000] as const

/** The shortest cadence the site will run at, which is also the shipped one. */
export const SCAN_INTERVAL_MIN_MS = SCAN_INTERVAL_OPTIONS_MS[0]

/** The longest cadence the site offers, after which a roster would take a day to fill. */
export const SCAN_INTERVAL_MAX_MS = SCAN_INTERVAL_OPTIONS_MS[SCAN_INTERVAL_OPTIONS_MS.length - 1]

/**
 * How many characters one pass may read.
 *
 * The ceiling is the batch the site already runs with (`SYNC_BATCH`, ten): a larger one would be a *new* fact
 * about the site's quota rather than a setting, and nothing measured supports it. A pass of ten is already up to
 * a hundred and twenty Blizzard requests (one full read is twelve documents), which is why the number is bounded
 * here rather than trusted to the panel.
 */
export const SCAN_BATCH_MIN = 1
export const SCAN_BATCH_MAX = SYNC_BATCH

/** The one job this site schedules, as an administrator sees it. */
export interface CharacterScanSettings {
  /** Whether future passes run at all. A pass already under way is never cancelled. */
  enabled: boolean
  /** One of `SCAN_INTERVAL_OPTIONS_MS`. */
  intervalMs: number
  /** `SCAN_BATCH_MIN`…`SCAN_BATCH_MAX` characters per pass. */
  batchSize: number
}

/** Everything an administrator may automate - which is one job, and the reason it is one. */
export interface AutomationSettings {
  characterScan: CharacterScanSettings
}

/**
 * The values a copy of the site runs with when nothing has ever been stored.
 *
 * The same behaviour the site had before the setting existed: the scan on, every three minutes, ten characters
 * at a time. An installation whose settings row predates this model therefore keeps working untouched - the
 * defaults are the *floor* of the store, exactly as the metric maxima's are (`#shared/data/siteSettings`).
 */
export const AUTOMATION_DEFAULTS: AutomationSettings = {
  characterScan: {
    enabled: true,
    intervalMs: SCAN_INTERVAL_MIN_MS,
    batchSize: SCAN_BATCH_MAX
  }
}

/**
 * What a save sends: the whole of a job's settings, not a fragment.
 *
 * A partial patch would leave "the field the panel did not draw" ambiguous - the same reason the maxima patch
 * spells a cleared field `null`. The panel draws every field, so it sends every field.
 */
export interface AutomationSettingsPatch {
  characterScan: CharacterScanSettings
}

/** The machine-readable reasons a save can be refused. The endpoint turns one into a 400 and a sentence. */
export type AutomationSettingsError =
  | 'body'
  | 'characterScan'
  | 'enabled'
  | 'intervalMs'
  | 'batchSize'
  | 'unknown-field'

export interface AutomationValidationFailure {
  ok: false
  errors: AutomationSettingsError[]
}

/**
 * Validates a body, strictly: the fields the panel draws are the only fields accepted, and each has to be one of
 * the values the site can actually run with.
 *
 * Strict rather than forgiving on purpose. A cadence is not a preference like a page's copy - a wrong one spends
 * the site's Blizzard quota for ever, quietly - so an interval the site does not offer is a refusal, not a
 * rounding. The same for a batch: a number the pass was never built for is refused rather than clamped, because a
 * silently clamped value would leave the panel showing one thing and the scanner doing another.
 */
export function validateAutomationPatch(
  input: unknown
): { ok: true; value: AutomationSettingsPatch } | AutomationValidationFailure {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['body'] }

  const body = input as Record<string, unknown>
  const unknownTop = Object.keys(body).filter((key) => key !== 'characterScan')
  if (unknownTop.length) return { ok: false, errors: ['unknown-field'] }

  const scan = body.characterScan
  if (!scan || typeof scan !== 'object' || Array.isArray(scan)) return { ok: false, errors: ['characterScan'] }

  const fields = scan as Record<string, unknown>
  const unknownInner = Object.keys(fields).filter(
    (key) => key !== 'enabled' && key !== 'intervalMs' && key !== 'batchSize'
  )
  if (unknownInner.length) return { ok: false, errors: ['unknown-field'] }

  const errors: AutomationSettingsError[] = []

  if (typeof fields.enabled !== 'boolean') errors.push('enabled')

  const intervalMs = Number(fields.intervalMs)
  if (!(SCAN_INTERVAL_OPTIONS_MS as readonly number[]).includes(intervalMs)) errors.push('intervalMs')

  const batchSize = Number(fields.batchSize)
  if (!Number.isInteger(batchSize) || batchSize < SCAN_BATCH_MIN || batchSize > SCAN_BATCH_MAX) errors.push('batchSize')

  if (errors.length) return { ok: false, errors }

  return {
    ok: true,
    value: { characterScan: { enabled: fields.enabled as boolean, intervalMs, batchSize } }
  }
}

/**
 * The stored settings laid over the defaults, field by field.
 *
 * A row that predates this model (or one a hand edit broke) must never leave the site without a scanner: a value
 * that is not one the site can run with is replaced by the default *for that field*, which is the same rule the
 * metric maxima follow - the defaults are the floor, not a copy the store has to have.
 */
export function normaliseAutomationSettings(stored: unknown): AutomationSettings {
  const source = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const scan = (source.characterScan && typeof source.characterScan === 'object' ? source.characterScan : {}) as Record<
    string,
    unknown
  >

  const intervalMs = Number(scan.intervalMs)
  const batchSize = Number(scan.batchSize)

  return {
    characterScan: {
      enabled: typeof scan.enabled === 'boolean' ? scan.enabled : AUTOMATION_DEFAULTS.characterScan.enabled,
      intervalMs: (SCAN_INTERVAL_OPTIONS_MS as readonly number[]).includes(intervalMs)
        ? intervalMs
        : AUTOMATION_DEFAULTS.characterScan.intervalMs,
      batchSize:
        Number.isInteger(batchSize) && batchSize >= SCAN_BATCH_MIN && batchSize <= SCAN_BATCH_MAX
          ? batchSize
          : AUTOMATION_DEFAULTS.characterScan.batchSize
    }
  }
}
