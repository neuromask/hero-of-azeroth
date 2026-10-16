/**
 * Copying the site's SQLite database out of a host that is still running.
 *
 * The database is kept in the write-ahead log mode (`server/utils/db`), which means the file on disk is only half
 * of it: what has been committed since the last checkpoint lives in `hoa.db-wal`, and SQLite reads the two as one.
 * A deploy can only ask the host for files over FTP, one at a time, and a pair read one after another is **not** a
 * snapshot. Both ways it goes wrong are silent, and both were measured on a ten-row table before this module
 * existed:
 *
 *   - the log read first, the database file second, with a checkpoint in between: the log SQLite applies is one it
 *     had already consumed, and the copy came back holding the values from *before* the write - `integrity_check`
 *     said `ok`;
 *   - the file read first, the log second, with the log reset in between: the copy came back with `no such table`
 *     for a table that only ever existed in the log - and `integrity_check` said `ok` again.
 *
 * Nothing about a copy tells either case from a good one, so the pair is never taken blind. What *can* be told
 * apart is whether the log held still while the file was read: a write appends frames to the log and a checkpoint
 * resets it, so two identical reads of the log are a log that did not move - and a database file read inside that
 * window is one that agrees with it. `copyDatabase` takes that window, up to a bounded number of times, and
 * answers a failure rather than a copy when the log will not hold still.
 *
 * The accepted pair is then folded into one file (`foldDatabase`): the log is checkpointed into the database and
 * both `-wal` and `-shm` are removed, so what a backup keeps is a single file that a restore can copy back, that
 * a read-only open can read, and that `integrity_check` can actually speak about.
 *
 * It lives in `scripts/lib` rather than inside `scripts/deploy.mjs` for the reason the rest of that folder does:
 * a deploy is not a thing a test can run, and this is the part of one that has to be provable.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** The database's own name, under the name the site keeps it in (`server/utils/db`). */
export const DATABASE_NAME = 'hoa.db'

/** The half of the pair that holds what has not been checkpointed into the file yet. */
export const DATABASE_LOG = `${DATABASE_NAME}-wal`

/** Every file the database is made of, the first of which is the one a copy keeps. */
export const DATABASE_FILES = [DATABASE_NAME, DATABASE_LOG, `${DATABASE_NAME}-shm`]

/** How many times a copy is taken again when the log will not hold still for it. */
export const DATABASE_COPY_ATTEMPTS = 4

/**
 * Folds a copied database's write-ahead log into it, checks it, and takes the log away.
 *
 * Answers the check's verdict rather than throwing - `{ ok, reason }` - because a copy that will not fold is
 * something the caller reports rather than something that should stop a deploy. `integrity_check` is run *before*
 * the checkpoint, while the log is still beside the file, because a log that has not been applied is a log the
 * check says nothing about.
 */
export function foldDatabase(directory, options = {}) {
  const name = options.database || DATABASE_NAME
  const database = join(directory, name)
  if (!existsSync(database)) return null

  let db = null
  let verdict = { ok: true, reason: null }

  try {
    db = new DatabaseSync(database)
    const checked = db.prepare('PRAGMA integrity_check').all().map((row) => row.integrity_check)

    if (checked.length !== 1 || checked[0] !== 'ok') {
      verdict = { ok: false, reason: `integrity_check said ${checked.join('; ') || 'nothing'}` }
    } else {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    }
  } catch (error) {
    verdict = { ok: false, reason: error.message }
  } finally {
    try {
      db?.close()
    } catch {
      // Never opened, or already closed: nothing to do about either.
    }

    for (const suffix of ['-wal', '-shm']) rmSync(`${database}${suffix}`, { force: true })
  }

  return verdict
}

/**
 * Copies the database and its log as one consistent pair, and folds the pair into one file.
 *
 * `available` is the set of names the host listed, so a database with no log at all - one that was stopped
 * cleanly - is copied as the file it is, with no window to take. `fetchInto(name, destination)` downloads one file
 * and answers whether it arrived; it is passed in because a deploy's download is a curl call and a test's is a
 * copy of a file, and the interesting part of this function is what it does between the calls.
 */
export function copyDatabase(directory, available, fetchInto, options = {}) {
  const attempts = options.attempts || DATABASE_COPY_ATTEMPTS
  const name = options.database || DATABASE_NAME
  const logName = `${name}-wal`

  const database = join(directory, name)
  const log = join(directory, logName)
  const second = join(directory, `${logName}.second`)

  const bytes = (file) => (existsSync(file) ? readFileSync(file) : null)
  const same = (left, right) => (left === null || right === null ? left === right : left.equals(right))
  const hasLog = available.has(logName)

  // A log the listing named may be *empty* - a checkpoint that reset it, or a host stopped cleanly - and an empty
  // file is a perfectly good answer for it. It is not a good answer for a file the listing did not name, where a
  // zero-length download is how a transfer of something that is not there comes back (`fetchInto`).
  const ask = (name, destination, allowEmpty = false) => fetchInto(name, destination, allowEmpty)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (hasLog && !ask(logName, log, true)) return { ok: false, reason: 'the write-ahead log could not be read' }
    if (!ask(name, database)) return { ok: false, reason: 'the database could not be read' }
    if (hasLog && !ask(logName, second, true)) {
      return { ok: false, reason: 'the write-ahead log could not be read twice' }
    }

    if (same(bytes(log), bytes(second))) {
      rmSync(second, { force: true })
      const folded = foldDatabase(directory, options)

      // The size is read after the fold: a log folded into the file is pages the file did not have yet.
      return { ok: true, attempts: attempt, bytes: statSync(database).size, folded }
    }

    // The log moved while the file was read: this pair is not a snapshot, and neither half can be trusted.
    rmSync(second, { force: true })
  }

  return { ok: false, reason: `the write-ahead log moved on every one of ${attempts} attempts` }
}

