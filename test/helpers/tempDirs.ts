/**
 * Temporary directories and open databases, for tests that make either.
 *
 * Two things a test has to undo to leave nothing behind, and both are easy to get wrong. A directory holding a
 * SQLite file is not removable while a connection still has it open - which on Windows is until the connection is
 * closed, and `node:sqlite` holds a file for the life of a process that never closes it. And a connection left open
 * by a test that failed in the middle is exactly the case a `finally` inside the test never runs for.
 *
 * So both are registered here and both are undone by one call from an `afterEach`: the connections first, then the
 * directories. A directory that still will not go is left in `os.tmpdir`, which is where the load test leaves its
 * own for the same reason - but a suite that never closes what it opened turns that from an exception into the
 * rule, and a hundred abandoned databases is a real thing to leave on somebody's disk.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directories: string[] = []
const connections: { close(): void }[] = []

/** A directory of its own under the system's temporary folder, removed by `cleanup`. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  directories.push(dir)
  return dir
}

/** A database to close before anything is removed: answered back, so it can be used where it was made. */
export function remember<T extends { close(): void }>(database: T): T {
  connections.push(database)
  return database
}

/** Closes everything remembered, then removes every directory - connections first, because of the order. */
export function cleanup(): void {
  for (const database of connections.splice(0)) {
    try {
      database.close()
    } catch {
      // Already closed by the test itself, which is the usual case and not a problem.
    }
  }

  for (const dir of directories.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // A handle the operating system has not let go of yet; `os.tmpdir` is the operating system's to clean up.
    }
  }
}
