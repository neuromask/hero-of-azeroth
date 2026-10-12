/**
 * The `.env` file beside the server, read once while the process starts.
 *
 * Why a file rather than the environment, and what makes a plugin early enough for it, is written down in
 * `server/utils/runtimeEnv`. The short version: the app is uploaded as a directory and started with
 * `node server/index.mjs`, so the file beside it is the configuration - and Nitro applies the environment as
 * it answers a request, which is long after this has run.
 */
import { loadRuntimeEnv } from '../utils/runtimeEnv'

export default defineNitroPlugin(() => {
  loadRuntimeEnv()
})
