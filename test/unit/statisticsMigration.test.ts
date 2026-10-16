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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import { calculatePlayerScore, SCORE_VERSION } from '../../server/utils/playerScore'

const data = mkdtempSync(join(tmpdir(), 'hoa-migration-'))
process.env.NUXT_DATA_DIR = data

/** The one path the migration reads, which is the file these tests arrange. */
const LEGACY = join(data, 'leaderboard.json')

/**
 * One of the site's own backups, which is not in the repository (`.gitignore`): the test that moves it *skips*
 * when a clone has none, and says so. The shapes it proves are built from scratch by `legacyUpgrade.test.ts`,
 * which never skips.
 */
const BACKUP_FILE = join(process.cwd(), 'backups', '2026-10-15-13-52-22', 'server-data', 'leaderboard.json')

/** The table as the build before this one wrote it, with the figures a row of it carries. */
function writeLegacyTable(players: unknown[]): void {
  writeFileSync(
    LEGACY,
    JSON.stringify({ version: 1, scoreVersion: SCORE_VERSION, updatedAt: '2026-10-15', players })
  )
}

/** Puts the legacy path back to a plain missing file, whatever the previous test left there. */
function forgetLegacy(): void {
  rmSync(LEGACY, { recursive: true, force: true })
}

/**
 * Makes the legacy path a directory, which is how a read that is *not* "there is no file" is provoked on any
 * platform: a permission a test can set is a permission a test cannot set on Windows, but a directory where a
 * file should be is unreadable everywhere.
 */
function legacyAsDirectory(): void {
  forgetLegacy()
  mkdirSync(LEGACY)
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
  forgetLegacy()
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
    expect(await again.migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })
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
    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 1, skipped: 0, error: null })

    expect(memory.db.prepare('SELECT user_id, mounts FROM account_snapshots').all()).toEqual([
      expect.objectContaining({ user_id: 42, mounts: 100 })
    ])
  })

  it('moves every row of the site\'s own table when a backup of it is at hand', { skip: !existsSync(BACKUP_FILE) }, async () => {
    const backup = BACKUP_FILE
    copyFileSync(backup, LEGACY)
    const rows = (JSON.parse(readFileSync(backup, 'utf8')) as { players: unknown[] }).players.length

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(rows)
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: rows })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: rows })
  })
})

/**
 * What the migration does with the file itself, which is the half that used to be silent.
 *
 * A site that never had a table and a site whose table cannot be read look identical from inside the migration
 * unless something says which one it is: the first is nothing to move, the second is a table that must not be
 * thrown away. The two are told apart here, and every way of failing that is *not* "there is no file" is
 * reported rather than read as an empty source.
 */
describe('the file the old table was kept in', () => {
  it('reads a site that never had one as a table with no rows', async () => {
    forgetLegacy()

    const { migrateStatistics } = await migration()

    expect(await migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })
  })

  it('reads a file that was removed after the migration as the same thing', async () => {
    writeLegacyTable([legacyRow('Alpha', 100)])
    const first = await migration()
    expect((await first.migrateStatistics()).characters).toBe(1)

    // The file is deliberately left in place by a migration, but a host may remove it once it is done: that is
    // still a site with nothing to move, and not a failure.
    forgetLegacy()
    const again = await migration()

    expect(await again.migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
  })

  it('reports a file that is there and cannot be read, and leaves it exactly as it is', async () => {
    legacyAsDirectory()

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(0)
    expect(moved.error).toMatch(/could not be read/)
    // Nothing was deleted, moved or replaced: the path is still the directory it was.
    expect(statSync(LEGACY).isDirectory()).toBe(true)
  })

  it('reports a file that is not JSON, and leaves the text where it is', async () => {
    const text = '{ "players": ['
    writeFileSync(LEGACY, text)

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.error).toMatch(/not JSON/)
    expect(readFileSync(LEGACY, 'utf8')).toBe(text)
  })

  for (const text of ['[]', '"players"', 'null', '17']) {
    it(`reports ${text} as something that is not a table`, async () => {
      writeFileSync(LEGACY, text)

      const { migrateStatistics } = await migration()
      const moved = await migrateStatistics()

      expect(moved.error).toMatch(/not a table/)
    })
  }

  it('reports a table whose rows are not a list', async () => {
    writeFileSync(LEGACY, JSON.stringify({ version: 1, updatedAt: '2026-10-15', players: { a: 1 } }))

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.error).toMatch(/names no rows/)
  })

  it('counts a row it cannot place rather than passing for a complete import', async () => {
    // One row names no address at all, and one is not even an object: neither can become a character, and the
    // answer says so instead of counting two moved.
    writeLegacyTable([{ mounts: 10 }, 42, legacyRow('Alpha', 100)])

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(1)
    expect(moved.skipped).toBe(2)
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
  })

  it('still gives an account its first point when the file cannot be read', async () => {
    memory.addUser(42)
    const id = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mounts: 100,
      pets: 10,
      toys: 20,
      decor: 30,
      reputations: 5,
      achievements: 1000
    })

    legacyAsDirectory()

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    // The accounts' own history has nothing to do with the file, so it is still written - and the failure is
    // still reported.
    expect(moved.accounts).toBe(1)
    expect(moved.error).not.toBeNull()
  })
})


/** The one point filed for a character, as the database holds it. */
function pointOf(name: string): { taken_at: number; mounts: number | null; score: number | null } {
  const row = memory.db
    .prepare(
      `SELECT s.taken_at, s.mounts, s.score FROM snapshots s
        JOIN characters c ON c.id = s.character_id
       WHERE c.name_key = ?`
    )
    .get(name) as { taken_at: number; mounts: number | null; score: number | null } | undefined

  if (!row) throw new Error(`no reading was filed for ${name}`)
  return row
}

/**
 * The moment a row is filed at.
 *
 * A history point's moment is not decoration: `readCharacterReading` weighs a stored reading against a live
 * Blizzard answer by it, so a row stamped "now" would outrank a reading the site had just taken. The store wrote
 * a day and nothing finer, and the three shapes below are everything that can be in the field - including the
 * full moment that the old `dayStart` appended a midnight to, which made it unparseable and fell through to
 * "now".
 */
describe('the moment a row of the old table is filed at', () => {
  const DAY = '2026-10-15'
  const dayStart = Math.floor(Date.parse(`${DAY}T00:00:00Z`) / 1000)

  it('files a day on its own at the second that day began', async () => {
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: DAY }])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').taken_at).toBe(dayStart)
  })

  it('files a full moment with Z at that moment, and never at now', async () => {
    // A week old, so "the row was read just now" cannot be mistaken for the right answer by a test that runs
    // beside it.
    const at = '2026-10-08T13:52:22Z'
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: at }])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    const point = pointOf('alpha')
    expect(point.taken_at).toBe(Math.floor(Date.parse(at) / 1000))
    expect(Math.abs(point.taken_at - Math.floor(Date.now() / 1000))).toBeGreaterThan(86400)
  })

  it('files a moment with an offset at the instant it names', async () => {
    const at = '2026-10-08T13:52:22+03:00'
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: at }])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').taken_at).toBe(Math.floor(Date.parse(at) / 1000))
  })

  it('reads a moment with no zone as UTC', async () => {
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: '2026-10-08T13:52:22' }])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').taken_at).toBe(Math.floor(Date.parse('2026-10-08T13:52:22Z') / 1000))
  })

  it('falls back to the day the table itself was written when a row kept none', async () => {
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: undefined }])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').taken_at).toBe(dayStart)
  })

  it('falls back to the day the character was first seen when the row and the table kept none', async () => {
    writeFileSync(
      LEGACY,
      JSON.stringify({ version: 1, scoreVersion: SCORE_VERSION, players: [{ ...legacyRow('Alpha', 100), updatedAt: undefined, firstSeenAt: '2026-10-08' }] })
    )

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').taken_at).toBe(Math.floor(Date.parse('2026-10-08T00:00:00Z') / 1000))
  })

  it('reads a moment it cannot parse as no moment rather than as now', async () => {
    writeFileSync(
      LEGACY,
      JSON.stringify({ version: 1, scoreVersion: SCORE_VERSION, players: [{ ...legacyRow('Alpha', 100), updatedAt: 'the other day', firstSeenAt: '' }] })
    )

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(0)
    expect(moved.skipped).toBe(1)
    // The character is kept - its page still resolves - but no reading is filed under an invented moment.
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 0 })
  })

  it('files nothing twice when it is run again', async () => {
    writeLegacyTable([{ ...legacyRow('Alpha', 100), updatedAt: '2026-10-08T13:52:22Z' }])

    const first = await migration()
    expect((await first.migrateStatistics()).characters).toBe(1)

    const again = await migration()
    expect(await again.migrateStatistics()).toEqual({ characters: 0, accounts: 0, skipped: 0, error: null })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 1 })
    expect(pointOf('alpha').taken_at).toBe(Math.floor(Date.parse('2026-10-08T13:52:22Z') / 1000))
  })
})


/**
 * The rating of a point the file carried.
 *
 * A score is frozen at write time, so a point's rating can only be claimed when the formula that produced it is
 * the one this build has (`SCORE_VERSION`, `./playerScore`). The store wrote which version it used, and the
 * migration reads it: a file whose version matches keeps its rating - the figures are all there, and the formula
 * reproduces the very number the file recorded - while a file written by another formula leaves its points
 * without a rating rather than with a number the site never held.
 */
describe('the rating of a point the file carried', () => {
  /** The six figures `legacyRow` writes, which is what the rating is computed from. */
  const FIGURES = { achievements: 1000, mounts: 100, pets: 10, toys: 20, decor: 30, reputations: 5 }

  it('keeps the rating the file recorded when the file used the formula this build has', async () => {
    writeLegacyTable([legacyRow('Alpha', 100)])

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').score).toBe(calculatePlayerScore(FIGURES))
  })

  it('leaves the rating unknown when the file was written by another formula', async () => {
    writeFileSync(
      LEGACY,
      JSON.stringify({
        version: 1,
        scoreVersion: SCORE_VERSION - 1,
        updatedAt: '2026-10-15',
        players: [legacyRow('Alpha', 100)]
      })
    )

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    // The figures are kept exactly as the file held them; only the rating, which cannot be honestly reproduced,
    // is left unknown - which is what a point written before a weight changed looks like (`snapshots.score`).
    expect(pointOf('alpha').mounts).toBe(100)
    expect(pointOf('alpha').score).toBeNull()
  })

  it('leaves the rating unknown when the file does not say which formula wrote it', async () => {
    writeFileSync(
      LEGACY,
      JSON.stringify({ version: 1, updatedAt: '2026-10-15', players: [legacyRow('Alpha', 100)] })
    )

    const { migrateStatistics } = await migration()
    await migrateStatistics()

    expect(pointOf('alpha').score).toBeNull()
  })

  it('never writes over a reading the database already had', async () => {
    // The character is already on file, read in full, with figures of its own.
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Alpha' })
    memory.addSnapshot({
      characterId: id,
      takenAt: 500,
      mounts: 7,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1,
      score: 4242
    })

    writeLegacyTable([legacyRow('Alpha', 100)])

    const { migrateStatistics } = await migration()
    const moved = await migrateStatistics()

    expect(moved.characters).toBe(0)
    expect(moved.skipped).toBe(0)

    const rows = memory.db
      .prepare('SELECT taken_at, mounts, score FROM snapshots WHERE character_id = ?')
      .all(id) as { taken_at: number; mounts: number; score: number }[]

    expect(rows).toEqual([{ taken_at: 500, mounts: 7, score: 4242 }])
  })
})
