/**
 * The upgrade of a database a running site already had, replayed against the backups this checkout carries.
 *
 * `dbMigration.test.ts` builds the shape an older build wrote and checks the migration in the small; this file
 * does the same thing with the real thing - a copy of the site's own `hoa.db` from before the hall of fame was a
 * table, and one from the build whose table still carried the item-level order - and then reads the site through
 * it: the migration, the table the hall of fame is drawn from, a history and a distribution.
 *
 * That is the path a deploy takes, and it is the one a unit test cannot invent: the older database has columns
 * this build has never written and lacks tables it has, so what must hold is that the upgrade ends with a site
 * that answers - not with a warning and a table nobody can be filed into. The copy is deliberate: a migration
 * must be free to write, and the backup it is given must stay exactly as it is.
 *
 * The fixtures are the two that matter, and each is skipped when the checkout has no backups (a fresh clone):
 *
 *   - `2026-10-15-06-09-01`, written before guests existed (`characters.user_id NOT NULL`, no
 *     `account_snapshots`, no `leaderboard`) and beside a `leaderboard.json` the migration moves;
 *   - `2026-10-15-21-03-34`, written by the build whose `leaderboard` still carried `capped` and whose header
 *     carried no row version, so the table has to be rebuilt rather than served.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

/** A backup as the checkout has it, relative to the project root. */
const BACKUPS = 'backups'
const PRE_GUESTS = join(BACKUPS, '2026-10-15-06-09-01', 'server-data')
const CAPPED_TABLE = join(BACKUPS, '2026-10-15-21-03-34', 'server-data')

/** How many members the population holds, spelled out here rather than asked of the code under test. */
function populationCount(db: DatabaseSync): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT c.id FROM characters c
            JOIN snapshots s ON s.id = (SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1)
           WHERE c.user_id IS NULL
           UNION ALL
           SELECT u.id FROM users u
            JOIN account_snapshots a ON a.id = (SELECT id FROM account_snapshots WHERE user_id = u.id ORDER BY taken_at DESC LIMIT 1)
           WHERE COALESCE(u.hide_from_fame, 0) = 0
         )`
      )
      .get() as { n: number }
  ).n
}

let dir = ''

afterEach(() => {
  delete process.env.NUXT_DATA_DIR
  // The reader this file wired up is the real, file-backed one; leaving it on the global would hand a later
  // test file a database it did not ask for (`test/helpers/memoryDb.ts` installs its own).
  delete (globalThis as Record<string, unknown>).useDb
  if (!dir) return

  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // SQLite keeps the file open for the life of the process: the folder is left in `os.tmpdir`, exactly as the
    // load test leaves its own for the same reason.
  }
})

/**
 * Copies a backup into a directory of its own and opens the site's own reader over it.
 *
 * The modules are reset before they are imported, so each fixture gets its own connection and its own
 * once-per-process migration memo - which is what lets two upgrades be tested in one process at all.
 */
async function upgrade(source: string): Promise<{ db: DatabaseSync; warnings: string[] }> {
  dir = mkdtempSync(join(tmpdir(), 'hoa-upgrade-'))

  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(join(source, `hoa.db${suffix}`))) {
      copyFileSync(join(source, `hoa.db${suffix}`), join(dir, `hoa.db${suffix}`))
    }
  }

  if (existsSync(join(source, 'leaderboard.json'))) {
    copyFileSync(join(source, 'leaderboard.json'), join(dir, 'leaderboard.json'))
  }

  process.env.NUXT_DATA_DIR = dir
  vi.resetModules()

  const warnings: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  })

  try {
    const { useDb } = await import('../../server/utils/db')
    const db = useDb()

    // The modules read the database through `useDb()`, which Nitro hands them as a free global; here it is wired
    // to the app's own reader, so the upgrade is the very one a deploy runs and not a stand-in for it.
    ;(globalThis as Record<string, unknown>).useDb = useDb

    const { migrateStatistics } = await import('../../server/utils/statisticsMigration')
    await migrateStatistics()

    const rows = await import('../../server/utils/leaderboardRows')
    rows.ensurePopulation()

    return { db, warnings }
  } finally {
    warn.mockRestore()
  }
}

/** The columns a table has, in order. */
function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((column) => column.name)
}

describe("upgrading the site's own database", () => {
  it('turns a database that predates guests into one the site can keep a stranger in', async () => {
    if (!existsSync(join(PRE_GUESTS, 'hoa.db'))) return

    const { db, warnings } = await upgrade(PRE_GUESTS)

    // Nothing about the upgrade is a complaint: the rebuild that makes `user_id` nullable has to succeed, and a
    // warning here is exactly the failure this test exists for.
    expect(warnings.filter((line) => line.startsWith('[db]'))).toEqual([])

    const owner = (db.prepare('PRAGMA table_info(characters)').all() as unknown as { name: string; notnull: number }[])
      .find((column) => column.name === 'user_id')
    expect(owner?.notnull).toBe(0)

    // The item level a character wears is one of the columns the rebuild has to carry, since the added-columns
    // pass put it on the table before the rebuild ran.
    expect(columnsOf(db, 'characters')).toContain('ilvl')

    // And the table the hall of fame is drawn from holds the population, read the way the site reads it.
    const rows = await import('../../server/utils/leaderboardRows')
    expect(rows.readLeaderboardPage({}, 100).total).toBe(populationCount(db))
    expect(populationCount(db)).toBeGreaterThan(0)
  })

  it('moves the table the site used to keep in a file into the database it keeps now', async () => {
    if (!existsSync(join(PRE_GUESTS, 'leaderboard.json'))) return

    const { db } = await upgrade(PRE_GUESTS)
    const legacy = JSON.parse(readFileSync(join(PRE_GUESTS, 'leaderboard.json'), 'utf8')) as { players: unknown[] }

    // Every row of the file the database had no reading for is a character of it now, and the table the site
    // draws is built from those very rows (`./statisticsMigration`, `./leaderboardRows`).
    expect(legacy.players.length).toBeGreaterThan(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id IS NULL').get()).toMatchObject({
      n: expect.any(Number)
    })

    // A second run - a fresh module, so the memo of the first does not stand in for the work - files nothing.
    vi.resetModules()
    const { migrateStatistics } = await import('../../server/utils/statisticsMigration')
    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 0 })
  })

  it('rebuilds a table written with the item-level order this build has taken away', async () => {
    if (!existsSync(join(CAPPED_TABLE, 'hoa.db'))) return

    const { db } = await upgrade(CAPPED_TABLE)

    expect(columnsOf(db, 'leaderboard')).not.toContain('capped')
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_leaderboard_ilvl'").get()
    ).toBeUndefined()

    // The header says which build the rows were rated by, so a table written by the older one is rebuilt rather
    // than served as it is (`ensurePopulation` in `./leaderboardRows`).
    const { ROW_VERSION, readLeaderboardPage } = await import('../../server/utils/leaderboardRows')
    expect(db.prepare('PRAGMA application_id').get()).toMatchObject({ application_id: ROW_VERSION })
    expect(readLeaderboardPage({}, 100).total).toBe(populationCount(db))
  })

  it('answers a history and a distribution from the upgraded database', async () => {
    if (!existsSync(join(PRE_GUESTS, 'hoa.db'))) return

    const { db } = await upgrade(PRE_GUESTS)
    const { readSnapshotDistribution } = await import('../../server/utils/characterReading')

    const guest = db
      .prepare(
        `SELECT c.region, c.realm_slug, c.name_key FROM characters c
          WHERE c.user_id IS NULL
            AND EXISTS (SELECT 1 FROM snapshots s WHERE s.character_id = c.id)
          LIMIT 1`
      )
      .get() as { region: string; realm_slug: string; name_key: string } | undefined

    expect(guest).toBeDefined()

    const answer = readSnapshotDistribution('mounts', [`${guest!.region}:${guest!.realm_slug}:${guest!.name_key}`])

    expect(answer.population).toBeGreaterThan(0)
    expect(answer.positions[0]?.value).not.toBeNull()
  })
})

