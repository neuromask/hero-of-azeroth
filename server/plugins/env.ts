/**
 * The `.env` file beside the server, read once while the process starts.
 *
 * Why a file rather than the environment, and what makes a plugin early enough for it, is written down in
 * `server/utils/runtimeEnv`. The short version: the app is uploaded as a directory and started with
 * `node server/index.mjs`, so the file beside it is the configuration - and Nitro applies the environment as
 * it answers a request, which is long after this has run.
 *
 * The directory this process will keep its data in is printed in the same breath
 * (`server/utils/appPaths`): those two lines are what a host that cannot find its credentials - or its own
 * data - needs to see, and neither of them says anything secret.
 */
import { dataDirectory } from '../utils/appPaths'
import { loadRuntimeEnv, missingSettings, runtimeEnvCandidates } from '../utils/runtimeEnv'

export default defineNitroPlugin(() => {
  const { file, taken } = loadRuntimeEnv()

  // One line, because this is the answer to the question a host that cannot reach Blizzard is really asking:
  // which file was read, and how many of its values were still missing. No value is ever printed.
  if (file) console.log(`[env] ${taken} value(s) read from ${file}`)
  else console.log(`[env] no .env found (looked in ${runtimeEnvCandidates().join(', ')})`)

  // And the names of what the site needs and still does not have, if any: that sentence is the difference
  // between "the file is not where it was put" and "the file is there and one key is wrong".
  const missing = missingSettings()

  if (missing.length) console.log(`[env] still missing: ${missing.join(', ')}`)

  // Where everything that survives this process is read and written: the SQLite database, the character
  // index the sitemap is built from, and the hall of fame's table. It no longer follows the working
  // directory, and saying it at startup is what makes a data directory that is not the expected one visible
  // before it costs anything.
  console.log(`[data] ${dataDirectory()}`)
})
