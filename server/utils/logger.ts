/**
 * The one place a line is written to the console on purpose.
 *
 * A sign-in and a roster refresh used to `console.log` the whole answer - battletags, character names,
 * collection counts - on every pass, which is noise in a healthy log and an answer to nothing while it runs.
 * `debugLog` writes only when the process was started asking for it (`NUXT_DEBUG=1`), so the honest failures -
 * the `console.error` and `console.warn` calls - stay, and the chatter goes quiet.
 */
export const DEBUG = process.env.NUXT_DEBUG === '1' || process.env.DEBUG === '1'

/** A diagnostic line, written only when the process was started with `NUXT_DEBUG=1`. */
export function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args)
}
