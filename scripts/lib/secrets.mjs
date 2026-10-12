/**
 * The secrets a build must not carry, and the search that proves it does not.
 *
 * A Nuxt `runtimeConfig` value is written into the build as its *default*, so a credential that happens to
 * be in the builder's environment - or in `.env`, which Nuxt loads while building - ends up inside
 * `.output`. `.output` is exactly what the deploy uploads, so a secret that reaches it has left the machine
 * of whoever built it. `nuxt.config.ts` therefore gives these three fields empty defaults and lets Nitro
 * read them from the host's environment at runtime; this module is the second half of that: the check that
 * stops an artefact which still carries one of them from being uploaded.
 *
 * The search is over the bytes of every file under the artefact, so a secret is caught wherever it lands -
 * a bundle, a source map, a JSON file, anything - and it does not care what the bundler called it or how it
 * formatted it. Nothing here ever prints a value: a hit is reported by file and by the *name* of the key,
 * which is what a reader needs and what a build log can safely keep.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The runtime config the site keeps out of its own build: the two Battle.net credentials, and the session key. */
export const SECRET_KEYS = ['NUXT_BLIZZARD_CLIENT_ID', 'NUXT_BLIZZARD_CLIENT_SECRET', 'NUXT_SESSION_PASSWORD']

/**
 * A value shorter than this is not searched for.
 *
 * A short value - a placeholder, a one-letter key - matches half the artefact and reports nothing useful;
 * the three real ones are dozens of characters long.
 */
const MIN_LENGTH = 8

/** `KEY=VALUE` pairs from a `.env` file (`#` comments and quotes handled), which need not exist. */
export function readDotenv(file) {
  const values = new Map()
  if (!file || !fs.existsSync(file)) return values

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^\s*#/.test(line)) continue
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
  }

  return values
}

/**
 * The values a build could have taken, under the names they are known by.
 *
 * The environment wins over `.env`, the way Nuxt resolves them. A value that is missing, or too short to be
 * meaningful, is left out rather than searched for.
 */
export function secretValues({ env = process.env, dotenv = new Map() } = {}) {
  const values = new Map()

  for (const key of SECRET_KEYS) {
    const value = String(env[key] ?? dotenv.get(key) ?? '').trim()
    if (value.length >= MIN_LENGTH) values.set(key, value)
  }

  return values
}

/** Every file under `dir`, as paths relative to it. */
function walk(dir, prefix = '') {
  const found = []

  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) found.push(...walk(dir, relative))
    else if (entry.isFile()) found.push(relative)
  }

  return found
}

/**
 * Where each of `values` appears in the files under `dir`: `{ file, key }`, never the value itself.
 *
 * `files` is the limit of what is *searched*, not of what is *read*: a `.output` is tens of megabytes of
 * bundles, images and native modules, and the byte search is happy to run over all of them.
 */
export function findSecrets(dir, values, { files } = {}) {
  const findings = []
  if (!values.size || !fs.existsSync(dir)) return findings

  const needles = [...values.entries()].map(([key, value]) => ({ key, bytes: Buffer.from(value, 'utf8') }))
  let searched = 0

  for (const file of files || walk(dir)) {
    let content
    try {
      content = fs.readFileSync(path.join(dir, file))
    } catch {
      // A file that cannot be read cannot be reported on either.
      continue
    }

    searched += 1
    for (const needle of needles) {
      if (content.includes(needle.bytes)) findings.push({ file, key: needle.key })
    }
  }

  findings.searched = searched
  return findings
}
