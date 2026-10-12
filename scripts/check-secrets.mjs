/**
 * `npm run check:secrets` - proves the build artefact carries none of the runtime secrets.
 *
 * Reads the three values the site keeps out of its build out of the environment (`.env` as the fallback,
 * the way Nuxt resolves them) and looks for each of them in every file under `.output`. Exits non-zero on
 * a hit, so it can be the gate a deploy - or a CI job - runs before anything leaves the machine.
 *
 * Values are never printed: a hit is reported by file and by the name of the key.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSecrets, readDotenv, secretValues } from './lib/secrets.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '.output')

if (!fs.existsSync(dir)) {
  console.error(`!! there is no ${dir} to check; build the site first.`)
  process.exit(1)
}

const values = secretValues({ dotenv: readDotenv(path.join(ROOT, '.env')) })

if (!values.size) {
  console.log('   nothing to look for: none of the runtime secrets is set here or in .env.')
  console.log('   the build keeps them out of the artefact (see nuxt.config.ts); this check only finds them')
  console.log('   once they are set, which is the case on the machine that deploys.')
  process.exit(0)
}

const findings = findSecrets(dir, values)

console.log(`   looked for ${values.size} secret(s): ${[...values.keys()].join(', ')}`)
console.log(`   searched ${findings.searched} file(s) under ${dir}`)

if (!findings.length) {
  console.log('   ok: no runtime secret is anywhere in the artefact.')
  process.exit(0)
}

console.error('!! the artefact carries a runtime secret:')
for (const finding of findings) console.error(`   - ${finding.key} in ${finding.file}`)
console.error('   the deploy uploads that file. Rebuild without the secret in the environment or in .env;')
console.error('   nuxt.config.ts gives these fields empty defaults on purpose (see the note there).')
process.exit(1)
