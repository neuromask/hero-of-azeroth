/**
 * Where the app keeps its own files: the directory it runs from, and the data beside it.
 *
 * The data a running site writes - `server/data/hoa.db` and the two JSON files next to it - used to be
 * resolved against `process.cwd()`, which says where the *process* was started rather than where the app
 * lives. On a shared host those are not the same thing: a panel, a process manager or a shell can start
 * `node /somewhere/app/server/index.mjs` from any directory at all, and the answer is then a *different*
 * data directory - a fresh, empty one. The site comes up looking as though everything it had written had
 * been lost, while the files themselves sit untouched in the directory the previous process used, which
 * is a data-loss-shaped accident that costs nothing to prevent.
 *
 * So the answer is taken from the running script instead. The entry of a built app is
 * `<app>/server/index.mjs` (that is what `npm run build` writes and what the README and the host's pm2
 * configuration start), which puts the app one level above the script's own directory. `npm run dev` is
 * the case it has to survive: there `process.argv[1]` is the Nuxt CLI inside `node_modules`, which says
 * nothing about the project, so the working directory is used - and in a checkout that *is* the project.
 * `NUXT_DATA_DIR` overrides both, for a host that keeps its data somewhere else on purpose (a mounted
 * volume, a backup area).
 */
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** True when `entry` is the built server both the README and the host start: `<somewhere>/server/index.mjs`. */
function isServerEntry(entry: string): boolean {
  const directory = dirname(entry)
  return basename(directory) === 'server' && existsSync(join(directory, 'index.mjs'))
}

/** The directory the app lives in: the one above its own `server/`, or the working directory in a checkout. */
export function appDirectory(): string {
  const entry = process.argv[1]

  if (entry) {
    const resolved = resolve(entry)
    if (isServerEntry(resolved)) return dirname(dirname(resolved))
  }

  return process.cwd()
}

/**
 * The one directory the site reads and writes its own data in.
 *
 * Everything that survives a restart goes here - the SQLite database, the character index the sitemap is
 * built from, and the hall of fame's table - so this is the single answer to "where is my data", and the
 * answer does not change when the way the app is started changes.
 */
export function dataDirectory(): string {
  const override = process.env.NUXT_DATA_DIR

  if (override) return resolve(override)

  return join(appDirectory(), 'server', 'data')
}
