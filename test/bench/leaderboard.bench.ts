/**
 * The load test of the hall of fame: two hundred thousand characters, and what every read of the table costs.
 *
 * This is a measurement rather than a test of behaviour, and it is deliberately not part of the suite
 * (`npm run test:bench`): it builds a population of two hundred thousand guests and two thousand accounts in a
 * database of its own, and then reads it the way the site does - a page of each order, a deep page, the filters,
 * a place in the table, the widgets, and the distribution a comparison board draws - reporting the time each one
 * takes, the plan SQLite chose, the size of the database and its write-ahead log, and how much resident memory
 * the process holds while all of it happens.
 *
 * Nothing here is asserted about speed: a threshold would be a claim about the machine it runs on rather than
 * about the code. What it does assert is that the reads answer correctly at that size - the page holds what it
 * asked for, the count is the population, a place is a place - because a query that is fast and wrong is not a
 * result.
 *
 * The database is built in a temporary data directory (`NUXT_DATA_DIR`, see `./appPaths`) so that nothing touches
 * the data a running site has written, and the whole folder is removed afterwards.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

/** How many guests, how many accounts, and how many characters an account holds. */
const GUESTS = 200_000
const ACCOUNTS = 2_000
const ALTS = 2

const data = mkdtempSync(join(tmpdir(), 'hoa-bench-'))
process.env.NUXT_DATA_DIR = data

const { useDb } = await import('../../server/utils/db')

// The modules read the database through `useDb()`, which Nitro hands them as a free global; here it is wired to
// the app's own reader, so the benchmark measures the very connection the site runs on - a file in the temporary
// data directory above, opened once and reused.
;(globalThis as Record<string, unknown>).useDb = useDb

const { readLeaderboardPage, readLeaderboardStanding, readGlobalStats, rebuildPopulation } = await import(
  '../../server/utils/leaderboardRows'
)
const { readSnapshotDistribution } = await import('../../server/utils/characterReading')

// The database is left where it is: SQLite keeps it open for the life of the process, and a folder a test cannot
// remove is a folder the next run of it does not care about (`os.tmpdir`).
afterAll(() => {
  try {
    rmSync(data, { recursive: true, force: true })
  } catch {
    // Windows holds the file open; the temporary folder is the operating system's to clean up.
  }
})

/** How much resident memory the process is holding, in mebibytes. */
function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10
}

/** How long one call takes, in milliseconds, as the median of a few runs. */
function time(runs: number, call: () => unknown): number {
  const samples: number[] = []

  for (let run = 0; run < runs; run += 1) {
    const started = performance.now()
    call()
    samples.push(performance.now() - started)
  }

  samples.sort((a, b) => a - b)
  return Math.round(samples[Math.floor(samples.length / 2)]! * 10) / 10
}

/** The realms the population is spread over, so that a filter has something to keep. */
const REALMS = ['gordunni', 'eversong', 'howling-fjord', 'draenor', 'silvermoon']
const FACTIONS = ['alliance', 'horde']

/** A whole number that looks like a real figure, so the rating and the aggregates are of a real size. */
function figure(seed: number, ceiling: number): number {
  return (seed * 2_654_435_761) % ceiling
}

/** Builds the population: one reading behind every character, and one account's totals behind every account. */
function build(): void {
  const db = useDb()

  const character = db.prepare(
    `INSERT INTO characters (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id,
                             level, faction, is_main, first_seen_at, last_seen_at)
     VALUES (?, 'eu', ?, ?, ?, ?, ?, ?, 90, ?, ?, 1000000, 1000000)`
  )

  const reading = db.prepare(
    `INSERT INTO snapshots (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor,
                            reputations, honorable_kills)
     VALUES (?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const accountReading = db.prepare(
    `INSERT INTO account_snapshots (user_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor,
                                    reputations, honorable_kills)
     VALUES (?, 1000000, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const user = db.prepare(
    'INSERT INTO users (id, bnet_sub, created_at, last_login_at) VALUES (?, ?, 1000000, 1000000)'
  )

  db.exec('BEGIN')

  for (let index = 0; index < GUESTS; index += 1) {
    const realm = REALMS[index % REALMS.length]!
    const name = `guest${index}`

    const id = Number(
      character.run(
        null,
        realm,
        realm,
        name,
        name,
        name,
        (index % 13) + 1,
        FACTIONS[index % 2],
        0
      ).lastInsertRowid
    )

    reading.run(
      id,
      figure(index, 700),
      figure(index + 1, 3_500),
      figure(index + 2, 60_000),
      figure(index + 3, 1_300),
      figure(index + 4, 2_000),
      figure(index + 5, 1_100),
      figure(index + 6, 2_000),
      figure(index + 7, 210),
      figure(index + 8, 400_000)
    )
  }

  for (let index = 0; index < ACCOUNTS; index += 1) {
    const userId = index + 1
    user.run(userId, `sub-${userId}`)

    const realm = REALMS[index % REALMS.length]!

    for (let alt = 0; alt <= ALTS; alt += 1) {
      const name = `account${index}alt${alt}`

      character.run(userId, realm, realm, name, name, name, (index % 13) + 1, FACTIONS[index % 2], alt === 0 ? 1 : 0)
    }

    accountReading.run(
      userId,
      figure(index, 700),
      figure(index + 1, 3_500),
      figure(index + 2, 60_000),
      figure(index + 3, 1_300),
      figure(index + 4, 2_000),
      figure(index + 5, 1_100),
      figure(index + 6, 2_000),
      figure(index + 7, 210),
      figure(index + 8, 400_000)
    )
  }

  db.exec('COMMIT')
}

describe('the hall of fame at two hundred thousand characters', () => {
  it('answers every read and reports what it costs', async () => {
    const built = performance.now()
    build()
    const buildMs = Math.round(performance.now() - built)

    // And the table the page is drawn from, materialised from what the load above wrote. This is the one-off cost of
    // the design - paid on a deploy, by the first read of a database that has never had the table, and whenever the
    // rating's weights change (`rebuildPopulation` in ./server/utils/leaderboardRows) - and everything measured below
    // is a read of the rows it wrote.
    const materialised = performance.now()
    rebuildPopulation()
    const materialisedMs = Math.round(performance.now() - materialised)

    const db = useDb()
    const dbFile = join(data, 'hoa.db')
    const population = GUESTS + ACCOUNTS

    // The build's own write-ahead log is folded back into the database first, so the sizes below are the ones a
    // site that is being *read* holds rather than the ones a bulk load leaves behind.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    // What SQLite does with a page of the table, which is the read a reader waits for: the plan says whether the
    // order is walked as an index - stopping after a page's worth of rows - or the population is sorted first. The
    // order below is the mounts preset, spelled the way the module spells it (`SORT_COLUMNS` in
    // ./server/utils/leaderboardRows), read at the deepest page the measurements below ask for.
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM leaderboard
          ORDER BY mounts DESC, score DESC, display_name COLLATE NOCASE ASC
          LIMIT 25 OFFSET 124975`
      )
      .all() as { detail: string }[]

    const measurements: Record<string, number> = {
      'page: total, first': time(5, () => readLeaderboardPage({}, 25)),
      'page: mounts, first': time(5, () => readLeaderboardPage({ sort: 'mounts' }, 25)),
      'page: mounts, deep (5000)': time(5, () => readLeaderboardPage({ sort: 'mounts', page: 5_000 }, 25)),
      'page: realm filter': time(5, () => readLeaderboardPage({ realm: 'gordunni' }, 25)),
      'page: name search': time(5, () => readLeaderboardPage({ q: 'guest199' }, 25)),
      'page: faction + class': time(5, () => readLeaderboardPage({ faction: 'horde', classId: 3 }, 25)),
      'standing: one place': time(3, () =>
        readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'guest150000' })
      ),
      'widgets: whole table': time(3, () => readGlobalStats())
    }

    // The distribution twice: the first call of a metric walks the population and cuts the bars, and every call
    // after it is answered from the memo until a reading moves the data (`./statisticsPopulation`). Both numbers
    // matter, and they are very different.
    const coldStart = performance.now()
    readSnapshotDistribution('pets', ['eu:gordunni:guest150000'])
    const coldMs = Math.round((performance.now() - coldStart) * 10) / 10

    measurements['distribution: cold'] = coldMs
    measurements['distribution: memoised'] = time(3, () =>
      readSnapshotDistribution('pets', ['eu:gordunni:guest150000'])
    )

    // Twenty readers asking for the same page at once. The driver is synchronous, so they are served one after
    // another - the number says what a burst costs, not what parallel hardware would.
    const burst = performance.now()
    await Promise.all(Array.from({ length: 20 }, async () => readLeaderboardPage({ sort: 'achievements' }, 25)))
    const burstMs = Math.round(performance.now() - burst)

    // What the reads answered, so that a fast query cannot be a wrong one.
    const first = readLeaderboardPage({ sort: 'mounts' }, 25)
    expect(first.total).toBe(population)
    expect(first.players).toHaveLength(25)
    expect(readLeaderboardPage({}, 25).total).toBe(population)
    expect(readLeaderboardPage({ realm: 'gordunni' }, 25).total).toBeGreaterThan(0)
    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'guest150000' })?.total).toBe(population)
    expect(readGlobalStats().players).toBe(population)

    const dbBytes = statSync(dbFile).size
    const walBytes = statSync(`${dbFile}-wal`).size

    console.log(
      [
        '',
        `population             ${population} (${GUESTS} guests, ${ACCOUNTS} accounts of ${ALTS + 1})`,
        `loaded in              ${buildMs} ms`,
        `table built in         ${materialisedMs} ms`,
        `database               ${(dbBytes / 1024 / 1024).toFixed(1)} MiB, WAL ${(walBytes / 1024 / 1024).toFixed(1)} MiB`,
        `resident memory        ${rssMb()} MiB (this process, the test runner included)`,
        '',
        ...Object.entries(measurements).map(([name, ms]) => `${name.padEnd(28)}${ms} ms`),
        `${'20 readers at once'.padEnd(28)}${burstMs} ms`,
        '',
        'plan of the deep page (page 5000 of the mounts order):',
        ...plan.map((row) => `  ${row.detail}`),
        ''
      ].join('\n')
    )
  })
})
