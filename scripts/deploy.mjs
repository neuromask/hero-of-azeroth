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
 *   4. The `.env` beside this checkout is uploaded next to them, as `.env` in
 *      that same directory: the app reads that file out of its own folder when it
 *      starts (`server/utils/runtimeEnv`), so the host needs nothing put into the
 *      environment of its process. The `FTP_*` settings are left out of the copy
 *      that travels - they are the credentials of the transfer itself - and the
 *      `.env` that was there is kept as `.env.previous`, so a bad configuration
 *      can be put back. `--no-env` sends none of it, `--env-all` sends it verbatim.
 *      The file is only sent when it says something different from the copy the
 *      host already has: a configuration that rarely changes should not be
 *      re-uploaded, and should not be reported as a change - the restart note
 *      printed beside it is only true when something moved. `--env-force` sends
 *      it regardless.
 *   5. Before any of that, the data the site has written on the host is read back
 *      into `backups/<date>/`: the files as `server-data/`, and one
 *      `server-data.zip` holding that folder and a `backup.json` that says where
 *      it came from and what is inside. It is the SQLite database, the character
 *      index the sitemap is built from and the hall of fame's table (the one
 *      directory `server/utils/appPaths` names). None of them is part of
 *      `.output` and nothing here deletes them - which is exactly why a copy is
 *      worth having, because they are the only thing in this repository's world
 *      that a build cannot produce again. `--no-backup` skips it.
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
 *   --no-env             do not upload the `.env` beside this checkout
 *   --env-all            upload that `.env` verbatim, `FTP_*` settings included
 *   --env-force          upload the `.env` even when the host already says the same thing
 *   --no-backup          do not read the site's data directory back before uploading
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
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { sameEnv } from './lib/envFile.mjs'
import { findSecrets, readDotenv, secretValues } from './lib/secrets.mjs'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUTPUT = path.join(ROOT, '.output')
const DOTENV = path.join(ROOT, '.env')

/** Where a copy of the host's own data directory is kept: one directory per deploy, beside the checkout. */
const BACKUPS = path.join(ROOT, 'backups')

/** The remote directory that holds what the site writes: nothing in `.output` replaces it. */
const DATA_DIR = 'server/data'

/**
 * The same directory, spelled the way a listing needs it.
 *
 * The trailing slash is not cosmetic: an FTP `LIST` of a path without one answers with the *parent*
 * directory's contents - `server/` rather than `server/data/` - which turns a backup into a folder of
 * names it then fails to fetch, and nothing about it looks wrong until the day the copy is needed.
 */
const DATA_LISTING = `${DATA_DIR}/`

/**
 * The stores the site used to keep beside its database and no longer reads.
 *
 * `leaderboard.json` was the hall of fame's own table before it moved into the database
 * (`server/utils/statisticsMigration` moves its rows and deliberately leaves the file where it is - a build that
 * turned out wrong can be rolled back to one that still understands it). So it is copied only while the database
 * does not hold that table yet: the same table twice, in every backup, for ever, is not a backup.
 */
const LEGACY_STORES = [{ name: 'leaderboard.json', table: 'leaderboard' }]

/** The database in the copy, under the name the site keeps it in (`server/utils/db`). */
const DATA_DATABASE = 'hoa.db'

/**
 * True when the database in the copy just taken already holds the rows a legacy store was the only copy of.
 *
 * Asked of the copy rather than of the host, because the copy is the file that would be read back one day. Every
 * answer that is not a clear yes keeps the store: no database, one that cannot be opened, a table this build does
 * not have, no rows in it - each of those is a copy that must not throw a file away.
 */
function databaseHolds(database, table) {
  if (!fs.existsSync(database)) return false

  let db = null

  try {
    db = new DatabaseSync(database, { readOnly: true })
    const counted = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()
    return Number(counted?.n) > 0
  } catch {
    return false
  } finally {
    try {
      db?.close()
    } catch {
      // Never opened, or already closed: nothing to do about either.
    }
  }
}

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
/** The `.env` beside the server is uploaded with the build unless `--no-env`; `--env-all` sends it verbatim. */
const SKIP_ENV = hasFlag('--no-env')
const ENV_ALL = hasFlag('--env-all')
/** A `.env` the host already says the same thing about is left alone unless `--env-force`. */
const ENV_FORCE = hasFlag('--env-force')
/** The site's own data is read back before the upload unless `--no-backup`. */
const SKIP_BACKUP = hasFlag('--no-backup')
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
 * The `.env` the deploy sends, with the transfer's own credentials left out.
 *
 * The app reads the `.env` in its own directory when it starts (`server/utils/runtimeEnv`), so the host needs
 * no environment of its own - which is what a shared host with a plain `node server/index.mjs` gives anyway.
 * The file is deliberately *not* part of `.output`: the artefact stays free of secrets (the check above
 * enforces that), and the configuration travels as the separate file the site is meant to read.
 *
 * `FTP_*` is left out of it: those are the credentials of this very transfer, and publishing them in the
 * directory the site is served from would hand them to anybody who can read that directory. `--env-all` sends
 * the file verbatim, `--no-env` sends none of it.
 */
function preparedEnv() {
  const lines = fs.readFileSync(DOTENV, 'utf8').split('\n')
  const kept = ENV_ALL ? lines : lines.filter((line) => !/^\s*(export\s+)?FTP_/.test(line))

  return { contents: kept.join('\n'), dropped: lines.length - kept.length }
}

/** A temporary file, readable by its owner alone, that the caller removes when the transfer is over. */
function tempFile(name, contents) {
  const file = path.join(os.tmpdir(), `${name}-${process.pid}`)
  fs.writeFileSync(file, contents, { mode: 0o600 })
  return file
}

/** The `.env` already on the host, or null when there is none to read. */
function remoteEnv(target, netrc) {
  const result = curl([...ftpArgs(target, netrc), '--silent', ftpUrl(target, '.env')], { allowFailure: true })
  return result.status === 0 && result.stdout.trim() ? result.stdout : null
}

/** Uploads one file that is not part of the artefact: `<root><remote>`, from a path on this machine. */
function putFile(target, netrc, local, remote) {
  return curlWithRetry([...ftpArgs(target, netrc), '--upload-file', local, ftpUrl(target, remote)])
}

/**
 * Sends the configuration the host reads when it starts: the `.env` itself, and - when there was one - the
 * `.env` it replaces, kept as `.env.previous` so a bad configuration is one upload away from being put back.
 *
 * Nothing is sent when the host already says the same thing. The configuration rarely changes, and
 * re-uploading an identical file would rotate `.env.previous` for no reason and report a change - with the
 * restart that goes with it - that nobody made. `--env-force` overrules the comparison.
 */
function sendEnvFile(target, netrc, prepared) {
  const result = { sent: 0, kept: 0, unchanged: 0, problems: [] }
  const previous = remoteEnv(target, netrc)

  if (previous && !ENV_FORCE && sameEnv(previous, prepared.contents)) {
    result.unchanged = 1
    return result
  }

  if (previous) {
    const kept = tempFile('hoa-env-previous', previous)
    try {
      if (putFile(target, netrc, kept, '.env.previous').status === 0) result.kept = 1
    } finally {
      fs.rmSync(kept, { force: true })
    }
  }

  const file = tempFile('hoa-env', prepared.contents)
  try {
    const uploaded = putFile(target, netrc, file, '.env')
    if (uploaded.status === 0) result.sent = 1
    else result.problems.push(`the upload of .env failed: ${(uploaded.stderr || '').trim().split('\n')[0]}`)
  } finally {
    fs.rmSync(file, { force: true })
  }

  return result
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

  // `.` and `..` are the directory itself and its parent: servers list them, nothing can delete them, and
  // they are not files anyone means to prune or verify.
  return listing.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((name) => name && name !== '.' && name !== '..')
}

/** `4.5 MB`, `812 KB`, `97 B`: enough to judge what a copy weighs. */
function sizeOf(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`

  return `${bytes} B`
}

/**
 * Packs a copy into one archive beside it, and says how many entries landed in it.
 *
 * The folder is what a restore copies back, and the archive is what is worth keeping: one file per deploy
 * rather than six - the database's write-ahead log alone is four megabytes - and nothing to lose in a
 * directory listing. `tar` is used because Windows has shipped it since the same release as `curl`, and `-a`
 * picks the zip format from the name. A machine that cannot pack is not a reason to fail a deploy: the
 * folder is already there, and the caller reports the archive it did not get.
 */
function packBackup(directory) {
  const archive = `${directory}.zip`
  const folder = path.dirname(directory)
  const name = path.basename(directory)

  const packed = spawnSync('tar', ['-a', '-c', '-f', archive, '-C', folder, name], { cwd: ROOT, encoding: 'utf8' })
  if (packed.error || packed.status !== 0 || !fs.existsSync(archive)) return null

  // Read back, so the report is about an archive that really holds the files rather than a file that exists.
  const listed = spawnSync('tar', ['-t', '-f', archive], { cwd: ROOT, encoding: 'utf8' })
  const entries = (listed.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return { archive, bytes: fs.statSync(archive).size, entries: entries.length }
}

/**
 * Reads the site's own data directory back into `backups/<stamp>/` on this machine.
 *
 * It is the one thing this deploy does not own and could not rebuild: the SQLite database, which holds the
 * accounts, their characters, the snapshots and the hall of fame's own table, and the character index the sitemap
 * is built from - both written by the running site into the directory `server/utils/appPaths` names. Nothing here
 * deletes or replaces them; the copy is for the day something else does, when the alternative is a front page that
 * has to be filled again from scratch.
 *
 * The copy is kept two ways, because they answer different needs: `server-data/` is what a restore copies
 * back file by file, and `server-data.zip` is one archive holding that folder and a `backup.json` saying
 * where it came from, which commit it was taken beside, and what is inside. A host that has never run the
 * site has no directory there, which is not a problem worth reporting.
 *
 * A store the database has taken over is left out of the copy - and only once the copied database really holds
 * it (`databaseHolds`), so the deploy that first ships the move still carries the file, and every deploy after
 * that one does not.
 */
function backupRemoteData(target, netrc) {
  const listed = remoteNames(target, netrc, DATA_LISTING)
  const names = (listed || []).filter((name) => name !== '.' && name !== '..')
  if (!names.length) return { nothing: true }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const folder = path.join(BACKUPS, stamp)
  const directory = path.join(folder, 'server-data')
  fs.mkdirSync(directory, { recursive: true })

  const kept = []
  const failed = []

  for (const name of names) {
    const local = path.join(directory, name)
    // Retried like an upload: this kind of host throttles a burst of transfers, and a data file that is
    // skipped because the server was briefly busy is a file the copy does not have.
    const result = curlWithRetry([
      ...ftpArgs(target, netrc),
      '--output',
      local,
      ftpUrl(target, `${DATA_DIR}/${name}`)
    ])

    if (result.status === 0 && fs.existsSync(local) && fs.statSync(local).size > 0) {
      kept.push({ name, bytes: fs.statSync(local).size })
    } else {
      failed.push(name)
      fs.rmSync(local, { force: true })
    }
  }

  // A store the database has taken over is left out of the copy, and only when it really has it: the file stays
  // for every other answer (`databaseHolds`). This is where `leaderboard.json` stops being copied - the deploy
  // that first ships the move still keeps it, because the table is not in the database until the new build has
  // started once, and every deploy after that one leaves it out.
  const skipped = []

  for (const store of LEGACY_STORES) {
    const file = path.join(directory, store.name)
    if (!fs.existsSync(file) || !databaseHolds(path.join(directory, DATA_DATABASE), store.table)) continue

    fs.rmSync(file, { force: true })
    skipped.push({ name: store.name, reason: `${store.table} is in ${DATA_DATABASE}` })
  }

  const copied = kept.filter((file) => !skipped.some((gone) => gone.name === file.name))
  const bytes = copied.reduce((total, file) => total + file.bytes, 0)

  fs.writeFileSync(
    path.join(folder, 'backup.json'),
    `${JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        from: `${target.server}${target.root}${DATA_DIR}`,
        commit: sourceSha,
        files: copied,
        // What was there and was not copied, so a copy that is missing a file says why it is.
        skipped,
        bytes
      },
      null,
      2
    )}\n`
  )

  const packed = packBackup(directory)
  const relative = (absolute) => path.relative(ROOT, absolute).split(path.sep).join('/')

  return {
    relative: relative(folder),
    kept: copied,
    skipped,
    failed,
    bytes,
    archive: packed ? { relative: relative(packed.archive), bytes: packed.bytes, entries: packed.entries } : null
  }
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
 *
 * `DELE` is sent *before* the transfer rather than after it (`-Q`, not `+Q`), and with the whole path. A
 * post-transfer quote is not something curl treats as a failure: this host answered a refusal to every one
 * of them - a burst of commands sent straight after sixty megabytes of uploads is exactly what it throttles -
 * and the run was reported as a directory full of files "left on the server" with nothing to say why. Sent
 * first, a refusal is an error curl exits on, which is what makes a retry and a reason possible.
 */
function deleteRemote(target, netrc, dir, names) {
  const args = ftpArgs(target, netrc)

  for (const name of names) {
    const file = `${dir}${name}`
    const folder = path.posix.dirname(file)
    const key = folder === '.' ? '' : `${folder}/`
    args.push('--quote', `DELE ${target.root}${key}${path.posix.basename(file)}`)
  }

  // No listing in this call: it is here to delete, and the directory is read back once by the caller.
  return curlWithRetry(args)
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
  let reason = null

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
      const result = deleteRemote(target, netrc, dir, stale.slice(index, index + FTP_BATCH))
      if (!reason && result.status !== 0) reason = (result.stderr || '').trim().split('\n')[0]
    }

    // The directory is read back because only the server can say what it let go of.
    const left = remoteNames(target, netrc, dir) || []
    const kept = stale.filter((name) => left.includes(name))

    removed += stale.length - kept.length
    for (const name of kept) skipped.push(`${dir}${name}`)
  }

  return { removed, skipped, reason }
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

/**
 * The gate: the artefact must not carry the site's runtime secrets.
 *
 * Nuxt writes a `runtimeConfig` default into the build, so a credential that is in the environment - or in
 * `.env`, which Nuxt loads while building - would end up inside `.output`, which is the thing this script
 * uploads, and inside the directory the host serves from. `nuxt.config.ts` therefore gives those fields
 * empty defaults and Nitro reads them from the host's environment per request; this check is what makes the
 * arrangement hold, because it fails the deploy instead of warning about it (`./lib/secrets.mjs`).
 *
 * It runs after the build and before anything leaves the machine - before the sources are pushed as well, so
 * a dirty artefact costs neither a commit nor an upload. A secret that is not in this environment is not
 * looked for (there is nothing to look for); the values themselves are never printed.
 */
if (!SKIP_FTP) {
  step('Checking the artefact for runtime secrets')

  const secrets = secretValues({ dotenv: readDotenv(DOTENV) })

  if (!secrets.size) {
    log('   none of the runtime secrets is set here or in .env, so there is nothing to look for')
    log('   (the build keeps them out of the artefact: see nuxt.config.ts)')
  } else {
    const findings = findSecrets(OUTPUT, secrets)
    if (findings.length) {
      for (const finding of findings) log(`   !! ${finding.key} is in ${finding.file}`)
      fail(
        'The build carries a runtime secret (listed above), so it is not uploaded. Rebuild with the secret\n' +
          '   out of the environment and out of .env, or check it by hand with `npm run check:secrets`.'
      )
    }
    log(`   ok: ${secrets.size} secret(s) looked for across ${findings.searched} file(s), none of them found`)
  }
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
    if (!SKIP_ENV && fs.existsSync(DOTENV)) {
      const prepared = preparedEnv()
      const left = prepared.dropped ? `${prepared.dropped} FTP_* line(s) left out of it` : 'every line, no FTP_* ones'
      log(`   would upload .env beside them if it differs from the host's copy (${left})`)
    }
  if (PRUNE) log('   --prune: stale files below public/ and server/chunks/ would be deleted')
  if (VERIFY) log('   --verify: every directory would be read back afterwards')
  if (!SKIP_BACKUP) {
    log(`   would read ${DATA_DIR} back into backups/ first, and pack it into server-data.zip`)
    log(`   (${LEGACY_STORES.map((store) => store.name).join(', ')} is left out of the copy once the database holds it)`)
  }
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
  // The configuration the site reads when it starts: it travels beside the artefact, never inside it.
  const envFile = SKIP_ENV || !fs.existsSync(DOTENV) ? null : preparedEnv()
  const netrc = writeNetrc(target)

  try {
    // The site's own data first, before a single file is uploaded: it is the only thing here a build cannot
    // produce again, and the copy taken now is the whole recovery plan for the day something replaces it.
    if (!SKIP_BACKUP) {
      const kept = backupRemoteData(target, netrc)

      if (kept.nothing) {
        // A host that has never run the site has nothing there, which is not a problem - the line is here so
        // that every deploy says what it saw either way.
        log(`   ${DATA_DIR} <- nothing to read back there yet`)
      } else {
        log(`   ${DATA_DIR} <- ${kept.kept.length} file(s), ${sizeOf(kept.bytes)} kept in ${kept.relative}`)

        for (const gone of kept.skipped) {
          log(`   ${DATA_DIR}/${gone.name} <- left out of the copy: ${gone.reason}`)
        }

        if (kept.archive) {
          log(`   ${path.basename(kept.archive.relative)} <- one archive, ${sizeOf(kept.archive.bytes)}, ${kept.archive.entries} entries`)
        } else {
          log('   !! could not pack the copy into an archive; the folder beside it is what to keep')
        }

        for (const name of kept.failed) {
          log(`   !! could not read ${DATA_DIR}/${name} back`)
          problems.push(`the copy of ${DATA_DIR}/${name} could not be read back`)
        }
      }
    }

    const { uploaded, failures } = upload(target, netrc, files)
    const sentEnv = envFile ? sendEnvFile(target, netrc, envFile) : null

    uploadedFiles = uploaded + (sentEnv?.sent ?? 0) + (sentEnv?.kept ?? 0)
    uploadedBytes = stats.bytes
    log(`   uploaded ${uploaded}/${files.length} files, ${human(stats.bytes)}`)
    for (const failure of failures) problems.push(`the upload of ${failure}`)

    if (sentEnv) {
      for (const problem of sentEnv.problems) problems.push(problem)

      if (sentEnv.unchanged) {
        log('   .env <- the host already says the same thing, left as it is')
      } else if (sentEnv.sent) {
        const left = envFile.dropped ? `${envFile.dropped} FTP_* line(s) left out` : 'no FTP_* lines in it'
        log(`   .env <- the configuration the site reads when it starts (${left})`)
        if (sentEnv.kept) log('   .env.previous <- the one it replaced, kept so a bad one can be put back')
        log('           restart the process on the host for it to take effect')
      }
    }

    // What `--verify` reads back, and what `--prune` leaves alone at the root: what was really sent, so an
    // `.env.previous` that was never written is not reported missing.
    const directories = localTree(
      sentEnv?.sent ? [...files, '.env', ...(sentEnv.kept ? ['.env.previous'] : [])] : files
    )

    if (PRUNE) {
      const { removed, skipped, reason } = prune(target, netrc, directories)
      log(`   pruned ${removed} stale file(s)`)

      // A host that refuses a burst of deletions leaves files behind, and that is disk space rather than a
      // broken deploy: one line saying how many and why, rather than a hundred saying where.
      if (skipped.length) {
        log(`   !! ${skipped.length} stale file(s) the host would not let go of${reason ? ` (${reason})` : ''}`)
        for (const entry of skipped.slice(0, 5)) log(`      ${entry}`)
        if (skipped.length > 5) log(`      ... and ${skipped.length - 5} more`)
        log('           the next deploy tries again')
      }
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
    log(
      `   env    : ${
        SKIP_ENV
          ? '.env untouched (--no-env)'
          : ENV_ALL
            ? '.env uploaded verbatim'
            : '.env uploaded, FTP_* left out of it'
      }`
    )
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
