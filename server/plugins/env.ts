/**
 * The `.env` file beside the server, read once while the process starts.
 *
 * Why a file rather than the environment, and what makes a plugin early enough for it, is written down in
 * `server/utils/runtimeEnv`. The short version: the app is uploaded as a directory and started with
 * `node server/index.mjs`, so the file beside it is the configuration - and Nitro applies the environment as
 * it answers a request, which is long after this has run.
 */
import { loadRuntimeEnv, runtimeEnvCandidates } from '../utils/runtimeEnv'

export default defineNitroPlugin(() => {
  const { file, taken } = loadRuntimeEnv()

  // One line, because this is the answer to the question a host that cannot reach Blizzard is really asking:
  // which file was read, and how many of its values were still missing. No value is ever printed.
  if (file) console.log(`[env] ${taken} value(s) read from ${file}`)
  else console.log(`[env] no .env found (looked in ${runtimeEnvCandidates().join(', ')})`)
})
