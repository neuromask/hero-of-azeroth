/**
 * A backup of the site's own data, taken the way a deploy takes one, put back the way a restore puts it back.
 *
 * `databaseCopy.test.ts` proves the mechanism on a table of its own; this runs the whole cycle against the
 * database the site actually keeps - the schema `server/utils/db` creates, with a guest, a visible account and its
 * alt, an account hidden from the table, readings with nulls, zeroes and repeats, and different historical
 * ratings - and then asks the site's own modules to read it back.
 *
 * The source directory is *deleted* before the copy is opened, so nothing here can pass by reading the original:
 * what is restored is one file, and the restored directory is opened as the app opens it.
 */
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyDatabase, DATABASE_NAME } from '../../scripts/lib/databaseCopy.mjs'
import { cleanup, remember, tempDir } from '../helpers/tempDirs'

let source = ''
let backup = ''

afterEach(() => {
  delete process.env.NUXT_DATA_DIR
  delete (globalThis as Record<string, unknown>).useDb

  // The connections first and the directories after, which is the whole reason this is one call
  // (`test/helpers/tempDirs.ts`): a database left open on Windows is a directory no test can remove.
  cleanup()

  source = ''
  backup = ''
})

/** The app's own reader, pointed at a directory - a fresh module, so it is a fresh connection. */
async function app(dir: string): Promise<DatabaseSync> {
  process.env.NUXT_DATA_DIR = dir
  vi.resetModules()

  const { useDb } = await import('../../server/utils/db')
  const db = remember(useDb())
  ;(globalThis as Record<string, unknown>).useDb = useDb

  return db
}

/**
 * Fills the site's own database the way the site fills it: two accounts (one of them hidden), a main and an alt
 * each, a guest nobody signed in for, readings spread over time with nulls, zeroes and repeats, and the account's
 * own totals.
 */
function populate(db: DatabaseSync): void {
  const now = 1_700_000_000

  db.prepare('INSERT INTO users (id, bnet_sub, created_at, last_login_at, hide_from_fame) VALUES (?, ?, ?, ?, ?)').run(
    1,
    'sub-visible',
    now,
    now,
    0
  )
  db.prepare('INSERT INTO users (id, bnet_sub, created_at, last_login_at, hide_from_fame) VALUES (?, ?, ?, ?, ?)').run(
    2,
    'sub-hidden',
    now,
    now,
    1
  )

  const character = db.prepare(
    `INSERT INTO characters (user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id,
                             level, ilvl, faction, is_main, first_seen_at, last_seen_at, stats_read_at)
     VALUES (?, 'eu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  character.run(1, 'gordunni', 'Gordunni', 'Mainchar', 'mainchar', 'Mainchar', 1, 90, 320, 'alliance', 1, now - 900, now, now)
  character.run(1, 'gordunni', 'Gordunni', 'Altchar', 'altchar', 'Altchar', 3, 80, 350, 'horde', 0, now - 800, now, now)
  character.run(2, 'eversong', 'Eversong', 'Hiddenmain', 'hiddenmain', 'Hiddenmain', 2, 90, 300, 'horde', 1, now - 700, now, now)
  character.run(null, 'silvermoon', 'Silvermoon', 'Guestchar', 'guestchar', 'Guestchar', 11, 90, 300, 'alliance', 0, now - 600, now, now)

  const reading = db.prepare(
    `INSERT INTO snapshots (character_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor,
                            reputations, titles, quests, recipes, transmogs, honorable_kills, honor_level, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const ids = db.prepare('SELECT id, name_key FROM characters').all()

  for (const row of ids) {
    for (let point = 0; point < 3; point += 1) {
      const at = now - point * 86_400
      reading.run(
        row.id,
        at,
        point === 0 ? 2500 : null,          // a rating that only the newest reading carries
        point * 1000,                        // achievements
        point === 0 ? 0 : 100 + point,       // a real zero, and repeats
        null,                                // pets: a figure nobody read
        point,                               // toys
        point,                               // decor
        point,                               // reputations
        point,                               // titles
        null,                                // quests
        null,                                // recipes
        null,                                // transmogs
        null,                                // honorable kills
        point * 7,                           // honor level
        point === 0 ? 11_050 : null          // the historical rating, only where one was computed
      )
    }
  }

  const accountReading = db.prepare(
    `INSERT INTO account_snapshots (user_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor,
                                    reputations, titles, quests, recipes, transmogs, honorable_kills, honor_level, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  accountReading.run(1, now, 2500, 2000, 102, 5, 2, 2, 2, 10, 10, 10, 10, 7, 0, 11_050)
  accountReading.run(2, now, 900, 1000, 50, 3, 1, 1, 1, 5, 5, 5, 5, 3, 0, 5_000)
}

/** Every table's row count, which is what a restore has to bring back unchanged. */
function counts(db: DatabaseSync): Record<string, number> {
  const tables = ['users', 'characters', 'snapshots', 'account_snapshots', 'leaderboard', 'saved_characters']
  const out: Record<string, number> = {}

  for (const table of tables) out[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  return out
}

/** Takes a copy of the source directory the way the deploy does, into `backups/<stamp>/server-data/`. */
function takeBackup(): { kept: string[]; skipped: string[] } {
  backup = tempDir('hoa-backup-')
  const folder = join(backup, '2026-10-16-03-00-00')
  const directory = join(folder, 'server-data')
  mkdirSync(directory, { recursive: true })

  const available = new Set(readdirSync(source))
  const kept = []
  const skipped = []

  // The database is the one thing copied as a pair (`copyDatabase`); everything else is a file like any other.
  const result = copyDatabase(directory, available, (name, destination, allowEmpty = false) => {
    const file = join(source, name)
    if (!existsSync(file)) return false

    copyFileSync(file, destination)
    return statSync(destination).size > 0 || allowEmpty
  })

  expect(result.ok).toBe(true)
  kept.push(DATABASE_NAME)

  for (const name of available) {
    if (name === DATABASE_NAME || name.startsWith(`${DATABASE_NAME}-`)) {
      if (name !== DATABASE_NAME) skipped.push(name)
      continue
    }

    copyFileSync(join(source, name), join(directory, name))
    kept.push(name)
  }

  writeFileSync(
    join(folder, 'backup.json'),
    `${JSON.stringify({ takenAt: new Date().toISOString(), from: 'test', files: kept, skipped }, null, 2)}\n`
  )

  return { kept, skipped }
}

/** Puts the copy back into a directory of its own, file by file, as a restore does. */
function restoreBackup(): string {
  const from = join(backup, '2026-10-16-03-00-00', 'server-data')
  const restored = tempDir('hoa-restored-')

  for (const name of readdirSync(from)) copyFileSync(join(from, name), join(restored, name))
  return restored
}

describe('a backup of the site\'s own data, restored', () => {
  it('brings back every row, sound, and answers the site\'s own reads from it', async () => {
    source = tempDir('hoa-source-')
    const live = await app(source)
    populate(live)

    // The table the hall of fame is drawn from, built the way a starting site builds it.
    const rows = await import('../../server/utils/leaderboardRows')
    rows.ensurePopulation()

    const before = counts(live)

    // A read of the live database, so the copy has something to be compared against rather than only counted.
    const livePage = rows.readLeaderboardPage({}, 25)
    const liveStanding = rows.readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'mainchar' })

    const { skipped } = takeBackup()

    // The pair is folded into one file: what is kept is not a database plus a log that has to be believed.
    expect(skipped).toEqual(expect.arrayContaining([`${DATABASE_NAME}-wal`, `${DATABASE_NAME}-shm`]))
    expect(existsSync(join(backup, '2026-10-16-03-00-00', 'server-data', `${DATABASE_NAME}-wal`))).toBe(false)

    // The source is closed and taken away before the copy is opened: a restore that needed the original would
    // fail here rather than pass for the wrong reason.
    live.close()
    rmSync(source, { recursive: true, force: true })
    source = ''

    const directory = restoreBackup()
    const db = await app(directory)

    // What the backup is worth is asked of the copy itself.
    expect(db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)).toEqual(['ok'])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    // Every row is back, in every table.
    expect(counts(db)).toEqual(before)
    expect(before.characters).toBe(4)
    expect(before.snapshots).toBe(12)
    expect(before.users).toBe(2)
    expect(before.account_snapshots).toBe(2)
    expect(before.leaderboard).toBe(2)

    // And a few particular rows, one of each kind: the guest, the main, the alt, and the account kept out.
    expect(db.prepare("SELECT user_id, display_name, level, ilvl, is_main FROM characters WHERE name_key = 'guestchar'").get())
      .toMatchObject({ user_id: null, display_name: 'Guestchar', level: 90, ilvl: 300, is_main: 0 })
    expect(db.prepare("SELECT user_id, is_main, ilvl FROM characters WHERE name_key = 'mainchar'").get()).toMatchObject({
      user_id: 1,
      is_main: 1,
      ilvl: 320
    })
    expect(db.prepare("SELECT user_id, is_main, ilvl FROM characters WHERE name_key = 'altchar'").get()).toMatchObject({
      user_id: 1,
      is_main: 0,
      ilvl: 350
    })

    // The history of one character came back point for point, nulls and all.
    const history = db
      .prepare(
        `SELECT s.taken_at, s.mounts, s.pets, s.score FROM snapshots s
           JOIN characters c ON c.id = s.character_id
          WHERE c.name_key = 'guestchar' ORDER BY s.taken_at DESC`
      )
      .all()

    expect(history).toHaveLength(3)
    expect(history[0]).toMatchObject({ mounts: 0, pets: null, score: 11_050 })
    expect(history[1]).toMatchObject({ mounts: 101, pets: null, score: null })

    // And the site's own reads answer from the restored directory - a page, a place, a history and a
    // distribution, which is the whole of what the data is kept for.
    const { readCharacterHistory, readSnapshotDistribution } = await import('../../server/utils/characterReading')

    const page = rows.readLeaderboardPage({}, 25)
    expect(page.players.map((player) => player.name).sort()).toEqual(['guestchar', 'mainchar'])
    expect(page).toEqual(livePage)

    expect(rows.readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'mainchar' })).toEqual(liveStanding)

    expect(readCharacterHistory('eu', 'silvermoon', 'guestchar', 'mounts')?.points).toEqual([
      { takenAt: 1_699_827_200, value: 102 },
      { takenAt: 1_699_913_600, value: 101 },
      { takenAt: 1_700_000_000, value: 0 }
    ])

    const distribution = readSnapshotDistribution('mounts', ['eu:gordunni:mainchar'])
    expect(distribution.population).toBe(2)
    expect(distribution.positions[0]).toMatchObject({ key: 'eu:gordunni:mainchar', value: 102 })
  })
})



/** A child process that begins a write and goes away in the middle of it, leaving the work uncommitted. */
const CRASH_WRITER = `
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(process.argv[2])

// A cache of one page, so the frames of the open transaction really do go to the log rather than sitting in the
// pager until a commit that never comes: without it this test would prove nothing, because nothing would be on
// disk to be mishandled.
db.exec('PRAGMA cache_size = 1')
db.exec('BEGIN')

const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)')
for (let i = 0; i < 500; i += 1) insert.run(1000 + i, 'uncommitted')
db.exec("UPDATE t SET v = 'changed' WHERE id = 1")

// No COMMIT and no ROLLBACK: the process is gone, which is what a host losing power looks like from the files.
process.exit(3)
`

describe('a database whose writer was killed in the middle of a write', () => {
  it('opens sound, keeps only what was committed, and copies into something a restore can use', () => {
    const dir = tempDir('hoa-crash-')
    source = dir

    const db = remember(new DatabaseSync(join(dir, DATABASE_NAME)))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.exec('BEGIN')
    for (let i = 1; i <= 10; i += 1) db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(i, 'old')
    db.exec('COMMIT')
    db.close()

    const script = join(dir, 'crash.mjs')
    writeFileSync(script, CRASH_WRITER)
    const child = spawnSync('node', [script, join(dir, DATABASE_NAME)], { encoding: 'utf8' })

    // The child really did go away in the middle of its transaction, and what it was writing is in the log.
    expect(child.status).toBe(3)
    expect(existsSync(join(dir, `${DATABASE_NAME}-wal`))).toBe(true)
    expect(statSync(join(dir, `${DATABASE_NAME}-wal`)).size).toBeGreaterThan(0)

    // A copy taken *now*, with the abandoned frames still in the log: this is the case that could poison a backup,
    // and the case the window `copyDatabase` takes exists for.
    const copy = tempDir('hoa-crash-copy-')
    const result = copyDatabase(
      copy,
      new Set(readdirSync(dir)),
      (name, destination, allowEmpty = false) => {
        const file = join(dir, name)
        if (!existsSync(file)) return false
        copyFileSync(file, destination)
        return statSync(destination).size > 0 || allowEmpty
      }
    )

    expect(result.ok).toBe(true)
    expect(result.folded).toEqual({ ok: true, reason: null })

    // The copy opens sound, holds what was committed, and holds nothing of the transaction nobody finished -
    // which is what SQLite itself answers about the original below.
    const restored = remember(new DatabaseSync(join(copy, DATABASE_NAME)))
    expect(restored.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)).toEqual(['ok'])
    expect(restored.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(10)
    expect(restored.prepare("SELECT COUNT(*) AS n FROM t WHERE v = 'old'").get().n).toBe(10)
    expect(restored.prepare("SELECT COUNT(*) AS n FROM t WHERE v = 'uncommitted'").get().n).toBe(0)

    // And the original is in the same state: an unfinished transaction costs the work in it and nothing else.
    const after = remember(new DatabaseSync(join(dir, DATABASE_NAME)))
    expect(after.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)).toEqual(['ok'])
    expect(after.prepare('SELECT COUNT(*) AS n FROM t').get().n).toBe(10)

    source = ''
  })
})
