/**
 * The port the built server binds when the host names no port.
 *
 * Nitro's `node-server` entry listens on `NITRO_PORT`, else on `PORT`, else on 3000,
 * and that last fallback is hard-coded: no Nitro setting changes it. Another
 * application on this host owns 3000, so the fallback is set here instead. Nitro runs
 * a plugin while it builds the app object, which happens before the entry reads the
 * port, so a plugin is early enough. Both of Nitro's own variables still win, which
 * keeps a panel or a process manager in charge where it assigns a port.
 *
 * The number itself comes from `runtimeConfig.port` (`nuxt.config.ts`).
 */

/**
 * A usable port, or an empty string when there is none. `nuxt preview` hands an
 * unset port through as the literal string `undefined` - in `NITRO_PORT` and in
 * `NUXT_PORT`, which the runtime config picks up as that very string - and a value
 * that is not a number would only send the entry back to its 3000 fallback.
 */
function portValue(value: unknown): string {
  const text = String(value ?? '').trim()
  return /^\d+$/.test(text) ? text : ''
}

export default defineNitroPlugin(() => {
  for (const key of ['NITRO_PORT', 'PORT'] as const) {
    if (!portValue(process.env[key])) delete process.env[key]
  }

  // A port the host chose stands, even a 3000.
  if (process.env.NITRO_PORT || process.env.PORT) return

  const fallback = portValue(useRuntimeConfig().port)
  if (fallback) process.env.NITRO_PORT = fallback
})