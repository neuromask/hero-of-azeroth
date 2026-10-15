/**
 * The one migration that rebuilds a table: `characters.user_id` becoming nullable, which is what lets the site
 * keep a character it has only read (`./profileFeed` files one).
 *
 * A rebuild is the riskiest thing a migration does - the table is dropped and written again - so what these
 * tests pin down is the whole of what must survive it: every character row with its fields, every reading that
 * points at one, the account's own unique constraint, and the foreign key `snapshots` holds to the table. The
 * database they build is the schema the build *before* guests wrote, on purpose.
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateCharacterOwnership, migrateRemovedColumns } from '../../server/utils/db'

/** The tables as the older build left them: a character without an owner was not allowed. */
const OLD_SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bnet_sub TEXT NOT NULL UNIQUE
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  realm_name TEXT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  display_name TEXT,
  class_id INTEGER,
  level INTEGER,
  faction TEXT,
  avatar TEXT,
  profession_1 TEXT,
  profession_2 TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  stats_read_at INTEGER,
  UNIQUE (user_id, region, realm_slug, name_key)
);
CREATE INDEX idx_characters_user ON characters(user_id);
CREATE INDEX idx_characters_key ON characters(region, realm_slug, name_key);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  mounts INTEGER,
  score INTEGER
);
CREATE INDEX idx_snapshots_character ON snapshots(character_id, taken_at);
`

/** A database as the older build left it: one account, one character, and that character's readings. */
function oldDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  // Foreign keys on, which is how the site opens the file: the migration has to turn them off itself, or
  // dropping `characters` would take the readings that point at it with it.
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(OLD_SCHEMA)

  db.exec("INSERT INTO users (id, bnet_sub) VALUES (7, 'a-battle-net-id')")
  db.exec(
    `INSERT INTO characters
       (id, user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id, level, faction, avatar,
        profession_1, is_main, last_seen_at, stats_read_at)
     VALUES (11, 7, 'eu', 'gordunni', 'Gordunni', 'Testchar', 'testchar', 'Testchar', 1, 90, 'alliance', 'avatar.jpg',
             'Alchemy', 1, 1700000000, 1700000001)`
  )
  db.exec('INSERT INTO snapshots (character_id, taken_at, mounts, score) VALUES (11, 1700000000, 100, 5000)')

  return db
}

describe('migrateCharacterOwnership', () => {
  it('keeps every character and every reading, and lets a row have no owner', () => {
    const db = oldDatabase()
    migrateCharacterOwnership(db)

    const character = db.prepare('SELECT * FROM characters WHERE id = 11').get() as Record<string, unknown>
    expect(character.user_id).toBe(7)
    expect(character.name).toBe('Testchar')
    expect(character.realm_name).toBe('Gordunni')
    expect(character.avatar).toBe('avatar.jpg')
    expect(character.profession_1).toBe('Alchemy')
    expect(character.level).toBe(90)
    expect(character.is_main).toBe(1)
    expect(character.last_seen_at).toBe(1700000000)
    expect(character.stats_read_at).toBe(1700000001)

    // The readings are the whole reason the table is not simply written again from nothing.
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE character_id = 11').get()).toMatchObject({ n: 1 })

    // And `snapshots` still points at the table that was just rebuilt.
    expect(() => db.exec('INSERT INTO snapshots (character_id, taken_at) VALUES (999, 1)')).toThrow()

    // The point of it all: a row may now be written with no owner at all.
    db.prepare(
      `INSERT INTO characters (user_id, region, realm_slug, name, name_key, display_name, last_seen_at)
       VALUES (NULL, 'eu', 'gordunni', 'Stranger', 'stranger', 'Stranger', 1700000002)`
    ).run()

    expect(db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id IS NULL').get()).toMatchObject({ n: 1 })
  })

  it('holds one row per guest address, and the account constraint as it was', () => {
    const db = oldDatabase()
    migrateCharacterOwnership(db)

    const guest = `INSERT INTO characters (user_id, region, realm_slug, name, name_key, last_seen_at)
                   VALUES (NULL, 'eu', 'gordunni', 'Stranger', 'stranger', 1)`
    db.exec(guest)
    // A guest address is unique on its own: `UNIQUE (user_id, ...)` cannot hold two NULLs together, and two
    // rows for one character would be two histories of it.
    expect(() => db.exec(guest)).toThrow()

    // While two accounts may still each hold a character of the same name on the same realm.
    db.exec("INSERT INTO users (id, bnet_sub) VALUES (8, 'another-battle-net-id')")
    db.exec(`INSERT INTO characters (user_id, region, realm_slug, name, name_key, last_seen_at)
             VALUES (8, 'eu', 'gordunni', 'Stranger', 'stranger', 1)`)

    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 3 })
  })

  it('is a no-op on a database that has already been rebuilt', () => {
    const db = oldDatabase()
    migrateCharacterOwnership(db)
    migrateCharacterOwnership(db)

    expect(db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 1 })

    const columns = db.prepare('PRAGMA table_info(characters)').all() as unknown as { name: string; notnull: number }[]
    expect(columns.find((column) => column.name === 'user_id')?.notnull).toBe(0)
  })
})

/**
 * The other half of a migration: the columns this build has taken away, and the one figure of them that is moved
 * rather than dropped.
 *
 * `snapshots.ilvl` is the only copy of an item level the site still prints, so the character it belongs to takes
 * the newest reading that carried one before the readings lose the column - a read is allowed to say nothing about
 * a figure, so the newest *that carried one* is the answer, and a character no reading ever carried one for keeps
 * nothing rather than a nought. The account's own copy is dropped without being moved: it was the best gear on the
 * roster, which is no one character's, and an account has no item level of its own any more.
 */
const OLD_REMOVED_SCHEMA = `
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ilvl REAL
);
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  mounts INTEGER,
  ilvl REAL
);
CREATE TABLE account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  ilvl REAL
);
CREATE TABLE leaderboard (
  region TEXT NOT NULL,
  name_key TEXT NOT NULL,
  capped INTEGER
);
CREATE INDEX idx_leaderboard_ilvl ON leaderboard(capped);
`

describe('migrateRemovedColumns', () => {
  it('moves a character its newest item level, then drops the columns', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(OLD_REMOVED_SCHEMA)

    db.exec(
      `INSERT INTO characters (id, user_id, region, realm_slug, name, name_key, last_seen_at)
       VALUES (1, 7, 'eu', 'gordunni', 'Testchar', 'testchar', 1), (2, 7, 'eu', 'gordunni', 'Unread', 'unread', 1)`
    )
    db.exec('INSERT INTO snapshots (character_id, taken_at, mounts, ilvl) VALUES (1, 100, 10, 300)')
    db.exec('INSERT INTO snapshots (character_id, taken_at, mounts, ilvl) VALUES (1, 200, 11, 320)')
    db.exec('INSERT INTO snapshots (character_id, taken_at, mounts, ilvl) VALUES (1, 300, 12, NULL)')
    db.exec('INSERT INTO account_snapshots (user_id, taken_at, ilvl) VALUES (7, 300, 500)')
    db.exec("INSERT INTO leaderboard (region, name_key, capped) VALUES ('eu', 'testchar', 1)")

    migrateRemovedColumns(db)

    expect(db.prepare('SELECT ilvl FROM characters WHERE id = 1').get()).toMatchObject({ ilvl: 320 })
    expect(db.prepare('SELECT ilvl FROM characters WHERE id = 2').get()).toMatchObject({ ilvl: null })

    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((entry) => entry.name)

    expect(columns('snapshots')).not.toContain('ilvl')
    expect(columns('account_snapshots')).not.toContain('ilvl')
    expect(columns('leaderboard')).not.toContain('capped')
    expect(columns('characters')).toContain('ilvl')

    // The order that column was read in goes with it.
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_leaderboard_ilvl'").get()
    ).toBeUndefined()

    // And the migration is done: a second run finds nothing to move and nothing to drop.
    expect(() => migrateRemovedColumns(db)).not.toThrow()
    expect(db.prepare('SELECT COUNT(*) AS n FROM snapshots').get()).toMatchObject({ n: 3 })
  })
})
