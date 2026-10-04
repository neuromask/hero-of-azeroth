/**
 * Publishes the project to GitHub: `npm run deploy` builds and pushes, so the
 * machine that serves the site needs no toolchain at all.
 *
 * Three steps, in order:
 *
 *   1. `npm run build` writes `.output`, the Nitro `node-server` preset.
 *   2. The sources are committed and pushed to the current branch (`main`), so
 *      GitHub holds the project itself, with its history.
 *   3. `.output` is published to the `deploy` branch as a ready-to-run bundle. A
 *      server accepts it with `git fetch origin deploy && git reset --hard
 *      FETCH_HEAD` and starts `node server/index.mjs`: no `npm install`, no build
 *      tools. The bundle carries the linux-x64 resvg binary, and the win32-x64
 *      one ships too, so the same bundle also runs on Windows.
 *
 * The bundle commit is written straight into git's object database through a
 * temporary index and a temporary work tree, so the checked-out branch and the
 * working files are never touched. Line-ending conversion is off for it, so the
 * server executes exactly the bytes the build produced.
 *
 * The bundle holds no secrets: `.env` is ignored by git, so the server must
 * provide `NUXT_BLIZZARD_CLIENT_ID`, `NUXT_BLIZZARD_CLIENT_SECRET` and, when the
 * account-wide mount and reputation totals are wanted, `NUXT_WARBAND_CHARACTERS`
 * in its own environment. The server reads them per request, so changing them
 * needs a restart, not a rebuild.
 *
 * Usage: npm run deploy [-- <options>]
 *
 *   --no-build           publish what already sits in `.output`
 *   --no-source          skip step 2, the sources stay local
 *   --no-bundle          skip step 3, push the sources only
 *   --dry-run            report what would happen; nothing is committed or pushed
 *   --force              let the bundle push rewrite the remote branch
 *   --branch <name>      branch for the bundle (default: deploy)
 *   -m, --message <text> commit message (default: `Deploy <date> <time>`)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUTPUT = path.join(ROOT, '.output')

/** A credential helper may want to open a dialog, so pushes never hang forever. */
const PUSH_TIMEOUT_MS = 5 * 60 * 1000

const argv = process.argv.slice(2)
const hasFlag = (flag) => argv.includes(flag)
const flagValue = (flag, fallback) => {
  const index = argv.indexOf(flag)
  return index === -1 || index === argv.length - 1 ? fallback : argv[index + 1]
}

const SKIP_BUILD = hasFlag('--no-build')
const SKIP_SOURCE = hasFlag('--no-source')
const SKIP_BUNDLE = hasFlag('--no-bundle')
const DRY_RUN = hasFlag('--dry-run')
const FORCE = hasFlag('--force')
const BUNDLE_BRANCH = flagValue('--branch', 'deploy')
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

/** `13.2 MB`, enough precision to judge whether a push will be quick. */
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

/** Turns `git@github.com:user/repo.git` or a clone URL into the web URL. */
function webUrl(remoteUrl) {
  const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`

  const https = /^https?:\/\/(?:[^@/]+@)?(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (https) return `https://${https[1]}`

  return remoteUrl
}

/** Reports the lines a push wrote to stderr (progress, commit summaries). */
function reportPush(result) {
  for (const line of result.stderr.split('\n').map((line) => line.trim()).filter(Boolean)) {
    log(`     ${line}`)
  }
}

if (SKIP_SOURCE && SKIP_BUNDLE) fail('--no-source and --no-bundle together leave nothing to publish.')

// The preflight runs before anything is built: a repository without a remote or
// without a commit identity would otherwise only fail after a wasted build.
step('Checking the repository')

if (gitTry(['rev-parse', '--is-inside-work-tree']).stdout !== 'true') {
  fail('This is not a git checkout.')
}

const remote = gitTry(['remote', 'get-url', 'origin'])
if (remote.status !== 0) {
  fail('There is no `origin` remote. Add one with: git remote add origin https://github.com/<user>/<repo>.git')
}

const REPO_URL = webUrl(remote.stdout)

if (!gitTry(['config', 'user.email']).stdout) {
  fail('git has no user.email. Set one with: git config user.email "you@example.com"')
}

let branch = gitTry(['symbolic-ref', '--short', 'HEAD'])
if (branch.status !== 0) fail('HEAD is detached; check out a branch (main) before deploying.')
branch = branch.stdout

log(`   origin : ${remote.stdout}`)
log(`   branch : ${branch}`)
log(`   bundle : ${BUNDLE_BRANCH}`)

// Step 1 — the build.
if (SKIP_BUILD) {
  step('Skipping the build (--no-build)')
} else if (DRY_RUN) {
  step('Skipping the build (dry run)')
} else {
  step('Building (`npm run build`)')
  run('npm run build')
}

const outputStats = fs.existsSync(path.join(OUTPUT, 'server', 'index.mjs')) ? measure(OUTPUT) : null

if (!SKIP_BUNDLE && !outputStats) {
  fail('`.output/server/index.mjs` is missing. Run `npm run build` first, or drop --no-build.')
}

// Step 2 — the sources.
let sourceSha = gitTry(['rev-parse', 'HEAD']).stdout || null
if (SKIP_SOURCE) {
  step('Skipping the sources (--no-source)')
} else if (DRY_RUN) {
  const pending = gitTry(['status', '--porcelain'])
  step('Sources (dry run)')
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

// Step 3 — the bundle, which grows a history of its own on its own branch.
let bundleSha = null
let bundleStats = outputStats
if (SKIP_BUNDLE) {
  step('Skipping the bundle (--no-bundle)')
} else if (DRY_RUN) {
  step(`Bundle for ${BUNDLE_BRANCH} (dry run)`)
  log(`   would publish ${bundleStats.files} files, ${human(bundleStats.bytes)}`)
  log(`   carrying sources at ${sourceSha ? sourceSha.slice(0, 7) : 'none yet'}`)
} else {
  step(`Publishing .output to ${BUNDLE_BRANCH}`)

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'hoa-deploy-'))
  const indexFile = path.join(os.tmpdir(), `hoa-deploy-index-${process.pid}`)

  // git is pointed at the staging directory through the environment, so `git add`
  // walks the bundle instead of the project: the working tree is never involved
  // and no branch has to be switched.
  const bundleEnv = {
    ...process.env,
    GIT_DIR: path.join(ROOT, '.git'),
    GIT_WORK_TREE: staging,
    GIT_INDEX_FILE: indexFile
  }

  // `--force` on the add keeps files that a global gitignore would otherwise drop
  // (`node_modules` most of all, which the bundle is full of).
  const bundleGit = (args) =>
    execFileSync(
      'git',
      ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.eol=lf', ...args],
      { cwd: staging, env: bundleEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()

  try {
    fs.cpSync(OUTPUT, staging, { recursive: true })

    // The bundle is deployed as it was built, so git must not rewrite its bytes.
    fs.writeFileSync(path.join(staging, '.gitattributes'), ['* -text -diff', ''].join('\n'))

    fs.writeFileSync(
      path.join(staging, 'README.md'),
      [
        '# hero-of-azeroth — build output',
        '',
        'Published by `npm run deploy`. Do not edit by hand: the sources live on the',
        `\`${branch}\` branch of <${REPO_URL}>, and every deploy replaces this branch.`,
        '',
        '## Running it',
        '',
        '```bash',
        'NUXT_BLIZZARD_CLIENT_ID=... \\',
        'NUXT_BLIZZARD_CLIENT_SECRET=... \\',
        'NUXT_WARBAND_CHARACTERS=eu/gordunni/neromask \\',
        'node server/index.mjs',
        '```',
        '',
        'The server listens on `PORT` (3000 by default) and `HOST` (`0.0.0.0` by',
        'default). `NUXT_WARBAND_CHARACTERS` is optional and only needed for the',
        'account-wide mount and reputation totals. Nothing secret is stored here: the',
        'variables have to come from the environment of the service that runs it.',
        ''
      ].join('\n')
    )

    fs.writeFileSync(
      path.join(staging, 'deploy.json'),
      `${JSON.stringify(
        {
          source: {
            branch,
            commit: sourceSha,
            url: sourceSha ? `${REPO_URL}/commit/${sourceSha}` : null
          },
          bundle: { branch: BUNDLE_BRANCH, generatedAt: new Date().toISOString(), node: process.version },
          output: bundleStats
        },
        null,
        2
      )}\n`
    )

    bundleGit(['read-tree', '--empty'])
    bundleGit(['add', '--all', '--force'])
    const tree = bundleGit(['write-tree'])

    // The bundle branch is linear on purpose: every deploy is a child of the last,
    // so the remote stays fast-forwardable and a server pulls without forcing.
    const onRemote = gitTry(['ls-remote', '--heads', 'origin', `refs/heads/${BUNDLE_BRANCH}`])
    let parent = null
    if (onRemote.status === 0 && onRemote.stdout) {
      git(['fetch', '--quiet', 'origin', `refs/heads/${BUNDLE_BRANCH}`])
      parent = git(['rev-parse', 'FETCH_HEAD'])
    }

    const commitArgs = ['commit-tree', tree, '-m', MESSAGE]
    if (parent) commitArgs.push('-p', parent)
    bundleSha = bundleGit(commitArgs)

    bundleStats = measure(staging)

    step(`Pushing ${BUNDLE_BRANCH} to origin`)
    const pushArgs = ['push']
    if (FORCE) pushArgs.push('--force')
    pushArgs.push('origin', `${bundleSha}:refs/heads/${BUNDLE_BRANCH}`)

    const pushed = gitTry(pushArgs, { timeout: PUSH_TIMEOUT_MS })

    if (pushed.timedOut) {
      problems.push(`the push of ${BUNDLE_BRANCH} timed out, a credential prompt is probably waiting`)
    } else if (pushed.status !== 0) {
      problems.push(`pushing ${BUNDLE_BRANCH} failed: ${pushed.stderr.split('\n')[0]}`)
      log(`   !! ${pushed.stderr}`)
    } else {
      reportPush(pushed)
      log(`   ${BUNDLE_BRANCH} now points at ${bundleSha.slice(0, 7)}`)
    }
  } catch (error) {
    problems.push(`building the ${BUNDLE_BRANCH} commit failed: ${error.message.split('\n')[0]}`)
  } finally {
    // The staging copy and the temporary index are throwaway: the objects they
    // produced already live in `.git`.
    fs.rmSync(staging, { recursive: true, force: true })
    fs.rmSync(indexFile, { force: true })
    fs.rmSync(`${indexFile}.lock`, { force: true })
  }
}

// The summary doubles as the deploy note: what moved, where, and what the server
// has to do to pick it up.
step('Summary')

if (SKIP_SOURCE) {
  log('   sources : skipped (--no-source)')
} else if (DRY_RUN) {
  log(`   sources : ${branch} would be pushed to ${REPO_URL}`)
} else if (sourceSha) {
  log(`   sources : ${branch} ${sourceSha.slice(0, 7)} -> ${REPO_URL}/commits/${branch}`)
}

if (SKIP_BUNDLE) {
  log('   bundle  : skipped (--no-bundle)')
} else if (bundleStats) {
  const target = bundleSha ? ` -> ${REPO_URL}/commits/${BUNDLE_BRANCH}` : ''
  log(`   bundle  : ${BUNDLE_BRANCH} (${bundleStats.files} files, ${human(bundleStats.bytes)})${target}`)
}

if (!SKIP_BUNDLE && !DRY_RUN) {
  log(`   server  : git fetch origin ${BUNDLE_BRANCH} && git reset --hard FETCH_HEAD && node server/index.mjs`)
}

if (DRY_RUN) {
  log('   dry run : nothing was built, committed or pushed. Drop --dry-run to deploy.')
}

if (problems.length) {
  console.error('\n!! Finished with problems:')
  for (const problem of problems) console.error(`   - ${problem}`)
  process.exit(1)
}

log('\nDone.')