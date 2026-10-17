/**
 * The automation panel's read: what the scanner is set to, what it is doing, and what a manual pass would cost.
 *
 * Read-only, and separately guarded (`requireAdmin`) - the panel's own diagnosis endpoint is a different question
 * (`/api/admin/diagnostics`), and this one is about the *configuration* of the one job the site schedules. Keeping
 * them apart is what lets the settings form have a confirmed state of its own: a poll of the diagnostics cannot
 * overwrite a field somebody is typing in.
 *
 * It costs nothing to read: the settings are one row of the `settings` table, the scheduler state is the
 * process's own, and the estimate is one `COUNT` on the same predicate the scanner uses. No Blizzard call, no
 * cache, no second database connection.
 */
import { SCAN_BATCH_MAX, SCAN_BATCH_MIN, SCAN_INTERVAL_OPTIONS_MS } from '#shared/data/automationSettings'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const settings = getAutomationSettings()
  const scheduler = characterScanState()
  const due = countDueCharacters()

  return {
    settings,
    scheduler,
    /** What the form may offer, so the panel cannot invent a cadence or a batch the server would refuse. */
    limits: {
      intervalsMs: SCAN_INTERVAL_OPTIONS_MS,
      batchMin: SCAN_BATCH_MIN,
      batchMax: SCAN_BATCH_MAX,
      requestsPerCharacter: CHARACTER_READ_REQUESTS
    },
    /**
     * What a pass started now would take and spend. `due` is the scanner's own predicate, `potentialRequests` is
     * the batch times the documents one character's read costs - an estimate an operator can weigh before
     * pressing, not a promise about what Blizzard will answer.
     */
    estimate: {
      due,
      batchSize: settings.characterScan.batchSize,
      potentialRequests: Math.min(due, settings.characterScan.batchSize) * CHARACTER_READ_REQUESTS
    }
  }
})
