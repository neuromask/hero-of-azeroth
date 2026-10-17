/**
 * Saves the automation settings, and puts them into force in the running process.
 *
 * Two things happen and both matter. The store writes the `automation` namespace of the site's own settings table
 * (`server/utils/siteSettings`), so the choice survives a restart; and the scheduler is re-applied immediately
 * (`applyCharacterScan`), so the *next* tick - not the next deploy - obeys it. There is no path here that changes
 * the cadence without an administrator asking: nothing calls this but the panel.
 *
 * What it deliberately does not do: cancel a pass already running (the scanner is stopped for the *future*), or
 * start one. Saving an interval is not pressing "run".
 *
 * The gate is the panel's own (`requireAdminAction`): a signed-in administrator and a same-origin POST, in that
 * order, before the body is read. The body is validated strictly (`validateAutomationPatch`): only the fields the
 * panel draws, and only values the scanner can actually run with - an interval of two minutes or a batch of five
 * hundred is a 400 with the field named, never a silent clamp.
 */
import {
  validateAutomationPatch,
  type AutomationSettingsError
} from '#shared/data/automationSettings'

/** How often the settings may be written: two saves a second is a script, not an operator. */
const SAVE_COOLDOWN_MS = 1_500

let lastSaveAt = 0

export default defineEventHandler(async (event) => {
  await requireAdminAction(event)

  const now = Date.now()
  const waited = now - lastSaveAt
  if (waited < SAVE_COOLDOWN_MS) {
    const retryAfter = Math.ceil((SAVE_COOLDOWN_MS - waited) / 1000)
    setResponseHeader(event, 'retry-after', retryAfter)
    throw createError({
      statusCode: 429,
      statusMessage: 'The automation settings were saved a moment ago',
      data: { retryAfter }
    })
  }

  const body = await readBody<unknown>(event)
  const validation = validateAutomationPatch(body)

  if (!validation.ok) {
    // The field names travel; nothing of the request does, and there is no stack here to leak.
    throw createError({
      statusCode: 400,
      statusMessage: 'The automation settings are not valid',
      data: { errors: validation.errors satisfies AutomationSettingsError[] }
    })
  }

  lastSaveAt = now

  // Stored first, then applied: a process that crashed between the two would come back with the saved value
  // (the plugin applies it at startup), which is the right way round for a setting an operator chose.
  const settings = saveAutomationSettings(validation.value)
  const scheduler = applyCharacterScan(settings.characterScan)

  recordDiagnostic({
    level: 'info',
    category: 'admin',
    message: settings.characterScan.enabled
      ? `character scan saved (every ${Math.round(settings.characterScan.intervalMs / 60_000)} min, ${settings.characterScan.batchSize} per pass)`
      : 'character scan paused'
  })

  // The panel asks the diagnostics what the process is doing; this is a thing it just changed.
  invalidateDiagnosticsCache()

  return { settings, scheduler }
})
