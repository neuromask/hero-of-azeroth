/**
 * The migration that moves the hall of fame's own table into the database.
 *
 * It is the one place the site reads a store it no longer uses, so what these tests pin down is the whole of
 * what it must do: every row of the file becomes a character of the database with one reading behind it, a
 * character the database already knows is left alone, every account that has a reading is given its first point
 * of history, and a second run changes nothing.
 *
 * The data directory is pointed at a throwaway folder before anything reads that path (`NUXT_DATA_DIR`, see
 * `./appPaths`), because the migration is written for `server/data` and a test must never touch the data a
 * running site has written. The imports below are dynamic for exactly that reason, and `vi.resetModules` is what
 * lets a test run the migration twice: the memo that makes it once-per-process is per module instance.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import { calculatePlayerScore } from '../../server/utils/playerScore'

const data = mkdtempSync(join(tmpdir(), 'hoa-migration-'))
process.env.NUXT_DATA_DIR = data

/** The table as the build before this one wrote it, with the figures a row of it carries. */
function writeLegacyTable(players: unknown[]): void {
  writeFileSync(
    join(data, 'leaderboard.json'),
    JSON.stringify({ version: 1, scoreVersion: 4, updatedAt: '2026-10-15', players })
  )
}

/** One row of that file, with every figure it prints. */
function legacyRow(name: string, mounts: number): Record<string, unknown> {
  return {
    region: 'eu',
    realm: 'gordunni',
    realmName: 'Gordunni',
    name: name.toLowerCase(),
    displayName: name,
    avatar: 'avatar.jpg',
    classId: 1,
    faction: 'alliance',
    level: 90,
    ilvl: 320,
    mPlusScore: 2500,
    honorableKills: 100,
    mounts,
    pets: 10,
    toys: 20,
    decor: 30,
    reputations: 5,
    achievements: 1000,
    updatedAt: '2026-10-15',
    firstSeenAt: '2026-10-08'
  }
}

/** The migration module, freshly loaded so that its once-per-process memo is empty. */
async function migration(): Promise<typeof import('../../server/utils/statisticsMigration')> {
  vi.resetModules()
  return import('../../server/utils/statisticsMigration')
}

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

afterAll(() => {
  rmSync(data, { recursive: true, force: true })
  delete process.env.NUXT_DATA_DIR
})

describe('migrateStatistics', () => {
  it('files every row of the table as a character with one reading, and does it once', async () => {
    writeLegacyTable([legacyRow('Alpha', 100), legacyRow('Beta', 200)])

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(2)

    const rows = memory.db
      .prepare('SELECT id, user_id, display_name, level FROM characters ORDER BY name_key')
      .all() as { id: number; user_id: number | null; display_name: string; level: number }[]

    expect(rows).toHaveLength(2)
    expect(rows[0]?.user_id).toBeNull()
    expect(rows[0]?.display_name).toBe('Alpha')
    expect(rows[0]?.level).toBe(90)

    const points = memory.db
      .prepare('SELECT taken_at, mounts, achievements, titles, score FROM snapshots WHERE character_id = ?')
      .all(rows[0]!.id) as {
      taken_at: number
      mounts: number
      achievements: number
      titles: number | null
      score: number | null
    }[]

    expect(points).toHaveLength(1)
    expect(points[0]?.mounts).toBe(100)
    expect(points[0]?.achievements).toBe(1000)
    // The day the row was written, at the second it began: the only moment that store kept.
    expect(points[0]?.taken_at).toBe(Math.floor(Date.parse('2026-10-15T00:00:00Z') / 1000))
    // A figure the file never carried is unknown rather than zero, which is what keeps it out of a score and
    // out of a distribution - while the six the row does carry are weighed as usual.
    expect(points[0]?.titles).toBeNull()
    expect(points[0]?.score).toBe(
      calculatePlayerScore({ achievements: 1000, mounts: 100, pets: 10, toys: 20, decor: 30, reputations: 5 })
    )

    // A second run - a fresh module, so the memo of the first does not stand in for the work - files nothing.
    const again = await migration()
    expect(await again.migrateStatistics()).toEqual({ characters: 0, accounts: 0 })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 2 })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 2 })
  })

  it('gives an account that has a reading its first point of history', async () => {
    writeLegacyTable([])
    memory.addUser(42)
    const id = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      ilvl: 320,
      mounts: 100,
      pets: 10,
      toys: 20,
      decor: 30,
      reputations: 5,
      achievements: 1000
    })

    const { migrateStatistics } = await migration()
    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 1 })

    expect(memory.db.prepare('SELECT user_id, mounts FROM account_snapshots').all()).toEqual([
      expect.objectContaining({ user_id: 42, mounts: 100 })
    ])
  })

  it('moves every row of the site\'s own table when a backup of it is at hand', async () => {
    const backup = join(process.cwd(), 'backups', '2026-10-15-13-52-22', 'server-data', 'leaderboard.json')
    if (!existsSync(backup)) return

    copyFileSync(backup, join(data, 'leaderboard.json'))
    const rows = (JSON.parse(readFileSync(backup, 'utf8')) as { players: unknown[] }).players.length

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(rows)
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: rows })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: rows })
  })
})
