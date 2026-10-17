/**
 * Runs one batch of the scanner, now, because an administrator asked for it.
 *
 * It is the *scanner's* batch and nothing else: the same due-character predicate, the same `batchSize` the saved
 * settings carry, the same retry state and the same claim (`beginSyncPass`) that the timer and the profile page
 * take. So a press can never read more than one batch, can never read a character the retry state is holding
 * back, and can never run beside another pass - a press while one is in flight is answered `409` rather than
 * queued behind it, because there is no queue and never was.
 *
 * It works while the scanner is paused as well: "run one pass now" is a deliberate act of an operator looking at
 * the panel, and it is the natural way to check that a fix works without waiting for the timer. What it is not is
 * a way to run the site's whole roster: the batch is bounded, and the panel says how many characters are due and
 * how many requests the batch may cost before anybody presses.
 */
const RUN_COOLDOWN_MS = 3_000

let lastRunAt = 0

export default defineEventHandler(async (event) => {
  await requireAdminAction(event)

  const now = Date.now()
  const waited = now - lastRunAt
  if (waited < RUN_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RUN_COOLDOWN_MS - waited) / 1000)
    setResponseHeader(event, 'retry-after', retryAfter)
    throw createError({
      statusCode: 429,
      statusMessage: 'A pass was started a moment ago',
      data: { retryAfter }
    })
  }

  const settings = getAutomationSettings()
  const batchSize = settings.characterScan.batchSize

  lastRunAt = now

  // The claim is taken *inside* the pass, so this is the one place that can tell "started" from "already running"
  // - and the answer is the honest one: `null` means a pass had the claim, not that nothing happened.
  const counters = await runSyncPass('manual', batchSize)

  if (!counters) {
    throw createError({ statusCode: 409, statusMessage: 'Another pass is already running' })
  }

  recordDiagnostic({
    level: 'info',
    category: 'admin',
    message: `manual scan pass ran (${counters.checked} checked, ${counters.errors} failed)`
  })

  invalidateDiagnosticsCache()

  return {
    batchSize,
    counters,
    /** What is left to do after this batch, so the panel can say whether another press would do anything. */
    due: countDueCharacters()
  }
})
