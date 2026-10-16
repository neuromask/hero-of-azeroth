/**
 * A production build under load, with the running process's own memory in view.
 *
 * `leaderboard.bench.ts` measures the reads from inside the test runner; this measures the site as it is actually
 * served - the built Nitro entry, imported into this process, so `process.memoryUsage()` is the app's own and not
 * a runner's. It is a `.mjs` rather than a `.bench.ts` on purpose: it starts a real server and needs a build, so
 * no test runner should ever pick it up. Run it by hand:
 *
 *   npm run build
 *   node test/bench/productionLoad.mjs <data-dir> prepare   # creates the schema and fills it (2 million readings)
 *   node test/bench/productionLoad.mjs <data-dir> load      # serves it, drives the load, reports what it cost
 *   node test/bench/productionLoad.mjs <data-dir> reset      # empties the table so the next start rebuilds it
 *
 * `<data-dir>` is a directory of its own - a throwaway one, because it ends up a few hundred megabytes.
 *
 * The population is deliberately bigger than the benchmark's: two hundred thousand guests with ten readings
 * each, which is two million rows of history rather than one per member.
 */
import { DatabaseSync } from 'node:sqlite'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const dir = process.argv[2]
const mode = process.argv[3] ?? 'load'
const PORT = Number(process.env.HOA_PORT || 3211)

if (!dir) throw new Error('a data directory is required')

process.env.NUXT_DATA_DIR = dir
process.env.NITRO_PORT = String(PORT)

/** How many members, how many readings each, and how many accounts. */
const GUESTS = 200_000
const READINGS_PER_GUEST = 10
const ACCOUNTS = 2_000
const ALTS = 2

const REALMS = ['gordunni', 'eversong', 'howling-fjord', 'draenor', 'silvermoon']
const FACTIONS = ['alliance', 'horde']

const file = join(dir, 'hoa.db')

/** The app, imported the way a host imports it: this is the process every number below is about. */
const entry = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url))
const bootAt = performance.now()
await import(pathToFileURL(entry).href)

const base = `http://127.0.0.1:${PORT}`

/** Waits until the site answers, which is what the numbers below are measured from. */
async function ready() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      await fetch(`${base}/api/leaderboard/presence`)
      return true
    } catch {
      await sleep(250)
    }
  }
  return false
}

/** A whole number that looks like a real figure, so the aggregates are of a real size. */
function figure(seed, ceiling) {
  return (seed * 2_654_435_761) % ceiling
}

/** The value at a percentile of a set of samples, in milliseconds. */
function percentile(samples, fraction) {
  const sorted = [...samples].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] * 10) / 10
}

/** Every table's row count, and every file's size, as the database actually holds them. */
function inventory(db) {
  const counts = {}
  for (const table of ['users', 'characters', 'snapshots', 'account_snapshots', 'leaderboard', 'account_pool']) {
    try {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
    } catch {
      counts[table] = null
    }
  }

  const files = {}
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      files[`hoa.db${suffix}`] = statSync(`${file}${suffix}`).size
    } catch {
      files[`hoa.db${suffix}`] = null
    }
  }

  return { counts, files }
}


// --- reset: empty the table and clear its stamp, so the next start builds it again --------------------------
if (mode === 'reset') {
  const db = new DatabaseSync(file)
  db.exec('DELETE FROM leaderboard')
  db.exec('PRAGMA user_version = 0')
  db.exec('PRAGMA application_id = 0')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  console.log('the table was emptied and unstamped; rows:', db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get().n)
  db.close()
  process.exit(0)
}

// --- prepare: fill the database the app has just created the schema of ---------------------------------------
if (mode === 'prepare') {
  await ready()

  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')

  const character = db.prepare(
    `INSERT INTO characters (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id,
                             level, ilvl, faction, is_main, first_seen_at, last_seen_at)
     VALUES (?, 'eu', ?, ?, ?, ?, ?, ?, 90, ?, ?, ?, 1000000, 1000000)`
  )
  const reading = db.prepare(
    `INSERT INTO snapshots (character_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor,
                            reputations, honorable_kills, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const accountReading = db.prepare(
    `INSERT INTO account_snapshots (user_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor,
                                    reputations, honorable_kills, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const user = db.prepare(
    'INSERT INTO users (id, bnet_sub, created_at, last_login_at, hide_from_fame) VALUES (?, ?, 1000000, 1000000, ?)'
  )

  const started = Date.now()
  db.exec('BEGIN')

  for (let index = 0; index < GUESTS; index += 1) {
    const realm = REALMS[index % REALMS.length]
    const name = `guest${index}`

    const id = Number(
      character.run(null, realm, realm, name, name, name, (index % 13) + 1, figure(index, 700), FACTIONS[index % 2], 0)
        .lastInsertRowid
    )

    // Ten readings a member, which is what makes this a history rather than one row each: the moments walk back
    // from a fixed day, so the newest one is the figure the table draws and the rest are a real curve. The figures
    // are deliberately awkward where the reads have to be careful - every eleventh member holds the same mounts
    // (real ties for the orders to settle), one figure is never read at all (`null`), and only the newest point
    // carries a rating, so the historical scores are of more than one age.
    for (let point = 0; point < READINGS_PER_GUEST; point += 1) {
      const seed = index * READINGS_PER_GUEST + point
      reading.run(
        id,
        1_000_000 - point * 86_400,
        figure(seed + 1, 3_500),
        figure(seed + 2, 60_000),
        index % 11 === 0 ? 500 : figure(seed + 3, 1_300),
        figure(seed + 4, 2_000),
        point === 9 ? null : figure(seed + 5, 1_100),
        figure(seed + 6, 2_000),
        figure(seed + 7, 210),
        figure(seed + 8, 400_000),
        point === 0 ? figure(seed + 9, 120_000) : null
      )
    }
  }

  for (let index = 0; index < ACCOUNTS; index += 1) {
    const userId = index + 1
    const realm = REALMS[index % REALMS.length]
    // One account in fifty has asked to be left out of the table, which is a member the population does not hold.
    user.run(userId, `sub-${userId}`, index % 50 === 0 ? 1 : 0)

    for (let alt = 0; alt <= ALTS; alt += 1) {
      const name = `account${index}alt${alt}`
      const id = Number(
        character.run(userId, realm, realm, name, name, name, (index % 13) + 1, figure(index, 700), FACTIONS[index % 2], alt === 0 ? 1 : 0)
          .lastInsertRowid
      )

      for (let point = 0; point < READINGS_PER_GUEST; point += 1) {
        const seed = index * READINGS_PER_GUEST + point
        reading.run(
          id,
          1_000_000 - point * 86_400,
          figure(seed + 1, 3_500),
          figure(seed + 2, 60_000),
          index % 11 === 0 ? 500 : figure(seed + 3, 1_300),
          figure(seed + 4, 2_000),
          point === 9 ? null : figure(seed + 5, 1_100),
          figure(seed + 6, 2_000),
          figure(seed + 7, 210),
          figure(seed + 8, 400_000),
          point === 0 ? figure(seed + 9, 120_000) : null
        )
      }
    }

    accountReading.run(
      userId,
      1_000_000,
      figure(index + 1, 3_500),
      figure(index + 2, 60_000),
      index % 11 === 0 ? 500 : figure(index + 3, 1_300),
      figure(index + 4, 2_000),
      figure(index + 5, 1_100),
      figure(index + 6, 2_000),
      figure(index + 7, 210),
      figure(index + 8, 400_000),
      figure(index + 9, 120_000)
    )
  }

  db.exec('COMMIT')

  // The table the site serves is emptied and unstamped, so the app's own startup pass builds it from these very
  // rows and the build is measured rather than assumed (`ensurePopulation` in ./server/utils/leaderboardRows).
  db.exec('DELETE FROM leaderboard')
  db.exec('PRAGMA user_version = 0')
  db.exec('PRAGMA application_id = 0')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

  console.log(JSON.stringify({ preparedInMs: Date.now() - started, ...inventory(db) }, null, 2))
  db.close()
  process.exit(0)
}

// --- load: serve it, drive it, and watch this process while it happens ----------------------------------------
const db = new DatabaseSync(file)
const startInventory = inventory(db)

// The startup pass builds the table asynchronously (`server/plugins/statisticsMigration`), so the site can answer
// before it is built: waited for here, and measured from the moment the entry was imported - which is what a
// cold start costs.
const listenMs = Math.round(performance.now() - bootAt)
let tableBuiltMs = listenMs
for (let attempt = 0; attempt < 1_200; attempt += 1) {
  const stamp = db.prepare('PRAGMA application_id').get().application_id
  const rows = db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get().n
  if (stamp !== 0 && rows > 0) break
  await sleep(250)
  tableBuiltMs = Math.round(performance.now() - bootAt)
}

const population = db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get().n

// The process's own memory and the event loop's worst pause, sampled while the load runs.
const samples = []
const sampler = setInterval(() => {
  const usage = process.memoryUsage()
  samples.push({ rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external })
}, 200)

let worstPause = 0
let lastTick = performance.now()
const ticker = setInterval(() => {
  const now = performance.now()
  worstPause = Math.max(worstPause, now - lastTick - 50)
  lastTick = now
}, 50)

const get = (path, options) => fetch(`${base}${path}`, options)
const timings = {}

/** One read, run a few times, reported as the median - and refused if it did not answer. */
async function time(name, runs, call) {
  const taken = []
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    const answer = await call()
    taken.push(performance.now() - started)
    if (!answer.ok) throw new Error(`${name} answered ${answer.status}`)
  }

  taken.sort((a, b) => a - b)
  timings[name] = Math.round(taken[Math.floor(taken.length / 2)] * 10) / 10
}

await time('ssr: front door', 3, () => get('/'))
await time('ssr: front door (ru)', 3, () => get('/ru'))
await time('ssr: about', 2, () => get('/about'))
await time('ssr: privacy', 2, () => get('/privacy'))
await time('ssr: sitemap', 2, () => get('/sitemap.xml'))
// A character's own page and its card read Blizzard for the profile, which is not available offline; what the
// site serves from its own database is exercised here instead - the history and the place of a character.
await time('api: history of one character', 5, () => get('/api/history/eu/gordunni/guest150000?metric=mounts'))
await time('api: leaderboard, total', 5, () => get('/api/leaderboard?sort=total&perPage=25'))
await time('api: leaderboard, mounts', 5, () => get('/api/leaderboard?sort=mounts&perPage=25'))
await time('api: leaderboard, decor', 5, () => get('/api/leaderboard?sort=decor&perPage=25'))
await time('api: leaderboard, mplus', 5, () => get('/api/leaderboard?sort=mplus&perPage=25'))
await time('api: leaderboard, achievements', 5, () => get('/api/leaderboard?sort=achievements&perPage=25'))
await time('api: leaderboard, deep page', 5, () => get('/api/leaderboard?sort=mounts&page=5000&perPage=25'))
await time('api: leaderboard, search', 5, () => get('/api/leaderboard?q=guest199'))
await time('api: widgets + place', 5, () => get('/api/leaderboard/eu/gordunni/guest150000'))
await time('api: presence', 5, () => get('/api/leaderboard/presence'))

// The distribution twice: the first read of a metric walks the population, every read after it is the memo.
const cold = performance.now()
await get('/api/distribution?metric=pets&players=eu:gordunni:guest150000')
timings['api: distribution (cold)'] = Math.round((performance.now() - cold) * 10) / 10
await time('api: distribution (memoised)', 5, () => get('/api/distribution?metric=pets&players=eu:gordunni:guest150000'))
await time('api: distribution (another metric)', 3, () => get('/api/distribution?metric=decor&players=eu:gordunni:guest150000'))

// Twenty readers at once, which the synchronous driver serves one after another.
const burst = performance.now()
await Promise.all(Array.from({ length: 20 }, () => get('/api/leaderboard?sort=toys&perPage=25')))
timings['20 readers at once'] = Math.round(performance.now() - burst)


// A write beside the reads. The site's own snapshot write needs Blizzard (a profile read), which is not available
// offline, so the row goes in through a second connection to the same file - which the app's own connection sees -
// and the reads beside it are the site's own. The app's write path itself is measured where it can be imported
// (`test/bench/leaderboard.bench.ts`, "a reading filed beside it").
const writer = db.prepare(
  `INSERT INTO snapshots (character_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor,
                          reputations, honorable_kills)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
const target = db
  .prepare(
    `SELECT c.id AS id, s.mounts AS mounts FROM characters c
       JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1)
      WHERE c.name_key = 'guest150000'`
  )
  .get()

// A moment no earlier run of this has written, so a repeated load test cannot collide with itself on the
// reading's own unique key (`snapshots(character_id, taken_at)`).
const writeBase = 1_700_000_000 + Math.floor(Math.random() * 1_000_000)

const mixed = performance.now()
for (let run = 0; run < 10; run += 1) {
  writer.run(target.id, writeBase + run, 0, 1000, target.mounts + run + 1, 40, 30, 20, 5, 0)
  await get('/api/leaderboard?sort=total&perPage=25')
  await get('/api/leaderboard/eu/gordunni/guest150000')
}
timings['mixed load (write + 2 reads)'] = Math.round((performance.now() - mixed) / 10) / 10

// And a longer stretch of the same, to see whether anything grows with it. Every round asks a *different*
// question, so nothing is answered from the endpoint's own cache and the read itself is what the memory is
// watched through; the write is a reading filed beside them.
const rssAfterWarmup = process.memoryUsage().rss
for (let round = 0; round < 400; round += 1) {
  await get(`/api/leaderboard?q=guest${round}&perPage=25`)
  await get('/api/leaderboard/eu/gordunni/guest150000')
  await get('/api/distribution?metric=mounts&players=eu:gordunni:guest150000')
  writer.run(target.id, writeBase + 1000 + round, 0, 1000, target.mounts + 100 + round, 40, 30, 20, 5, 0)
}

// The sampler and the ticker are still running: the sections below are where the event loop's worst pause is
// most interesting, because a cold distribution walks the whole population in one statement.

// --- the write-ahead log over a long run ---------------------------------------------------------------------
//
// Every write lands in the log first, and SQLite only moves those frames back into the database file at a
// checkpoint - which a reader holding a snapshot can hold off. So a log's size under load is worth watching, and
// what matters is whether it *grows* rather than how big it is: SQLite reuses a log's frames rather than extending
// the file once it has reached the size of the largest burst of writes.
const sizeOf = (path) => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

const wal = { samples: [], checkpoints: [], start: sizeOf(`${file}-wal`) }
const walFile = `${file}-wal`

for (let round = 0; round < 60; round += 1) {
  await get(`/api/leaderboard?q=guest${round + 1000}&perPage=25`)
  writer.run(target.id, writeBase + 10_000 + round, 0, 1000, target.mounts + 900 + round, 40, 30, 20, 5, 0)
  wal.samples.push(sizeOf(walFile))

  if (round % 20 === 0) wal.checkpoints.push(db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get())
}

// Asked while the load is going on and while it is not, because the answer to a passive checkpoint depends on
// whether a reader is holding a snapshot it would have to move past.
const passiveDuringLoad = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get()
const truncateDuringLoad = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()

const walReport = {
  startBytes: wal.start,
  samples: { first: wal.samples[0], last: wal.samples[wal.samples.length - 1], min: Math.min(...wal.samples), max: Math.max(...wal.samples) },
  passiveCheckpoints: wal.checkpoints,
  passiveDuringLoad,
  truncateDuringLoad,
  autocheckpoint: db.prepare('PRAGMA wal_autocheckpoint').get(),
  bytesAfterTruncate: sizeOf(walFile),
  databaseBytes: sizeOf(file),
  shmBytes: sizeOf(`${file}-shm`)
}

// --- cold distributions ---------------------------------------------------------------------------------------
//
// One pass over the whole population per metric per revision, and the answer is memoised per *question* - so a
// reader opening a chart nobody has opened since the last write pays for a pass, and the next reader of the same
// chart pays nothing. The samples below are cold because each asks a different question: a different metric, or
// the same metric for a different character.
const METRICS = [
  'score', 'mPlusScore', 'achievements', 'mounts', 'pets', 'toys', 'decor',
  'reputations', 'titles', 'quests', 'recipes', 'transmogs', 'honorableKills', 'honorLevel'
]

const coldSamples = []
for (let run = 0; run < 28; run += 1) {
  const metric = METRICS[run % METRICS.length]
  const started = performance.now()
  const answer = await get(`/api/distribution?metric=${metric}&players=eu:gordunni:guest${1000 + run}`)
  if (!answer.ok) throw new Error(`a distribution answered ${answer.status}`)
  coldSamples.push(performance.now() - started)
}

// The same question again: this is the memo, which is the whole point of it.
const sameQuestion = []
for (let run = 0; run < 5; run += 1) {
  const started = performance.now()
  await get('/api/distribution?metric=mounts&players=eu:gordunni:guest150000')
  sameQuestion.push(performance.now() - started)
}

// A reading filed between two identical questions. The site's own write moves the revision and the memo goes with
// it; a row written through a second connection does not move it, which is a limit of measuring offline rather
// than of the memo (`./statisticsPopulation`, and `leaderboardCacheStamp.test.ts` for the site's own writes).
writer.run(target.id, writeBase + 20_000, 0, 1000, target.mounts + 5000, 40, 30, 20, 5, 0)
const afterWrite = []
for (let run = 0; run < 3; run += 1) {
  const started = performance.now()
  await get('/api/distribution?metric=mounts&players=eu:gordunni:guest150000')
  afterWrite.push(performance.now() - started)
}

// Several charts at once, none of them memoised: eight metrics, each asking about a character nobody has asked
// about, which is eight passes over the population in one burst while the SSR pages beside them are served.
const charts = performance.now()
await Promise.all([
  ...METRICS.slice(0, 8).map((metric) =>
    get(`/api/distribution?metric=${metric}&players=eu:gordunni:guest${2000 + Math.floor(Math.random() * 100_000)}`)
  ),
  get('/'),
  get('/ru')
])
const chartsMs = Math.round(performance.now() - charts)

const distributionReport = {
  coldCount: coldSamples.length,
  coldP50: percentile(coldSamples, 0.5),
  coldP95: percentile(coldSamples, 0.95),
  coldP99: percentile(coldSamples, 0.99),
  coldMax: Math.round(Math.max(...coldSamples) * 10) / 10,
  memoCount: sameQuestion.length,
  memoisedP50: percentile(sameQuestion, 0.5),
  afterWriteP50: percentile(afterWrite, 0.5),
  eightChartsPlusTwoPagesMs: chartsMs,
  memoLimit: 64
}

// Only now, with everything measured, is the watching stopped.
clearInterval(sampler)
clearInterval(ticker)

const peak = (pick) => Math.round((Math.max(...samples.map(pick)) / 1048576) * 10) / 10

console.log(
  JSON.stringify(
    {
      population,
      coldStart: { listenedAfterMs: listenMs, tableBuiltAfterMs: tableBuiltMs },
      start: startInventory,
      end: inventory(db),
      memoryMiB: {
        peakRss: peak((sample) => sample.rss),
        peakHeapUsed: peak((sample) => sample.heapUsed),
        peakExternal: peak((sample) => sample.external),
        rssAfterWarmup: Math.round((rssAfterWarmup / 1048576) * 10) / 10,
        rssAfterLongStretch: Math.round((process.memoryUsage().rss / 1048576) * 10) / 10,
        limitMiB: 400
      },
      worstEventLoopPauseMs: Math.round(worstPause),
      writeAheadLog: walReport,
      distributions: distributionReport,
      timings
    },
    null,
    2
  )
)

db.close()
process.exit(0)

