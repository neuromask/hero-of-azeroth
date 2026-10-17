/**
 * The site's one periodic job, and the only thing an administrator can turn on, off or slow down.
 *
 * Before this module the timer was a `setInterval` created inside the Nitro plugin: fixed at three minutes for
 * the life of the process, impossible to stop without a restart, and re-armed only by a deploy. What is here is
 * the same one job with its cadence and its batch read from the site's own settings (`./siteSettings`) and an
 * explicit `apply` that can be called while the site is running.
 *
 * The rules it keeps, in the order they matter:
 *
 *   - **one timer, ever.** Every apply clears the pending timeout before arming another, so a settings change
 *     can never leave two chains running; `characterScanState().armed` is the panel's answer to "is it on".
 *   - **never a second pass.** A tick calls `runSyncPass`, which takes the claim every caller shares
 *     (`beginSyncPass`). A tick that lands while a pass is still reading is *refused* and counted as a skipped
 *     tick, not started - so the timer, a page and an administrator cannot read the same roster twice at once.
 *   - **a pass is never cancelled.** Disabling the scan stops the next tick; the pass already running finishes,
 *     files what it read and clears its own claim. Half a pass would be a character with a reading and no row.
 *   - **a fixed cadence, not interval-plus-work.** The next tick is armed as the current one starts, so the
 *     panel's "next run" is the schedule rather than the schedule plus a pass.
 *
 * Nothing here is persisted: the *settings* are (`./siteSettings`), and the runtime state - armed, next run,
 * last tick - belongs to the process, like every other counter in the panel.
 */
import { AUTOMATION_DEFAULTS, type CharacterScanSettings } from '#shared/data/automationSettings'
import { recordDiagnostic, recordTimerTick } from './adminDiagnostics'
import { getAutomationSettings } from './siteSettings'
import { nowSec } from './db'

/**
 * How many Blizzard requests one character's full read costs, which is what makes the batch a quota decision.
 *
 * Twelve documents are fetched for a character (`fetchCharacterProfile` in `./blizzard`): the summary, the media,
 * four collections, reputations, Mythic+, titles, quests, professions and PvP. The token and the five index
 * documents are cached for the process, so they are not counted per character. The figure is used for the
 * panel's *estimate* before a manual pass, and for nothing that spends anything.
 */
export const CHARACTER_READ_REQUESTS = 12

/** What the panel shows about the scanner, none of which outlives the process. */
export interface CharacterScanState {
  /** Whether the scanner is meant to run (the stored setting that is in force). */
  enabled: boolean
  /** Whether a timer is actually pending - which is false when the scan is disabled. */
  armed: boolean
  intervalMs: number
  batchSize: number
  /** When the next tick is due, in seconds since the epoch, or `null` while nothing is armed. */
  nextRunAt: number | null
  /** When the last tick fired, in seconds since the epoch. */
  lastTickAt: number | null
  /** When these settings were applied, in seconds since the epoch (0 until the first apply). */
  appliedAt: number
}

/** The pending tick, or `null`: this module owns at most one. */
let timer: ReturnType<typeof setTimeout> | null = null

let enabled = AUTOMATION_DEFAULTS.characterScan.enabled
let intervalMs = AUTOMATION_DEFAULTS.characterScan.intervalMs
let batchSize = AUTOMATION_DEFAULTS.characterScan.batchSize
let nextRunAt: number | null = null
let lastTickAt: number | null = null
let appliedAt = 0

/** Forgets the pending tick, if there is one. The only way a timer is ever removed. */
function clearTimer(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }

  nextRunAt = null
}

/** Arms the one timer, at the interval in force. */
function armTimer(): void {
  clearTimer()

  timer = setTimeout(onTick, intervalMs)
  // The timer must never be the reason the process stays up by itself.
  timer.unref?.()

  nextRunAt = nowSec() + Math.round(intervalMs / 1000)
}

/**
 * One tick: the scanner's own pass, at the batch in force, and the next tick armed behind it.
 *
 * The pass is not awaited - a timer that waited for a network pass would be a timer whose cadence is the network's
 * - and its claim is what keeps a long pass from being joined by the next tick. The `catch` is not decoration: an
 * unhandled rejection is a dead process since Node 15, and this is the one promise in the site nobody awaits.
 */
function onTick(): void {
  timer = null
  lastTickAt = nowSec()

  const limit = batchSize

  void runSyncPass('timer', limit)
    .then((counters) => recordTimerTick(counters === null))
    .catch(() => {
      recordDiagnostic({ level: 'error', category: 'sync', message: 'background sync pass could not be started' })
    })

  // A fixed cadence: armed now, so the panel's "next run" is the schedule rather than the schedule plus a pass.
  if (enabled) armTimer()
}

/**
 * Puts a set of settings into force, and answers the state that results.
 *
 * Called at startup and by every save. Clearing before arming is what makes "one timer" true: an interval change
 * is a *replacement*, never an addition, which is exactly the bug a `setInterval` cannot be asked to avoid.
 */
export function applyCharacterScan(settings: CharacterScanSettings): CharacterScanState {
  enabled = settings.enabled
  intervalMs = settings.intervalMs
  batchSize = settings.batchSize
  appliedAt = nowSec()

  // A pass already running is deliberately left alone: disabling the scanner stops the *next* tick, and a pass
  // that was half way through its batch is a pass that should finish filing what it read.
  clearTimer()
  if (enabled) armTimer()

  return characterScanState()
}

/** Reads the stored settings and puts them into force - what the plugin does once, as the process starts. */
export function startCharacterScan(): CharacterScanState {
  return applyCharacterScan(getAutomationSettings().characterScan)
}

/** Stops the scanner without touching the stored setting: the panel's "pause while I look" is a save. */
export function stopCharacterScan(): CharacterScanState {
  clearTimer()

  return characterScanState()
}

/** The scanner as the panel reads it. */
export function characterScanState(): CharacterScanState {
  return {
    enabled,
    armed: timer !== null,
    intervalMs,
    batchSize,
    nextRunAt,
    lastTickAt,
    appliedAt
  }
}

/**
 * Forgets the module's own state, including a pending timer.
 *
 * The settings are the *store's* and are not touched: this exists for tests, which have to leave no timer behind,
 * and for the same reason `clearAdminDiagnostics` does.
 */
export function resetCharacterScanScheduler(): void {
  clearTimer()

  enabled = AUTOMATION_DEFAULTS.characterScan.enabled
  intervalMs = AUTOMATION_DEFAULTS.characterScan.intervalMs
  batchSize = AUTOMATION_DEFAULTS.characterScan.batchSize
  lastTickAt = null
  appliedAt = 0
}
