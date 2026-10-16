/**
 * Upgrading a database an older build wrote - the coverage that does not need anybody's backup.
 *
 * `upgradeFromBackup.test.ts` replays the upgrade against the site's own `hoa.db`, which is the strongest
 * evidence there is and the one thing a fresh clone cannot produce. This file is the same path with the shapes
 * built from `test/helpers/legacyDb.ts`: nothing of anybody's is in it, every run is a real `useDb()` against a
 * real file, and it never skips.
 *
 * What must hold is the whole of what a migration is for: every row and every reading still there, the columns
 * the new schema needs, the item level the readings held moved onto the characters that wore it, the foreign
 * keys still pointing at rows that exist, the indices back on, a guest writable, the materialised table built
 * from the very rows the upgrade left - and a second start changing nothing at all.
 */
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { cleanup, remember, tempDir } from '../helpers/tempDirs'
import {
  FIXTURE_ALT,
  FIXTURE_GUEST,
  FIXTURE_MAIN,
  writeLegacyDatabase,
  type LegacyShape
} from '../helpers/legacyDb'

let dir = ''

afterEach(() => {
  delete process.env.NUXT_DATA_DIR
  delete (globalThis as Record<string, unknown>).useDb

  // The connection the app opened first, the directory after: a database still open is a directory Windows will
  // not let go of, and a test that failed in the middle is the case this has to survive
  // (`test/helpers/tempDirs.ts`).
  cleanup()
  dir = ''
})

/** Opens one legacy shape with the site's own reader, migrates it, and builds the table. */
async function upgrade(shape: LegacyShape): Promise<{
  db: DatabaseSync
  moved: { characters: number; accounts: number; skipped: number; error: string | null }
  rows: typeof import('../../server/utils/leaderboardRows')
}> {
  dir = tempDir('hoa-legacy-')
  writeLegacyDatabase(dir, shape)

  process.env.NUXT_DATA_DIR = dir
  vi.resetModules()

  const { useDb } = await import('../../server/utils/db')
  const db = remember(useDb())
  ;(globalThis as Record<string, unknown>).useDb = useDb

  const { migrateStatistics } = await import('../../server/utils/statisticsMigration')
  const moved = await migrateStatistics()

  const rows = await import('../../server/utils/leaderboardRows')
  rows.ensurePopulation()

  return { db, moved, rows }
}

/** The columns a table has. */
function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((column) => column.name)
}

/** The names of the indices on a table. */
function indexesOf(db: DatabaseSync, table: string): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?").all(table) as unknown as {
      name: string
    }[]
  ).map((row) => row.name)
}

/** The one row the table draws for the fixture's account. */
function accountRow(db: DatabaseSync): Record<string, unknown> | undefined {
  return db
    .prepare('SELECT region, realm_slug, name_key, is_account, ilvl, mounts, level FROM leaderboard WHERE is_account = 1')
    .get() as Record<string, unknown> | undefined
}

describe('upgrading a database an older build wrote', () => {
  it('keeps every row, reading and index of a database that predates guests', async () => {
    const { db, moved } = await upgrade('pre-guests')

    // No legacy file is there, which is the normal answer - not a failure.
    expect(moved).toMatchObject({ characters: 0, skipped: 0, error: null })

    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toMatchObject({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 2 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 2 })

    // Every field of every row survived the rebuild that made `user_id` nullable.
    expect(
      db.prepare('SELECT name, display_name, level, faction, avatar FROM characters WHERE id = ?').get(FIXTURE_ALT.id)
    ).toMatchObject({
      name: FIXTURE_ALT.name,
      display_name: FIXTURE_ALT.name,
      level: 80,
      faction: 'horde',
      avatar: 'avatar-alt.jpg'
    })

    // The item level the readings held is moved onto the characters that wore it, and the readings lose it.
    expect(db.prepare('SELECT ilvl FROM characters WHERE id = ?').get(FIXTURE_MAIN.id)).toMatchObject({
      ilvl: FIXTURE_MAIN.ilvl
    })
    expect(db.prepare('SELECT ilvl FROM characters WHERE id = ?').get(FIXTURE_ALT.id)).toMatchObject({
      ilvl: FIXTURE_ALT.ilvl
    })
    expect(columnsOf(db, 'snapshots')).not.toContain('ilvl')

    // The columns the new schema needs, and the tables it added.
    expect(columnsOf(db, 'characters')).toEqual(expect.arrayContaining(['first_seen_at', 'stats_read_at', 'ilvl']))
    expect(columnsOf(db, 'snapshots')).toEqual(expect.arrayContaining(['score', 'titles', 'quests', 'recipes']))
    expect(columnsOf(db, 'account_snapshots')).toEqual(expect.arrayContaining(['user_id', 'taken_at', 'score']))
    expect(columnsOf(db, 'saved_characters')).toEqual(expect.arrayContaining(['user_id', 'region', 'realm_slug']))

    // The indices the reads are planned against.
    expect(indexesOf(db, 'characters')).toEqual(
      expect.arrayContaining(['idx_characters_user', 'idx_characters_key', 'idx_characters_guest'])
    )
    expect(indexesOf(db, 'snapshots')).toContain('idx_snapshots_character')

    // Nothing points at a row that is gone, and a reading still belongs to its character.
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(db.prepare('SELECT character_id FROM snapshots ORDER BY character_id').all()).toEqual([
      { character_id: FIXTURE_MAIN.id },
      { character_id: FIXTURE_ALT.id }
    ])

    // And a character nobody signed in for can be kept now, which is what the whole rebuild was for.
    db.prepare(
      `INSERT INTO characters (user_id, region, realm_slug, name, name_key, display_name, last_seen_at)
       VALUES (NULL, 'eu', 'gordunni', 'Stranger', 'stranger', 'Stranger', 1700000000)`
    ).run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id IS NULL').get()).toMatchObject({ n: 1 })

    // The account is given its first point of history, and the table draws it as the character it leads with -
    // its main, wearing the main's item level rather than the alt's.
    expect(moved.accounts).toBe(1)
    expect(accountRow(db)).toMatchObject({
      name_key: FIXTURE_MAIN.name.toLowerCase(),
      is_account: 1,
      ilvl: FIXTURE_MAIN.ilvl,
      mounts: FIXTURE_ALT.mounts
    })
  })

  it('counts a guest of a database that already supported them, one row each', async () => {
    const { db, rows } = await upgrade('guests-no-stats')

    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 3 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 3 })

    // The guest is a member in its own right and the account is one member, so the table holds two rows.
    const page = rows.readLeaderboardPage({}, 10)
    expect(page.total).toBe(2)
    expect(page.players.map((player) => player.name).sort()).toEqual([
      FIXTURE_GUEST.name.toLowerCase(),
      FIXTURE_MAIN.name.toLowerCase()
    ])
    expect(page.players.find((player) => player.name === FIXTURE_GUEST.name.toLowerCase())).toMatchObject({
      ilvl: FIXTURE_GUEST.ilvl,
      mounts: FIXTURE_GUEST.mounts
    })
  })

  it('rebuilds the table a build with the item-level order left, and takes its column away', async () => {
    const { db, rows } = await upgrade('capped-table')

    expect(columnsOf(db, 'leaderboard')).not.toContain('capped')
    expect(indexesOf(db, 'leaderboard')).not.toContain('idx_leaderboard_ilvl')
    expect(columnsOf(db, 'account_snapshots')).not.toContain('ilvl')

    // The header now says which build wrote the rows, so the next start does not rebuild them again.
    const { ROW_VERSION } = await import('../../server/utils/leaderboardRows')
    expect(db.prepare('PRAGMA application_id').get()).toMatchObject({ application_id: ROW_VERSION })

    // The old row was written the old way - under the alt's address, wearing the best gear on the roster - and
    // the rebuild replaces it with the row this build means: the main, wearing the main's own item level.
    expect(accountRow(db)).toMatchObject({
      name_key: FIXTURE_MAIN.name.toLowerCase(),
      ilvl: FIXTURE_MAIN.ilvl,
      mounts: FIXTURE_ALT.mounts
    })
    expect(rows.readLeaderboardPage({}, 10).total).toBe(2)
  })

  it('changes nothing on a second start, however many times it is run', async () => {
    const { db, moved } = await upgrade('guests-no-stats')
    expect(moved.accounts).toBe(1)

    const before = {
      characters: db.prepare('SELECT COUNT(*) AS n FROM characters').get(),
      snapshots: db.prepare('SELECT COUNT(*) AS n FROM snapshots').get(),
      accounts: db.prepare('SELECT COUNT(*) AS n FROM account_snapshots').get(),
      row: accountRow(db)
    }

    // A fresh module, so the memo of the first run does not stand in for the work - and the same database.
    vi.resetModules()
    const { migrateStatistics } = await import('../../server/utils/statisticsMigration')

    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })
    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })

    const rows = await import('../../server/utils/leaderboardRows')
    rows.ensurePopulation()

    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toEqual(before.characters)
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toEqual(before.snapshots)
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_snapshots').get()).toEqual(before.accounts)
    expect(accountRow(db)).toEqual(before.row)
  })

  it('writes the fixture it was given, so nothing here passes vacuously', () => {
    // A guard on the helper itself: a shape that failed to write would make every test above pass on an empty
    // database.
    dir = tempDir('hoa-legacy-guard-')
    const path = writeLegacyDatabase(dir, 'pre-guests')

    expect(existsSync(path)).toBe(true)
  })
})

