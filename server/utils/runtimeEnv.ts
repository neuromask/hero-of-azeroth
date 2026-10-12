/**
 * The `.env` file beside the running server.
 *
 * The built app is uploaded as a directory and started with `node server/index.mjs`, so the file that
 * configures it should be the one in *that* directory rather than the environment of whatever shell started
 * it - which on a shared host nobody controls. Nitro resolves `NUXT_*` variables out of `process.env` as it
 * answers a request, so a file read into `process.env` when the process starts is all it takes.
 *
 * Two things about the timing are worth knowing, because they are not obvious:
 *
 *   1. `useRuntimeConfig(event)` - what every handler and every page render calls - applies the environment
 *      at that moment, so values loaded here are picked up. `useRuntimeConfig()` *without* an event answers
 *      from a copy Nitro froze while its own modules were being loaded, which is before any plugin can run;
 *      that is why the few callers that read it without an event go through `privateSetting()` below, which
 *      asks the environment first. (`server/plugins/env` does the loading, so a request always sees the file.)
 *   2. The environment wins over the file. A variable set for the process is a deliberate answer from whoever
 *      started it, and the file is the fallback for a host that has no other way to be configured - the rule
 *      Nuxt applies to `.env` while developing.
 *
 * The file is optional: a checkout, a CI run, and a host that does pass real variables all have none, and
 * none of them should be refused because of it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseEnv } from 'node:util'

/**
 * Where the `.env` is looked for, in order.
 *
 * The first candidate is the working directory, because that is where the command in the README runs from
 * (`cd <the app> && node server/index.mjs`). The others are there because a host does not always work that
 * way: a panel or a process manager can start the same command with a working directory of its own, and then
 * `process.cwd()` says nothing about where the configuration is - which is exactly the state a site whose
 * Battle.net credentials are "missing" is usually in. The script Node is running does say: the deploy puts
 * `.env` beside the `server/` directory the entry lives in, so that is where the last two look.
 */
export function runtimeEnvCandidates(): string[] {
  const candidates = [resolve(process.cwd(), '.env')]
  const entry = process.argv[1]

  if (entry) {
    const entryDirectory = dirname(resolve(entry))
    candidates.push(resolve(entryDirectory, '..', '.env'), resolve(entryDirectory, '.env'))
  }

  return [...new Set(candidates)]
}

/**
 * Reads `file` into `process.env`, and reports which file it was and how many values it took.
 *
 * Called from `server/plugins/env` (which logs the answer) and from `server/plugins/port` before it looks at
 * `PORT`. It is idempotent: a value already in the environment is left alone, so the second call takes
 * nothing. Without a `file` the candidates above are tried in order, and the first one that exists is read.
 */
export function loadRuntimeEnv(file?: string): { file: string | null; taken: number } {
  const candidates = file ? [file] : runtimeEnvCandidates()
  const found = candidates.find((candidate) => existsSync(candidate))
  let values: Record<string, string | undefined>

  if (!found) return { file: null, taken: 0 }

  try {
    values = parseEnv(readFileSync(found, 'utf8'))
  } catch {
    // A file that cannot be read is a host without configuration, not a reason to refuse to start.
    return { file: null, taken: 0 }
  }

  let taken = 0

  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && process.env[key] === undefined) {
      process.env[key] = value
      taken += 1
    }
  }

  return { file: found, taken }
}

/**
 * A private runtime config value, with the environment in front of it.
 *
 * For the callers that have no request to hand over: they read the config Nitro froze at load (see the note
 * above), which holds the build's defaults rather than what the host supplied, so the environment - where the
 * `.env` file was read into - is asked first.
 */
export function privateSetting(name: string, fallback?: unknown): string {
  const value = process.env[name]
  return value !== undefined && value !== '' ? value : String(fallback ?? '')
}
