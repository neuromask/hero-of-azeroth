/**
 * Re-reads *one* character, at an administrator's own request.
 *
 * It is deliberately the smallest useful action: the panel is for looking, and this is the one write it offers
 * besides the settings form. It reads the character through the very path everything else uses
 * (`refreshCharacterStatsWithOutcome`, `server/utils/accountSync`), so the existing rules apply unchanged rather
 * than being re-implemented here:
 *
 *   - the reading is shared with any read already under way for the same character (`pendingRefreshes`), so
 *     pressing the button twice cannot put two reads of one character in flight;
 *   - the per-character cache and cooldown in the Blizzard wrapper (`server/utils/blizzard`) decide whether a
 *     fresh call is made at all, which is what keeps this button from being a way round the site's own budget;
 *   - the reading files history by the site's own rules (`fileDailyReading`) - one point per day, rewritten
 *     when the figures move - and touches nothing else.
 *
 * What this endpoint *adds* is the operator's side of it: a session that is an administrator and nothing less,
 * a same-origin check for the POST (`requireAdminAction`), one manual operation at a time, a short cooldown
 * between presses, and an answer that says plainly whether the figures moved. It never starts a pass over an
 * account or over every character - the roster-wide work belongs to the background pass and to the profile
 * page's own ask - and the character it refreshes must already be one the site holds, because inventing a row
 * from a request would be a second write path.
 */
// The shape one read answers with, named explicitly so the endpoint does not depend on a global for a type.
import type { CharacterRefresh } from '~~/server/utils/accountSync'
// An administrator's own press, counted apart from the timer and from a reader's page view.
import { runWithBlizzardSource } from '~~/server/utils/blizzardSource'
import type { H3Event } from 'h3'

/** The name this endpoint takes in the single manual-operation slot both maintenance actions share. */
const MANUAL_OPERATION = 'character-refresh'

export default defineEventHandler(async (event) => {
  await requireAdminAction(event)

  const body = await readBody<{ characterId?: unknown; region?: unknown; realm?: unknown; name?: unknown }>(event)

  // The one operation slot, taken before the cooldown so two presses a moment apart are told "running" rather
  // than "too soon" - which is the more useful of the two answers.
  if (!claimManualOperation(MANUAL_OPERATION)) {
    throw createError({ statusCode: 409, statusMessage: 'Another maintenance operation is already running' })
  }

  try {
    // A press inside the cooldown is refused with the seconds that remain, the way the refresh budget refuses
    // one (`server/utils/refreshBudget`).
    const waitFor = manualRefreshCoolingDown()
    if (waitFor > 0) {
      setResponseHeader(event, 'retry-after', waitFor)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many refreshes just now',
        data: { retryAfter: waitFor }
      })
    }

    const row = resolveTargetCharacter(body)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'The site holds no such character' })

    chargeManualRefresh()

    let read: CharacterRefresh
    try {
      read = await runWithBlizzardSource('admin_manual_refresh', () => refreshCharacterStatsWithOutcome(row))
    } catch (error) {
      recordManualRefresh('failed')
      recordDiagnostic({
        level: 'error',
        category: 'admin',
        message: 'manual character refresh failed',
        status: Number((error as { statusCode?: number })?.statusCode || 0) || undefined
      })
      // The Blizzard wrapper has already turned the failure into the site's own status; it is passed on as it
      // is, and nothing of the upstream travels with it.
      throw error
    }

    recordManualRefresh(read.updated ? 'updated' : 'unchanged')
    recordDiagnostic({
      level: 'info',
      category: 'admin',
      message: read.updated ? 'manual character refresh updated a reading' : 'manual character refresh found no change'
    })

    // The panel is about to be asked what the process is doing, and this is a thing it just did.
    invalidateDiagnosticsCache()

    return { status: read.updated ? 'updated' : 'unchanged', characterId: row.id }
  } finally {
    releaseManualOperation(MANUAL_OPERATION)
  }
})
