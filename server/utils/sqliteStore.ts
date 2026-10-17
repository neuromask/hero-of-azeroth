/**
 * The disk tier of a stale-while-revalidate store: heavy answers kept in the site's own SQLite file instead of
 * in the process's memory.
 *
 * A rendered card is a few hundred kilobytes and a collection shelf as much again. Held in a `Map` they are
 * the largest thing the process owns after the Blizzard documents; written here they cost a page cache that
 * `PRAGMA cache_size` already bounds (`./db`), and the bytes are in memory only for the moment between the
 * read and the response. The in-memory tier in front of this one (`./swrCache`) stays small on purpose.
 *
 * It is a *cache*, not data, so three rules keep it honest:
 *
 *   - **A boot is a namespace.** Rows are filed under `<name>@<boot>`, and the rows of every earlier boot of
 *     the same name are deleted the first time the store is touched. A redeploy changes how a card is drawn
 *     and what a shelf says; an answer from the build before must never be served by the build after, and a
 *     cache that survives a restart is exactly that.
 *   - **A row cap and an age cap.** `maxRows` newest rows are kept and nothing older than `maxAgeMs`, so the
 *     file does not grow by more than the cap however busy the day.
 *   - **Never fatal.** A failed read is a miss and a failed write is a shrug (`./swrCache` wraps both): a
 *     cache that can take a page down is worse than no cache.
 *
 * The table is created on first use, per database handle, rather than in `./db`'s schema: it holds nothing
 * worth migrating, and a test's in-memory database needs no copy of it.
 */
import type { SwrPersistence } from './swrCache'

/** How a value becomes the bytes a row holds, and back. */
export interface RowCodec<T> {
  encode(value: T): Buffer
  decode(bytes: Buffer): T
}

/** A `Buffer` is stored as it is. */
export const bufferCodec: RowCodec<Buffer> = {
  encode: (value) => value,
  decode: (bytes) => bytes
}

/** Anything JSON can say, stored as UTF-8 text. */
export function jsonCodec<T>(): RowCodec<T> {
  return {
    encode: (value) => Buffer.from(JSON.stringify(value), 'utf8'),
    decode: (bytes) => JSON.parse(bytes.toString('utf8')) as T
  }
}

export interface SqliteStoreOptions {
  /** The newest rows kept. */
  maxRows: number
  /** The oldest a row may be, in milliseconds. */
  maxAgeMs: number
}

/** This process's own boot, which is what keeps one build's answers away from the next build. */
const BOOT = Date.now().toString(36)

/** The database handles the table was already created on. */
const prepared = new WeakSet<object>()

/** The names whose rows of earlier boots were already deleted in this process, per database handle. */
const swept = new WeakMap<object, Set<string>>()

function ready(db: ReturnType<typeof useDb>, name: string): void {
  if (!prepared.has(db)) {
    db.exec(`CREATE TABLE IF NOT EXISTS render_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      body BLOB NOT NULL,
      UNIQUE (namespace, key)
    )`)
    db.exec('CREATE INDEX IF NOT EXISTS idx_render_cache_age ON render_cache(namespace, fetched_at)')
    prepared.add(db)
  }

  let names = swept.get(db)
  if (!names) swept.set(db, (names = new Set()))

  if (!names.has(name)) {
    // Everything this name filed under another boot, which no process will ever ask for again.
    db.prepare('DELETE FROM render_cache WHERE namespace LIKE ? AND namespace <> ?').run(`${name}@%`, `${name}@${BOOT}`)
    names.add(name)
  }
}

export function createSqliteStore<T>(name: string, codec: RowCodec<T>, options: SqliteStoreOptions): SwrPersistence<T> {
  const namespace = `${name}@${BOOT}`

  return {
    read(key) {
      const db = useDb()
      ready(db, name)

      const row = db
        .prepare('SELECT fetched_at, body FROM render_cache WHERE namespace = ? AND key = ?')
        .get(namespace, key) as { fetched_at: number; body: Uint8Array } | undefined

      if (!row) return null

      // A view over the bytes the driver returned, not a second copy of them.
      const bytes = Buffer.from(row.body.buffer, row.body.byteOffset, row.body.byteLength)
      return { value: codec.decode(bytes), at: row.fetched_at }
    },

    readAt(key) {
      const db = useDb()
      ready(db, name)

      const row = db
        .prepare('SELECT fetched_at FROM render_cache WHERE namespace = ? AND key = ?')
        .get(namespace, key) as { fetched_at: number } | undefined

      return row ? row.fetched_at : null
    },

    write(key, value, at) {
      const db = useDb()
      ready(db, name)

      db.prepare(
        `INSERT INTO render_cache (namespace, key, fetched_at, body) VALUES (?, ?, ?, ?)
         ON CONFLICT (namespace, key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body`
      ).run(namespace, key, at, codec.encode(value))

      // The caps are enforced as rows arrive: what is too old goes, and then all but the newest `maxRows`.
      db.prepare('DELETE FROM render_cache WHERE namespace = ? AND fetched_at < ?').run(namespace, at - options.maxAgeMs)
      db.prepare(
        `DELETE FROM render_cache
          WHERE namespace = ?
            AND id NOT IN (SELECT id FROM render_cache WHERE namespace = ? ORDER BY fetched_at DESC, id DESC LIMIT ?)`
      ).run(namespace, namespace, options.maxRows)
    },

    remove(key) {
      const db = useDb()
      ready(db, name)

      db.prepare('DELETE FROM render_cache WHERE namespace = ? AND key = ?').run(namespace, key)
    }
  }
}
