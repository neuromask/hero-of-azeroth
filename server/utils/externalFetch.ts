/**
 * The site's requests to Blizzard's *web* hosts - not the API - with a deadline and a counter of their own.
 *
 * Two things are read from there: the Armoury page a character's mount journal is scraped from
 * (`worldofwarcraft.blizzard.com`, `./armory`), and the artwork a card is drawn with (`render.worldofwarcraft.com`,
 * `./armory` and `./card`). Neither is the game-data API, so neither belongs in `callBlizzard`'s counters - a panel
 * that added them would overstate the API traffic - but both used to be bare `$fetch` calls: no counter at all, and
 * the artwork had no deadline either, so a CDN that never answered held a card render open indefinitely.
 *
 * A failure is rethrown exactly as it arrived: the callers already catch it and fall back (no journal, no artwork).
 */
import type { ExternalTarget } from '#shared/data/adminDiagnostics'
import { recordExternalCall } from './adminDiagnostics'

/** The same bound the API calls are given (`callBlizzard`). A caller may ask for a shorter one. */
export const EXTERNAL_TIMEOUT_MS = 15_000

export function callExternal<T>(target: ExternalTarget, url: string, options: Record<string, unknown> = {}): Promise<T> {
  const startedAtMs = Date.now()

  return ($fetch(url, { timeout: EXTERNAL_TIMEOUT_MS, ...options }) as Promise<T>).then(
    (answer) => {
      recordExternalCall({ target, ok: true, durationMs: Date.now() - startedAtMs })
      return answer
    },
    (error: unknown) => {
      const failure = error as { name?: string; cause?: { name?: string } }
      const name = failure?.name || failure?.cause?.name
      recordExternalCall({
        target,
        ok: false,
        timeout: name === 'TimeoutError' || name === 'AbortError',
        durationMs: Date.now() - startedAtMs
      })
      throw error
    }
  )
}
