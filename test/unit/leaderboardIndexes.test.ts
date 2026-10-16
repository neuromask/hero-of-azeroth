/**
 * The orders the hall of fame's table is read in, as a database that already exists gets them.
 *
 * Two things about the indices this build reads by are worth pinning, and neither is visible from a read of the
 * schema. The first is that an *older* database is brought up to them: `CREATE INDEX IF NOT EXISTS` says nothing
 * about an index that already exists in the wrong shape, and a table ordered by the figure, the rating and the name
 * with nothing left to settle the tie the address would is a table a metric ranking cannot be read from. The second
 * is that the migration is idempotent: a second start has to find every index exactly as it left it, or a deploy
 * would rebuild fifteen indices (over a two-hundred-thousand row table) every time the process restarted.
 *
 * The fixture is an old database in the *middle* of its life: the columns this build added are missing, the index
 * that carries the mounts order is the old shape, and there are rows in the table that must survive all of it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'

const data = mkdtempSync(join(tmpdir(), 'hoa-indexes-'))
process.env.NUXT_DATA_DIR = data

// The module opens the database through `useDb()`, which reads the data directory once - so the old database is
// written before the first call, which is what makes `useDb()` migrate it rather than create a fresh one.
const OLD_SCHEMA = `
CREATE TABLE leaderboard (
  user_id INTEGER,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  name_key TEXT NOT NULL,
  realm_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  class_id INTEGER NOT NULL DEFAULT 0,
  faction TEXT NOT NULL DEFAULT 'neutral',
  level INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  updated_at INTEGER NOT NULL,
  is_account INTEGER NOT NULL DEFAULT 0,
  ilvl REAL,
  mplus_score REAL,
  honorable_kills INTEGER,
  mounts INTEGER,
  pets INTEGER,
  toys INTEGER,
  decor INTEGER,
  reputations INTEGER,
  achievements INTEGER,
  collectables INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region, realm_slug, name_key)
);
-- The shape this build reads by, written by the build before it: figure, rating, name - and no address.
CREATE INDEX idx_leaderboard_mounts ON leaderboard(mounts DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX idx_leaderboard_total ON leaderboard(score DESC, display_name COLLATE NOCASE);
`

const old = new DatabaseSync(join(data, 'hoa.db'))
old.exec(OLD_SCHEMA)
old.exec(
  `INSERT INTO leaderboard
     (region, realm_slug, name_key, realm_name, display_name, updated_at, mounts, achievements, score)
   VALUES ('eu', 'gordunni', 'alpha', 'Gordunni', 'Alpha', 1000, 10, 100, 5000),
          ('eu', 'gordunni', 'beta', 'Gordunni', 'Beta', 1000, 20, 100, 5000)`
)
old.close()

const { useDb, migrateLeaderboardIndexes } = await import('../../server/utils/db')

afterAll(() => {
  try {
    rmSync(data, { recursive: true, force: true })
  } catch {
    // Windows keeps the file open for the life of the process; the temporary folder is the operating system's.
  }
})

/** Every index on the table, by name, with the statement that created it. */
function indexes(db: DatabaseSync): Record<string, string> {
  const rows = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'leaderboard'")
    .all() as { name: string; sql: string | null }[]

  return Object.fromEntries(rows.map((row) => [row.name, (row.sql || '').replace(/\s+/g, ' ')]))
}

/** The columns of a table, in the order the database holds them. */
function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((entry) => entry.name)
}

describe('the orders a database written by an older build gains', () => {
  const db = useDb()

  it('takes the columns and the orders this build reads by, without touching the rows', () => {
    // The five figures a metric leaderboard ranks, and the guild a row prints: all added by the migration, because
    // a table that already exists cannot grow them on its own.
    expect(columns(db, 'leaderboard')).toEqual(
      expect.arrayContaining(['guild', 'titles', 'quests', 'recipes', 'transmogs', 'honor_level'])
    )

    const orders = indexes(db)

    // The index that carried the mounts order has been rebuilt to the one this build reads by: it ends in the three
    // segments a row is keyed by, which is what makes a place a place in a total order.
    expect(orders.idx_leaderboard_mounts).toContain('name_key')
    expect(orders.idx_leaderboard_mounts).toContain('realm_slug')
    expect(orders.idx_leaderboard_total).toContain('name_key')

    // And the five orders that had no index at all now have one, of the same shape.
    for (const name of [
      'idx_leaderboard_titles',
      'idx_leaderboard_quests',
      'idx_leaderboard_recipes',
      'idx_leaderboard_transmogs',
      'idx_leaderboard_honor_level'
    ]) {
      expect(orders[name], name).toContain('region, realm_slug, name_key')
    }

    // The rows are exactly where they were: a migration that rebuilt an index must not have moved anybody.
    const rows = db.prepare('SELECT name_key, mounts FROM leaderboard ORDER BY name_key').all() as unknown as {
      name_key: string
      mounts: number
    }[]

    expect(rows).toEqual([
      { name_key: 'alpha', mounts: 10 },
      { name_key: 'beta', mounts: 20 }
    ])
  })

  it('is done once: a second pass over the same database changes nothing', () => {
    const before = indexes(db)

    migrateLeaderboardIndexes(db)
    migrateLeaderboardIndexes(db)

    expect(indexes(db)).toEqual(before)
  })

  it('reads a metric order as an index scan rather than as a sort of the population', () => {
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT * FROM leaderboard
          WHERE titles IS NOT NULL
          ORDER BY titles DESC, score DESC, display_name COLLATE NOCASE ASC, region ASC, realm_slug ASC, name_key ASC
          LIMIT 25 OFFSET 0`
      )
      .all() as { detail: string }[]

    const details = plan.map((row) => row.detail).join(' | ')

    // The whole order is walked by an index and nothing sorts the table on the way, which is the property a page of
    // a ranking has to have whatever the population is.
    expect(details).toContain('idx_leaderboard_titles')
    expect(details).not.toContain('TEMP B-TREE')
  })
})

describe('an index that exists in the wrong shape', () => {
  it('is rebuilt from the columns a row is actually ordered by', () => {
    const fresh = new DatabaseSync(':memory:')
    fresh.exec(`CREATE TABLE leaderboard (
      user_id INTEGER, region TEXT, realm_slug TEXT, name_key TEXT, realm_name TEXT, display_name TEXT, avatar TEXT,
      guild TEXT, class_id INTEGER, faction TEXT, level INTEGER, first_seen_at INTEGER, updated_at INTEGER,
      is_account INTEGER, ilvl REAL, mplus_score REAL, honorable_kills INTEGER, mounts INTEGER, pets INTEGER,
      toys INTEGER, decor INTEGER, reputations INTEGER, achievements INTEGER, titles INTEGER, quests INTEGER,
      recipes INTEGER, transmogs INTEGER, honor_level INTEGER, collectables INTEGER, score INTEGER,
      PRIMARY KEY (region, realm_slug, name_key)
    )`)
    fresh.exec('CREATE INDEX idx_leaderboard_mounts ON leaderboard(mounts DESC)')

    migrateLeaderboardIndexes(fresh)

    // The old index was dropped and written again in the shape this build reads by, rather than left beside a second
    // one: fifteen orders are fifteen, whatever shape the database arrived in.
    expect(indexes(fresh).idx_leaderboard_mounts).toContain(
      'mounts DESC, score DESC, display_name COLLATE NOCASE, region, realm_slug, name_key'
    )

    // And a second pass finds every index it wrote, which is what makes the migration idempotent rather than a
    // rebuild on every start.
    const before = indexes(fresh)
    migrateLeaderboardIndexes(fresh)
    expect(indexes(fresh)).toEqual(before)
  })
})
