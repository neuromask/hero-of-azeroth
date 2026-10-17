/**
 * Starts the site's one periodic job, from whatever the settings say.
 *
 * The timer itself lives in `server/utils/characterScanScheduler.ts`, because it is now something an administrator
 * can stop, slow down or re-batch while the site is running - and a plugin body runs once and has no way back into
 * a timer it created. This file is the wiring: read the stored settings, put them into force, and let the
 * scheduler own the single timer from there (`applyCharacterScan` is what every save calls too).
 *
 * Deliberately a plugin rather than a Nitro task: the built `node-server` is what actually runs on the host, and a
 * plugin needs no scheduler, no external cron and no task runtime. The scheduler's timer is `unref`'d, so it is
 * never the reason the process stays up by itself.
 *
 * A failure here is a site that serves pages but does not scan: the start is therefore logged rather than thrown,
 * and the panel shows the scanner as stopped - which is the honest state, not a silent one.
 */
import { runWithBlizzardSource } from '../utils/blizzardSource'

export default defineNitroPlugin(() => {
  try {
    // Arming the timer makes no request. Anything that ever did here would be startup work, and is tagged as such;
    // the timer's own passes set `background_scan` for themselves (`runSyncPass`), which replaces this tag.
    runWithBlizzardSource('startup', () => startCharacterScan())
  } catch (error) {
    console.error(`[sync] the character scanner did not start: ${error instanceof Error ? error.message : String(error)}`)
    recordDiagnostic({ level: 'error', category: 'sync', message: 'character scanner did not start' })
  }
})
