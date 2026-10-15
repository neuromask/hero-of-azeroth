// A one-off: lists what is really in the host's directory over the same FTP settings the deploy uses, and holds it
// against the local build - what the build has and the host does not, and what the host has and the build does not.
// Read-only: it lists and fetches nothing. Deleted when the check is over.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const values = {}

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
  if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
}

const setting = (name) => (process.env[name] || values[name] || '').trim()
const server = setting('FTP_SERVER')
const base = setting('FTP_PATH')
const port = setting('FTP_PORT') || '21'
const secure = (setting('FTP_SECURE') || 'false').toLowerCase()
const insecure = ['true', '1', 'yes'].includes((setting('FTP_INSECURE') || '').toLowerCase())
const root = `/${base.replace(/\\/g, '/').split('/').filter(Boolean).join('/')}/`

const netrc = path.join(os.tmpdir(), 'hoa-tree.netrc')
fs.writeFileSync(netrc, `machine ${server}\nlogin ${setting('FTP_USERNAME')}\npassword ${setting('FTP_PASSWORD')}\n`, {
  mode: 0o600
})

const args = ['--silent', '--show-error', '--netrc-file', netrc, '--connect-timeout', '30', '--max-time', '300']
if (secure === 'explicit') args.push('--ssl-reqd')
if (secure !== 'false') args.push('--tls-max', setting('FTP_TLS_MAX') || '1.2')
if (insecure) args.push('--insecure')

const url = (dir) => `${secure === 'implicit' ? 'ftps' : 'ftp'}://${server}:${port}${root}${dir}`

function names(dir) {
  const result = execFileSync('curl', [...args, '--list-only', url(dir)], { encoding: 'utf8' })
  return result
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && name !== '.' && name !== '..')
}

/** Every file below a local directory, as paths relative to it, with `/` separators. */
function localTree(directory) {
  const files = []

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(current, entry.name), relative)
      else files.push(relative)
    }
  }

  walk(directory, '')
  return files
}

console.log(`root of ${base}:`)
for (const name of names('')) console.log(`  ${name}`)

console.log('\nserver/:')
const serverNames = names('server/')
for (const name of serverNames) console.log(`  ${name}`)

console.log(`\nserver/data/: ${names('server/data/').join(', ')}`)

// The three directories the build fills, each held against the same directory of the local `.output`.
for (const [remote, local] of [
  ['server/chunks/', '.output/server/chunks'],
  ['server/node_modules/', '.output/server/node_modules'],
  ['public/', '.output/public']
]) {
  const here = new Set(names(remote).map((name) => name.replace(/\/$/, '')))
  const there = new Set(
    fs.existsSync(path.join(ROOT, local)) ? fs.readdirSync(path.join(ROOT, local)) : []
  )

  const stale = [...here].filter((name) => !there.has(name))
  const missing = [...there].filter((name) => !here.has(name))

  console.log(`\n${remote} remote=${here.size} build=${there.size}`)
  console.log(`  on the host and not in this build (${stale.length}): ${stale.slice(0, 40).join(', ') || 'none'}`)
  console.log(`  in this build and not on the host (${missing.length}): ${missing.slice(0, 40).join(', ') || 'none'}`)
}

// And the files of the build's own `server/`, which the root listing above already named.
const builtTop = localTree(path.join(ROOT, '.output/server')).filter((file) => !file.includes('/'))
console.log(`\n.output/server top-level files: ${builtTop.join(', ')}`)
console.log(`.output/server files in total: ${localTree(path.join(ROOT, '.output/server')).length}`)
console.log(`.output/public files in total: ${localTree(path.join(ROOT, '.output/public')).length}`)

// And a deep pass over the two trees that hold content-hashed bundles, which is where a previous build's files are
// left behind: every directory of the local tree is listed on the host and held against the same directory here.
// `server/node_modules/` is deliberately not walked - the deploy's own prune does not walk it either.
function localTreeMap(directory) {
  const map = new Map()

  const walk = (current, key) => {
    const names = fs.readdirSync(current, { withFileTypes: true })
    map.set(key, new Set(names.filter((entry) => entry.isFile()).map((entry) => entry.name)))

    for (const entry of names) {
      if (entry.isDirectory()) walk(path.join(current, entry.name), `${key}${entry.name}/`)
    }
  }

  walk(directory, '')
  return map
}

for (const [remote, local] of [
  ['server/chunks/', '.output/server/chunks'],
  ['public/', '.output/public']
]) {
  const here = localTreeMap(path.join(ROOT, local))
  const stale = []
  const absent = []

  for (const [key, files] of here) {
    const there = names(`${remote}${key}`)
    const remoteSet = new Set(there)

    for (const name of there) {
      if (!files.has(name)) stale.push(`${key}${name}`)
    }

    for (const name of files) {
      if (!remoteSet.has(name)) absent.push(`${key}${name}`)
    }
  }

  console.log(`\n${remote} deep: ${here.size} director(ies), ${[...here.values()].reduce((n, set) => n + set.size, 0)} file(s) in the build`)
  console.log(`  on the host and not in this build (${stale.length}): ${stale.slice(0, 30).join(', ') || 'none'}`)
  console.log(`  in this build and not on the host (${absent.length}): ${absent.slice(0, 30).join(', ') || 'none'}`)

  // A stale name that lists as a directory is a whole subtree the build does not have, which is reported apart
  // from the files: the deploy's prune deletes files and never directories.
  const directories = []
  for (const name of stale) {
    const cut = name.lastIndexOf('/')
    const dir = cut === -1 ? remote : `${remote}${name.slice(0, cut + 1)}`
    const file = name.slice(cut + 1)

    try {
      names(`${dir}${file}/`)
      directories.push(name)
    } catch {
      // A file, which is what a stale bundle is.
    }
  }

  console.log(`  of those, whole directories (${directories.length}): ${directories.slice(0, 20).join(', ') || 'none'}`)
}

fs.rmSync(netrc, { force: true })
