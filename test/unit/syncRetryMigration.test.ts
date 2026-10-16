/**
 * The three columns the retry state needs, on a database that predates them.
 *
 * A schema change is the one kind of change a running site cannot be given twice by accident, so what is pinned
 * here is the whole of it: an existing database gains the columns without losing a row, and a database this build
 * creates from nothing has them from the start. The file the test writes is the schema the build *before* the
 * retry state left - the state itself is tested in `test/unit/syncRetry.test.ts`.
 */
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, remember, tempDir } from '../helpers/tempDirs'

let dir = ''

beforeEach(() => {
  dir = tempDir('hoa-sync-migration-')
  process.env.NUXT_DATA_DIR = dir
})

afterEach(() => {
  delete process.env.NUXT_DATA_DIR
  cleanup()
})

/** Every column of a table, as SQLite reports them. */
async function columnsOf(table: string): Promise<string[]> {
  vi.resetModules()
  const { useDb } = await import('../../server/utils/db')
  return (useDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
    (column) => column.name
  )
}

describe('a database written before the retry state existed', () => {
  it('gains the three columns, and keeps every character it held', async () => {
    // The file as the older build left it: no `sync_failures`, no `sync_retry_at`, no `sync_error`.
    const legacy = remember(new DatabaseSync(join(dir, 'hoa.db')))
    legacy.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        bnet_sub TEXT NOT NULL UNIQUE
      );
      CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        region TEXT NOT NULL,
        realm_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL,
        is_main INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL,
        stats_read_at INTEGER,
        UNIQUE (user_id, region, realm_slug, name_key)
      );
    `)
    legacy.exec("INSERT INTO users (id, bnet_sub) VALUES (1, 'a-battle-net-id')")
    legacy.exec(
      `INSERT INTO characters (id, user_id, region, realm_slug, name, name_key, is_main, last_seen_at)
       VALUES (11, 1, 'eu', 'gordunni', 'Testchar', 'testchar', 1, 1700000000)`
    )
    legacy.close()

    // Opening it the way the site does is what runs the migrations.
    const columns = await columnsOf('characters')
    expect(columns).toEqual(expect.arrayContaining(['sync_failures', 'sync_retry_at', 'sync_error']))

    vi.resetModules()
    const { useDb } = await import('../../server/utils/db')

    // The row is untouched, and its retry state is the default one: healthy, unparked, nothing recorded - so a
    // character the site has read a hundred times does not start its life after an upgrade looking broken.
    expect(useDb().prepare('SELECT name, sync_failures, sync_retry_at, sync_error FROM characters WHERE id = 11').get()).toEqual(
      { name: 'Testchar', sync_failures: 0, sync_retry_at: null, sync_error: null }
    )
  })
})

describe('a database this build creates from nothing', () => {
  it('has the retry columns from the start', async () => {
    const columns = await columnsOf('characters')

    expect(columns).toEqual(expect.arrayContaining(['sync_failures', 'sync_retry_at', 'sync_error']))
  })
})
