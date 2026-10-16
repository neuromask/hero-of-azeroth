/**
 * Copying the site's SQLite database out of a host that is still writing to it.
 *
 * The deploy cannot run a query on the host: it can only ask for files over FTP, one at a time. That is what makes
 * this worth its own module and its own tests - a database in write-ahead log mode is two files, and a pair read
 * one after another is not a snapshot.
 *
 * The first test below is the defect itself, kept as a test so it cannot come back: a pair assembled the way a
 * file-by-file copy assembles one comes back holding the state from *before* a checkpoint, and says `ok` when it
 * is asked whether it is sound. The rest are the module's own guarantees - that the copy it accepts is the
 * current one, that it refuses a pair whose log moved, that it answers a failure rather than a copy when the log
 * will never hold still, and that what it keeps is a single file that opens read-only and passes its checks.
 *
 * Every database here is a throwaway under `os.tmpdir()`, built and read by the tests themselves.
 */
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyDatabase,
  DATABASE_FILES,
  DATABASE_LOG,
  DATABASE_NAME,
  foldDatabase
} from '../../scripts/lib/databaseCopy.mjs'
import { cleanup, remember, tempDir } from '../helpers/tempDirs'

afterEach(cleanup)

/** A live database in the mode the site runs in, with ten committed rows that live in the write-ahead log. */
function liveDatabase(values = 'old') {
  const dir = tempDir('hoa-live-')
  const db = remember(new DatabaseSync(join(dir, DATABASE_NAME)))
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
  db.exec('BEGIN')
  for (let i = 1; i <= 10; i += 1) db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(i, values)
  db.exec('COMMIT')
  return { dir, db }
}

/** What a set of copied files holds, opened the way a restore would open it. */
function contents(dir, file = DATABASE_NAME) {
  const db = new DatabaseSync(join(dir, file), { readOnly: true })
  try {
    return {
      integrity: db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check).join('; '),
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
      rows: db.prepare('SELECT COUNT(*) AS n FROM t').get().n,
      old: db.prepare("SELECT COUNT(*) AS n FROM t WHERE v = 'old'").get().n,
      fresh: db.prepare("SELECT COUNT(*) AS n FROM t WHERE v = 'fresh'").get().n
    }
  } finally {
    db.close()
  }
}

/**
 * The download a deploy does: one file, from the host, into the copy - with a hook that runs just before it, so a
 * test can put a write exactly where it wants it.
 */
function downloader(source, hook) {
  let calls = 0

  return (name, destination, allowEmpty = false) => {
    calls += 1
    hook?.(calls, name)

    const file = join(source, name)
    if (!existsSync(file)) return false

    copyFileSync(file, destination)
    return statSync(destination).size > 0 || allowEmpty
  }
}

describe('a database copied out of a host that is still writing', () => {
  it('is not a snapshot when its files are taken one after another, which is why copyDatabase exists', () => {
    const { dir, db } = liveDatabase()

    // The log as a first read finds it: the frames holding 'old'.
    const before = tempDir('hoa-before-')
    copyFileSync(join(dir, DATABASE_LOG), join(before, DATABASE_LOG))

    // The site writes, and the checkpoint that follows moves those frames into the database file and resets the
    // log - all of it between the two reads a file-by-file copy would make.
    db.exec("UPDATE t SET v = 'fresh'")
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    // The pair a file-by-file copy would file: the log from before, the database file from after.
    const naive = tempDir('hoa-naive-')
    copyFileSync(join(before, DATABASE_LOG), join(naive, DATABASE_LOG))
    copyFileSync(join(dir, DATABASE_NAME), join(naive, DATABASE_NAME))

    const stale = contents(naive)

    // It opens, it answers, and it says it is sound - while holding the values from before the write.
    expect(stale.integrity).toBe('ok')
    expect(stale.rows).toBe(10)
    expect(stale.fresh).toBe(0)
    expect(stale.old).toBe(10)

    db.close()
  })

  it('accepts a copy taken while nothing was writing, and folds it into one file', () => {
    const { dir, db } = liveDatabase('fresh')
    const copy = tempDir('hoa-copy-')

    const result = copyDatabase(copy, new Set(DATABASE_FILES), downloader(dir))

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(1)
    expect(result.folded).toEqual({ ok: true, reason: null })

    // One file, holding the whole of it: no log and no shared-memory index are kept.
    expect(existsSync(join(copy, DATABASE_LOG))).toBe(false)
    expect(existsSync(join(copy, `${DATABASE_NAME}-shm`))).toBe(false)

    expect(contents(copy)).toMatchObject({ integrity: 'ok', foreignKeys: 0, rows: 10, fresh: 10, old: 0 })
    expect(result.bytes).toBe(statSync(join(copy, DATABASE_NAME)).size)

    db.close()
  })

  it('refuses a pair whose log moved while the file was read, and takes the copy again', () => {
    const { dir, db } = liveDatabase()
    const copy = tempDir('hoa-copy-')

    // A write and a checkpoint land exactly between the log's first read and the database file's read: the two
    // reads of the log then differ, and the pair attempt one assembled is the stale one the test above describes.
    const result = copyDatabase(
      copy,
      new Set(DATABASE_FILES),
      downloader(dir, (call) => {
        if (call !== 2) return
        db.exec("UPDATE t SET v = 'fresh'")
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      })
    )

    expect(result.ok).toBe(true)
    // The first pair was refused, so the copy was taken a second time - and what it holds is the state the
    // database is actually in, not the one the write left behind.
    expect(result.attempts).toBe(2)
    expect(contents(copy)).toMatchObject({ integrity: 'ok', rows: 10, fresh: 10, old: 0 })

    db.close()
  })

  it('answers a failure rather than a copy when the log never holds still', () => {
    const { dir, db } = liveDatabase()

    // Every read of the log is a read of a log that has just moved: no window can be taken at all.
    const result = copyDatabase(
      tempDir('hoa-copy-'),
      new Set(DATABASE_FILES),
      downloader(dir, (call) => {
        db.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(100 + call, 'moving')
      }),
      { attempts: 3 }
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/moved on every one of 3 attempts/)
    // Nothing was folded, so nothing pretends to be a database the caller may keep.
    expect(result.folded).toBeUndefined()

    db.close()
  })

  it('copies a database that has no log at all as the file it is', () => {
    const dir = tempDir('hoa-plain-')
    const db = remember(new DatabaseSync(join(dir, DATABASE_NAME)))
    db.exec('PRAGMA journal_mode = DELETE')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    db.exec("INSERT INTO t (id, v) VALUES (1, 'fresh')")
    db.close()

    const copy = tempDir('hoa-copy-')
    const result = copyDatabase(copy, new Set([DATABASE_NAME]), downloader(dir))

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(1)
    expect(contents(copy)).toMatchObject({ integrity: 'ok', rows: 1, fresh: 1 })
  })

  it('reports a copy that will not open instead of filing it', () => {
    const dir = tempDir('hoa-broken-')
    writeFileSync(join(dir, DATABASE_NAME), Buffer.alloc(4096, 7))

    const folded = foldDatabase(dir)

    expect(folded.ok).toBe(false)
    expect(folded.reason).toBeTruthy()
  })

  it('takes a copy of a database the host listed without its log', () => {
    const { dir, db } = liveDatabase('fresh')

    // A listing that names only the database: the log is not there to read, so there is no window to take - and
    // what is copied is the file plus whatever the host has already checkpointed into it.
    const copy = tempDir('hoa-copy-')
    const result = copyDatabase(copy, new Set([DATABASE_NAME]), downloader(dir))

    expect(result.ok).toBe(true)
    expect(existsSync(join(copy, DATABASE_LOG))).toBe(false)

    db.close()
  })

  it('does not keep a log or a shared-memory file beside the folded copy', () => {
    const { dir, db } = liveDatabase('fresh')
    const copy = tempDir('hoa-copy-')

    copyDatabase(copy, new Set(DATABASE_FILES), downloader(dir))

    expect(existsSync(join(copy, `${DATABASE_LOG}.second`))).toBe(false)
    expect(readFileSync(join(copy, DATABASE_NAME)).length).toBeGreaterThan(0)

    db.close()
  })
})

