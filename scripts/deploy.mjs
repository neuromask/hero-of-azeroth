/**
 * Publishes the project: builds it, pushes the sources to GitHub and uploads the
 * built `.output` to the FTP target. Three steps, each skippable.
 *
 *   1. `npm run build` writes `.output`, the Nitro `node-server` preset.
 *   2. The sources are committed and pushed to the current branch (`main`). Only
 *      sources go to GitHub: `.output` is ignored by git, so the build never
 *      reaches the repository.
 *   3. The contents of `.output` are uploaded to `FTP_PATH`, which is the
 *      directory the server runs from (`node server/index.mjs`). Transfers are
 *      binary, missing directories are created, existing files are overwritten.
 *
 * The upload runs through `curl` (shipped with Windows 10+ and present on every
 * Linux server), so the deploy needs no npm package of its own. Credentials come
 * from the environment or from `.env`, and reach curl through a throwaway netrc
 * file, so the password never shows up on a command line or in the process list.
 *
 * Usage: npm run deploy [-- <options>]
 *
 *   --no-build           publish the `.output` that already exists
 *   --no-github          skip step 2, the sources stay local
 *   --no-ftp             skip step 3, push the sources only
 *   --prune              after uploading, delete the remote files below `public/`
 *                        and `server/chunks/` that this build no longer contains
 *   --verify             read the upload back afterwards: every file present, at
 *                        the size it was built with (one request per file)
 *   --dry-run            report what would happen; nothing is built or uploaded
 *   -m, --message <text> commit message (default: `Deploy <date> <time>`)
 *
 * FTP settings (the environment wins, `.env` is the fallback):
 *
 *   FTP_SERVER           host, e.g. `www.nuforms.com`
 *   FTP_USERNAME         FTP user
 *   FTP_PASSWORD         FTP password
 *   FTP_PATH             remote directory that receives the build output
 *   FTP_PORT             optional, 21 by default
 *   FTP_SECURE           optional: `false` (default), `explicit` (FTPS on 21) or
 *                        `implicit` (FTPS on 990)
 *   FTP_INSECURE         optional, `true` skips the TLS certificate check, for a
 *                        host whose certificate is issued for another name
 *   FTP_TLS_MAX          optional, the highest TLS version for FTPS (1.2 by
 *                        default, because 1.3 data connections get aborted)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUTPUT = path.join(ROOT, '.output')
const DOTENV = path.join(ROOT, '.env')

/** A credential helper may want to open a dialog, so pushes never hang forever. */
const PUSH_TIMEOUT_MS = 5 * 60 * 1000

/** curl limits, in seconds: a slow FTP host must not hang the deploy. */
const FTP_CONNECT_TIMEOUT = 30
const FTP_TRANSFER_TIMEOUT = 60 * 60

/** Transfers per curl call: Windows caps a whole command line at ~32k characters. */
const FTP_BATCH = 20

/** FTP hosts throttle bursts; a dropped data connection should not cost the deploy. */
const FTP_ATTEMPTS = 3
const FTP_RETRY_DELAY_MS = 2000

const argv = process.argv.slice(2)
const hasFlag = (flag) => argv.includes(flag)
const flagValue = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1]
}

const SKIP_BUILD = hasFlag('--no-build')
const SKIP_GITHUB = hasFlag('--no-github')
const SKIP_FTP = hasFlag('--no-ftp')
const PRUNE = hasFlag('--prune')
const VERIFY = hasFlag('--verify')
const DRY_RUN = hasFlag('--dry-run')
const DEFAULT_MESSAGE = `Deploy ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`
const MESSAGE = flagValue('--message', flagValue('-m', DEFAULT_MESSAGE))

/** Anything that went wrong after the script decided to keep going. */
const problems = []

const log = (message) => console.log(message)
const step = (message) => console.log(`\n== ${message}`)

function fail(message) {
  console.error(`\n!! ${message}`)
  process.exit(1)
}

/** Runs a command line in the repository root with its output passed through. */
function run(line) {
  // The shell is what resolves `npm` to npm.cmd on Windows. The line is passed as
  // one string on purpose: Node deprecates an argument list together with `shell`.
  const result = spawnSync(line, { cwd: ROOT, stdio: 'inherit', shell: true })

  if (result.error) fail(`Could not run \`${line}\`: ${result.error.message}`)
  if (result.status !== 0) fail(`\`${line}\` failed with code ${result.status}`)
}

/**
 * Runs curl. Failures are thrown so callers can report them next to the rest of
 * the summary; `allowFailure` turns them into a result the caller inspects.
 */
function curl(args, { allowFailure = false } = {}) {
  const result = spawnSync('curl', args, { cwd: ROOT, encoding: 'utf8' })

  if (result.error) {
    fail(`Could not run curl: ${result.error.message}. Deploy from a machine with curl installed.`)
  }

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`curl failed (${result.status}): ${(result.stderr || '').trim() || 'no message'}`)
  }

  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

/** Waits without turning the whole script asynchronous. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Runs a curl call until it succeeds or the attempts run out. FTP hosts answer 451
 * (and similar) when they throttle a burst of uploads, which is worth retrying;
 * whatever is still failing afterwards is reported.
 */
function curlWithRetry(args, attempts = FTP_ATTEMPTS) {
  let result = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = curl(args, { allowFailure: true })
    if (result.status === 0) return result
    if (attempt < attempts) sleep(FTP_RETRY_DELAY_MS * attempt)
  }

  return result
}

/** Runs git in the repository root and returns its trimmed stdout, or throws. */
function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

/** Runs git and reports the outcome instead of throwing, so callers can react. */
function gitTry(args, options = {}) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...options })

  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    timedOut: result.error?.code === 'ETIMEDOUT'
  }
}

/** Reports the lines a push wrote to stderr (progress, commit summaries). */
function reportPush(result) {
  for (const line of result.stderr.split('\n').map((line) => line.trim()).filter(Boolean)) {
    log(`     ${line}`)
  }
}

/** `13.2 MB`, enough precision to judge whether an upload will be quick. */
const human = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Number of files and total size of a directory tree. */
function measure(dir) {
  let files = 0
  let bytes = 0

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = measure(full)
      files += nested.files
      bytes += nested.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += fs.statSync(full).size
    }
  }

  return { files, bytes }
}

/** Every file below `dir`, as paths relative to it with forward slashes. */
function walkFiles(dir) {
  const files = []

  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) files.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }

  visit(dir)

  return files.sort()
}

/** `KEY=VALUE` pairs from `.env`; the file is optional and never committed. */
function readDotEnv() {
  const values = {}
  if (!fs.existsSync(DOTENV)) return values

  for (const line of fs.readFileSync(DOTENV, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }

  return values
}

const dotEnv = readDotEnv()

/** A setting from the environment, falling back to `.env`. */
const setting = (name) => (process.env[name] || dotEnv[name] || '').trim()

/** Turns `git@github.com:user/repo.git` or a clone URL into the web URL. */
function webUrl(remoteUrl) {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`

  const https = /^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (https) return `https://${https[1]}`

  return remoteUrl
}

/** The FTP destination, or exits when the settings are incomplete. */
function ftpTarget() {
  const server = setting('FTP_SERVER')
  const user = setting('FTP_USERNAME')
  const password = setting('FTP_PASSWORD')
  const base = setting('FTP_PATH')
  const port = setting('FTP_PORT') || '21'
  const secure = (setting('FTP_SECURE') || 'false').toLowerCase()
  const insecure = ['true', '1', 'yes'].includes((setting('FTP_INSECURE') || '').toLowerCase())

  if (!server || !user || !password || !base) {
    fail('FTP_SERVER, FTP_USERNAME, FTP_PASSWORD and FTP_PATH must be set, in .env or the environment.')
  }

  if (!['false', 'explicit', 'implicit'].includes(secure)) {
    fail(`FTP_SECURE must be false, explicit or implicit (got "${secure}").`)
  }

  // `/data02/hosting/heroofazeroth` and `/data02/hosting/heroofazeroth/` name the
  // same directory; URLs are built from it, so it needs its trailing slash.
  const root = `/${base.replace(/\\/g, '/').split('/').filter(Boolean).join('/')}/`

  return { server, user, password, port, secure, insecure, root }
}

/** `ftp://host:21/dir/`, or `ftps://` when implicit TLS is configured. */
function ftpUrl(target, dir) {
  const scheme = target.secure === 'implicit' ? 'ftps' : 'ftp'
  return `${scheme}://${target.server}:${target.port}${target.root}${dir}`
}

/** curl arguments every FTP call shares. */
function ftpArgs(target, netrc) {
  const args = [
    '--silent',
    '--show-error',
    '--netrc-file',
    netrc,
    '--connect-timeout',
    String(FTP_CONNECT_TIMEOUT),
    '--max-time',
    String(FTP_TRANSFER_TIMEOUT),
    '--ftp-create-dirs'
  ]

  // `--ssl-reqd` upgrades a plain connection on port 21; an `ftps://` URL already
  // wraps the whole session, so it must not be combined with the flag.
  if (target.secure === 'explicit') args.push('--ssl-reqd')

  // FTPS data connections are fragile over TLS 1.3: this kind of host answers
  // `451 Error during read from data connection` and leaves a zero-byte file
  // behind, so TLS is capped at 1.2 unless FTP_TLS_MAX asks for another version.
  if (target.secure !== 'false') {
    const tlsMax = setting('FTP_TLS_MAX') || '1.2'
    if (tlsMax !== 'off') args.push('--tls-max', tlsMax)
  }

  // Shared hosting certificates are usually issued for another name than the FTP
  // host, so the check can be waived explicitly with FTP_INSECURE=true.
  if (target.insecure) args.push('--insecure')

  return args
}

/**
 * Writes the credentials to a temporary netrc file for curl to read, so the
 * password stays out of the command line and out of the process list.
 */
function writeNetrc(target) {
  const file = path.join(os.tmpdir(), `hoa-ftp-${process.pid}.netrc`)
  const contents = `machine ${target.server}\nlogin ${target.user}\npassword ${target.password}\n`

  fs.writeFileSync(file, contents, { mode: 0o600 })

  return file
}

/**
 * Uploads the build, one curl call per directory (and per batch inside it). Every
 * `-T` gets the URL of the file it uploads: handed several `-T` options and a
 * single directory URL, curl uploads the first file and silently drops the rest.
 */
function upload(target, netrc, files) {
  const directories = new Map()

  for (const file of files) {
    const dir = path.posix.dirname(file)
    const key = dir === '.' ? '' : `${dir}/`
    if (!directories.has(key)) directories.set(key, [])
    directories.get(key).push(file)
  }

  let uploaded = 0
  const failures = []

  for (const [dir, list] of [...directories].sort(([a], [b]) => a.localeCompare(b))) {
    for (let index = 0; index < list.length; index += FTP_BATCH) {
      const batch = list.slice(index, index + FTP_BATCH)
      const args = ftpArgs(target, netrc)

      for (const file of batch) {
        args.push('--upload-file', path.join(OUTPUT, file))
        args.push(fileUrl(target, file))
      }

      const result = curlWithRetry(args)

      if (result.status === 0) {
        uploaded += batch.length
        log(`   ${dir || './'} <- ${batch.length} file(s), ${uploaded}/${files.length}`)
      } else {
        const message = (result.stderr || '').trim().replace(/\s+/g, ' ')
        failures.push(`${dir || './'} (${batch.length} file(s)): ${message}`)
        log(`   !! ${dir || './'}: ${message}`)
      }
    }
  }

  return { uploaded, failures }
}

/** The URL of one file on the server. */
function fileUrl(target, file) {
  const dir = path.posix.dirname(file)
  const key = dir === '.' ? '' : `${dir}/`
  return `${ftpUrl(target, key)}${encodeURIComponent(path.posix.basename(file))}`
}

/** Names in a remote directory, or null when the directory is not there yet. */
function remoteNames(target, netrc, dir) {
  const listing = curl([...ftpArgs(target, netrc), '--list-only', ftpUrl(target, dir)], { allowFailure: true })

  if (listing.status !== 0) return null

  return listing.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
}

/**
 * The build's directories, each mapped to the file names directly inside it. A
 * directory that only holds other directories is in here too, which is what lets
 * pruning tell a directory from a file and keeps verification from skipping it.
 */
function localTree(files) {
  const directories = new Map()
  const mark = (key) => {
    if (!directories.has(key)) directories.set(key, new Set())
    return directories.get(key)
  }

  for (const file of files) {
    const dir = path.posix.dirname(file)
    mark(dir === '.' ? '' : `${dir}/`).add(path.posix.basename(file))

    for (let parent = dir; parent !== '.' && parent !== ''; parent = path.posix.dirname(parent)) {
      mark(`${parent}/`)
    }
  }

  return directories
}

/**
 * Asks the server to delete names in a remote directory. Best effort on purpose:
 * a batch that trips over one name still deletes the others, so what was really
 * removed is established by reading the directory back, not from this call.
 */
function deleteRemote(target, netrc, dir, names) {
  const args = ftpArgs(target, netrc)
  for (const name of names) args.push('--quote', `+DELE ${name}`)
  args.push('--list-only', ftpUrl(target, dir))

  curl(args, { allowFailure: true })
}

/**
 * Deletes the remote files this build no longer contains, but only below `public/`
 * and `server/chunks/`: those hold the content-hashed bundles that change on every
 * build, while `server/node_modules/` mirrors the dependencies, is huge and is not
 * worth walking on every deploy. Only files are deleted, never directories, so the
 * worst a mistyped FTP_PATH can do is remove files inside those two trees.
 */
function prune(target, netrc, directories) {
  let removed = 0
  const skipped = []

  for (const [dir, names] of directories) {
    if (!dir.startsWith('public/') && !dir.startsWith('server/chunks/')) continue

    const present = remoteNames(target, netrc, dir)
    if (!present) continue

    const stale = present.filter((name) => {
      // A name this build also has as a directory is not stale: the files inside it
      // are judged on their own directory's turn.
      if (directories.has(`${dir}${name}/`)) return false
      return !names.has(name)
    })

    if (!stale.length) continue

    for (let index = 0; index < stale.length; index += FTP_BATCH) {
      deleteRemote(target, netrc, dir, stale.slice(index, index + FTP_BATCH))
    }

    // The directory is read back because only the server can say what it let go of.
    const left = remoteNames(target, netrc, dir) || []
    const kept = stale.filter((name) => left.includes(name))

    removed += stale.length - kept.length
    for (const name of kept) skipped.push(`${dir}${name}`)
  }

  return { removed, skipped }
}

/**
 * The size the server reports for a file, or null when it will not say: the file is
 * not there, or the server has no SIZE command. That is one request per file, which
 * is why it only runs under `--verify`.
 */
function remoteSize(target, netrc, file) {
  const result = curl([...ftpArgs(target, netrc), '--head', fileUrl(target, file)], { allowFailure: true })

  if (result.status !== 0) return null

  const match = /content-length:\s*(\d+)/i.exec(result.stdout)
  return match ? Number(match[1]) : null
}

/**
 * Reads every directory back from the server and reports the files that did not
 * arrive, plus the ones whose size is not the size they were built with — a
 * transfer that was cut short leaves exactly that behind.
 */
function verify(target, netrc, directories) {
  const missing = []
  const differing = []
  let checked = 0

  for (const [dir, names] of directories) {
    const present = remoteNames(target, netrc, dir)

    if (!present) {
      if (names.size) missing.push(`${dir || './'} (the whole directory is missing)`)
      continue
    }

    const found = new Set(present)

    for (const name of names) {
      const file = `${dir}${name}`
      checked += 1

      if (!found.has(name)) {
        missing.push(file)
        continue
      }

      const size = remoteSize(target, netrc, file)
      const local = fs.statSync(path.join(OUTPUT, file)).size
      if (size !== null && size !== local) differing.push(`${file} (${size} on the server, ${local} here)`)
    }
  }

  return { checked, missing, differing }
}

if (SKIP_GITHUB && SKIP_FTP) fail('--no-github and --no-ftp together leave nothing to publish.')

// Everything is checked before the build runs: a repository without a remote, or
// FTP settings that cannot work, should not cost a full build first.
step('Checking the setup')

let target = null
if (SKIP_FTP) {
  log('   ftp    : skipped (--no-ftp)')
} else {
  target = ftpTarget()
  const scheme = target.secure === 'implicit' ? 'ftps' : 'ftp'
  const tls = target.secure === 'false'
    ? 'no TLS'
    : `${target.secure} TLS${target.insecure ? ', certificate check off' : ''}`
  log(`   ftp    : ${scheme}://${target.server}:${target.port}${target.root} (${tls})`)
}

const inRepo = gitTry(['rev-parse', '--is-inside-work-tree']).stdout === 'true'
const remote = inRepo ? gitTry(['remote', 'get-url', 'origin']) : { status: 1, stdout: '' }
const REPO_URL = remote.stdout ? webUrl(remote.stdout) : ''
let branch = inRepo ? gitTry(['symbolic-ref', '--short', 'HEAD']).stdout : ''

if (SKIP_GITHUB) {
  log('   github : skipped (--no-github)')
} else {
  if (!inRepo) fail('This is not a git checkout, so there is nothing to push to GitHub.')
  if (remote.status !== 0) {
    fail('There is no `origin` remote. Add one with: git remote add origin https://github.com/<user>/<repo>.git')
  }
  if (!gitTry(['config', 'user.email']).stdout) {
    fail('git has no user.email. Set one with: git config user.email "you@example.com"')
  }
  if (!branch) fail('HEAD is detached; check out a branch (main) before deploying.')

  log(`   origin : ${remote.stdout}`)
  log(`   branch : ${branch}`)
}

// Step 1 — the build.
if (SKIP_BUILD) {
  step('Skipping the build (--no-build)')
} else if (DRY_RUN) {
  step('Skipping the build (dry run)')
} else {
  step('Building (`npm run build`)')
  run('npm run build')
}

const buildStats = fs.existsSync(path.join(OUTPUT, 'server', 'index.mjs')) ? measure(OUTPUT) : null

if (!SKIP_FTP && !buildStats) {
  fail('`.output/server/index.mjs` is missing. Run `npm run build` first, or drop --no-build.')
}

// Step 2 — the sources. Only sources go to GitHub: the build output is gitignored.
let sourceSha = gitTry(['rev-parse', 'HEAD']).stdout || null

if (SKIP_GITHUB) {
  step('Skipping GitHub (--no-github)')
} else if (DRY_RUN) {
  const pending = gitTry(['status', '--porcelain'])
  step('GitHub (dry run)')
  log(`   would commit ${pending.stdout ? pending.stdout.split('\n').length : 0} changed path(s) to ${branch}`)
} else {
  step(`Committing the sources to ${branch}`)
  git(['add', '--all'])

  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT }).status !== 0
  if (changed) {
    git(['commit', '-m', MESSAGE])
    log('   committed')
  } else {
    log('   nothing to commit')
  }

  sourceSha = git(['rev-parse', 'HEAD'])
  log(`   ${branch} at ${sourceSha.slice(0, 7)}`)

  step(`Pushing ${branch} to origin`)
  const pushed = gitTry(['push', '--set-upstream', 'origin', branch], { timeout: PUSH_TIMEOUT_MS })

  if (pushed.timedOut) {
    problems.push(`the push of ${branch} timed out, a credential prompt is probably waiting`)
  } else if (pushed.status !== 0) {
    problems.push(`pushing ${branch} failed: ${pushed.stderr.split('\n')[0]}`)
    log(`   !! ${pushed.stderr}`)
  } else {
    reportPush(pushed)
    log(`   ${branch} is up to date on origin`)
  }
}

// Step 3 — the build output, straight onto the server.
let plannedFiles = []
let plannedStats = null
let uploadedFiles = 0
let uploadedBytes = 0

if (SKIP_FTP) {
  step('Skipping the FTP upload (--no-ftp)')
} else if (DRY_RUN) {
  step(`FTP upload to ${target.server} (dry run)`)
  plannedFiles = walkFiles(OUTPUT)
  plannedStats = measure(OUTPUT)
  log(`   would upload ${plannedFiles.length} files, ${human(plannedStats.bytes)} into ${target.root}`)
  if (PRUNE) log('   --prune: stale files below public/ and server/chunks/ would be deleted')
  if (VERIFY) log('   --verify: every directory would be read back afterwards')
} else {
  step('Uploading .output to the FTP target')

  // The deployed copy should say what it is, so a server can be told apart from an
  // older upload. It is written into `.output` itself, which is gitignored anyway.
  fs.writeFileSync(
    path.join(OUTPUT, 'deploy.json'),
    `${JSON.stringify(
      {
        source: {
          branch: branch || null,
          commit: sourceSha,
          url: sourceSha && REPO_URL ? `${REPO_URL}/commit/${sourceSha}` : null
        },
        target: `${target.server}${target.root}`,
        uploadedAt: new Date().toISOString(),
        node: process.version
      },
      null,
      2
    )}\n`
  )

  const files = walkFiles(OUTPUT)
  const stats = measure(OUTPUT)
  const directories = localTree(files)
  const netrc = writeNetrc(target)

  try {
    const { uploaded, failures } = upload(target, netrc, files)

    uploadedFiles = uploaded
    uploadedBytes = stats.bytes
    log(`   uploaded ${uploaded}/${files.length} files, ${human(stats.bytes)}`)
    for (const failure of failures) problems.push(`the upload of ${failure}`)

    if (PRUNE) {
      const { removed, skipped } = prune(target, netrc, directories)
      log(`   pruned ${removed} stale file(s)`)
      for (const entry of skipped) log(`   !! left on the server: ${entry} (a directory, or no permission)`)
    }

    if (VERIFY) {
      const { checked, missing, differing } = verify(target, netrc, directories)
      log(`   checked ${checked} files back, sizes included`)

      if (!missing.length && !differing.length) {
        log(`   every file is on ${target.server}${target.root}, at the size it was built`)
      } else {
        for (const entry of missing.slice(0, 20)) problems.push(`missing on the server: ${entry}`)
        if (missing.length > 20) problems.push(`missing on the server: ${missing.length - 20} more`)
        for (const entry of differing.slice(0, 20)) problems.push(`size differs on the server: ${entry}`)
        if (differing.length > 20) problems.push(`size differs on the server: ${differing.length - 20} more`)
      }
    }
  } catch (error) {
    problems.push(`the FTP upload failed: ${error.message.split('\n')[0]}`)
  } finally {
    fs.rmSync(netrc, { force: true })
  }
}

// The summary doubles as the deploy note: what moved, where, and how to run it.
step('Summary')

if (SKIP_GITHUB) {
  log('   github : skipped (--no-github)')
} else if (DRY_RUN) {
  log(`   github : ${branch} would be pushed to ${REPO_URL}`)
} else if (sourceSha) {
  log(`   github : ${branch} ${sourceSha.slice(0, 7)} -> ${REPO_URL}/commits/${branch}`)
}

if (SKIP_FTP) {
  log('   ftp    : skipped (--no-ftp)')
} else if (DRY_RUN) {
  log(`   ftp    : ${plannedFiles.length} files, ${human(plannedStats.bytes)} would go to ${target.server}${target.root}`)
} else {
  log(`   ftp    : ${uploadedFiles} files, ${human(uploadedBytes)} uploaded to ${target.server}${target.root}`)
  log(`   server : cd into that directory and run  node server/index.mjs`)
  log('            with NUXT_BLIZZARD_CLIENT_ID and NUXT_BLIZZARD_CLIENT_SECRET in its')
  log('            environment; it listens on 3100 unless the environment sets PORT or NITRO_PORT')
}

if (DRY_RUN) {
  log('   dry run: nothing was built, committed or uploaded. Drop --dry-run to deploy.')
}

if (problems.length) {
  console.error('\n!! Finished with problems:')
  for (const problem of problems) console.error(`   - ${problem}`)
  process.exit(1)
}

log('\nDone.')