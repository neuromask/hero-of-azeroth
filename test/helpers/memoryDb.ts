/**
 * A throwaway SQLite database for the tests, and the one wire that lets a server module read it.
 *
 * The server's own database (`server/utils/db.ts`) is opened as a process-wide singleton over a file
 * in `server/data`, and it is deliberately left alone here: a test must never touch the data a running
 * site has written. What the modules under test reach for is `useDb()`, which Nitro auto-imports and
 * which this helper installs as a global pointing at a fresh in-memory database - so a rule that lives
 * in a query (`populationRows`, `readLeaderboardPage`, `readAccountTotals`) is exercised through the very
 * SQL the site runs, against rows a test controls, with nothing written to disk.
 *
 * The schema below is not the site's whole schema and is not meant to be: it is the tables and the
 * columns the tested queries touch. A column that is renamed or dropped in `server/utils/db.ts` shows
 * up here as a failing query rather than a silent pass, which is the point of writing them down.
 */
import { DatabaseSync } from 'node:sqlite'
import { bumpStatisticsRevision } from '../../server/utils/statisticsPopulation'

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  hide_from_fame INTEGER NOT NULL DEFAULT 0,
  auth_expired INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Nullable, and without the ownership foreign key the real table carries: a test writes rows for users it
  -- never creates (addCharacter with a fresh id), and what these tables are here to catch is a column a query
  -- reaches for - not the account rule, which addUser/addCharacter state by hand.
  user_id INTEGER,
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
  is_main INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER,
  stats_read_at INTEGER
);
CREATE UNIQUE INDEX idx_characters_guest ON characters(region, realm_slug, name_key) WHERE user_id IS NULL;

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  ilvl REAL,
  mplus_score REAL,
  achievements INTEGER,
  mounts INTEGER,
  pets INTEGER,
  toys INTEGER,
  decor INTEGER,
  reputations INTEGER,
  titles INTEGER,
  quests INTEGER,
  recipes INTEGER,
  transmogs INTEGER,
  honorable_kills INTEGER,
  honor_level INTEGER,
  score INTEGER
);

CREATE TABLE account_pool (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
);

CREATE TABLE account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  ilvl REAL,
  mplus_score REAL,
  achievements INTEGER,
  mounts INTEGER,
  pets INTEGER,
  toys INTEGER,
  decor INTEGER,
  reputations INTEGER,
  titles INTEGER,
  quests INTEGER,
  recipes INTEGER,
  transmogs INTEGER,
  honorable_kills INTEGER,
  honor_level INTEGER,
  score INTEGER
);
CREATE UNIQUE INDEX idx_account_snapshots_user ON account_snapshots(user_id, taken_at);

-- The population of the hall of fame, materialised: one row per member, written and read by
-- ./server/utils/leaderboardRows, whose own insert names these very columns. The primary key is the address a row
-- is keyed by, which is what makes a refresh of one member a replace rather than a second row.
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
  capped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region, realm_slug, name_key)
);

CREATE TABLE saved_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  name_key TEXT NOT NULL,
  name TEXT NOT NULL,
  realm_name TEXT,
  class_id INTEGER,
  class_slug TEXT,
  avatar TEXT,
  seen_at INTEGER,
  starred_at INTEGER,
  UNIQUE (user_id, region, realm_slug, name_key)
);
`

export interface NewCharacter {
  userId: number
  region: string
  realm: string
  name: string
  isMain?: boolean
  level?: number
  statsReadAt?: number
}

/** One character's reading, as the `snapshots` table holds it. */
export interface NewSnapshot {
  characterId: number
  takenAt: number
  ilvl?: number | null
  mplus?: number | null
  achievements?: number | null
  mounts?: number | null
  pets?: number | null
  toys?: number | null
  decor?: number | null
  reputations?: number | null
  /** The figures beside the collections (`server/utils/blizzard`), which no rating weighs. */
  titles?: number | null
  quests?: number | null
  recipes?: number | null
  transmogs?: number | null
  honorableKills?: number | null
  honorLevel?: number | null
  /** The overall rating, computed at write time; `null` where it was not. */
  score?: number | null
}

export interface MemoryDb {
  db: DatabaseSync
  addUser(id: number, hideFromFame?: boolean): void
  addCharacter(character: NewCharacter): number
  /** Files a character the site has read that no account holds: a guest row (`user_id IS NULL`). */
  addGuestCharacter(character: Omit<NewCharacter, 'userId'>): number
  addSnapshot(snapshot: NewSnapshot): void
  addPoolItems(userId: number, kind: string, ids: readonly number[]): void
}

/** A fresh in-memory database with the schema above, plus writers for the rows a test needs. */
export function createMemoryDb(): MemoryDb {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)

  return {
    db,

    addUser(id, hideFromFame = false) {
      db.prepare('INSERT INTO users (id, hide_from_fame) VALUES (?, ?)').run(id, hideFromFame ? 1 : 0)
    },

    addCharacter(character) {
      const result = db
        .prepare(
          `INSERT INTO characters (user_id, region, realm_slug, name, name_key, display_name, is_main, level, stats_read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          character.userId,
          character.region,
          character.realm.toLowerCase(),
          character.name,
          character.name.toLowerCase(),
          character.name,
          character.isMain ? 1 : 0,
          character.level ?? null,
          character.statsReadAt ?? null
        )

      return Number(result.lastInsertRowid)
    },

    addGuestCharacter(character) {
      const result = db
        .prepare(
          `INSERT INTO characters
             (user_id, region, realm_slug, realm_name, name, name_key, display_name, is_main, level, last_seen_at, stats_read_at)
           VALUES (NULL, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`
        )
        .run(
          character.region,
          character.realm.toLowerCase(),
          character.realm,
          character.name,
          character.name.toLowerCase(),
          character.name,
          character.level ?? null,
          character.statsReadAt ?? null
        )

      return Number(result.lastInsertRowid)
    },

    addSnapshot(snapshot) {
      db.prepare(
        `INSERT INTO snapshots
           (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations,
            titles, quests, recipes, transmogs, honorable_kills, honor_level, score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        snapshot.characterId,
        snapshot.takenAt,
        snapshot.ilvl ?? null,
        snapshot.mplus ?? null,
        snapshot.achievements ?? null,
        snapshot.mounts ?? null,
        snapshot.pets ?? null,
        snapshot.toys ?? null,
        snapshot.decor ?? null,
        snapshot.reputations ?? null,
        snapshot.titles ?? null,
        snapshot.quests ?? null,
        snapshot.recipes ?? null,
        snapshot.transmogs ?? null,
        snapshot.honorableKills ?? null,
        snapshot.honorLevel ?? null,
        snapshot.score ?? null
      )
    },

    addPoolItems(userId, kind, ids) {
      const insert = db.prepare('INSERT OR IGNORE INTO account_pool (user_id, kind, item_id) VALUES (?, ?, ?)')
      for (const id of ids) insert.run(userId, kind, id)
    }
  }
}

/**
 * Points the server modules' auto-imported `useDb()` at `db`.
 *
 * The modules call `useDb()` as a free global, the way Nitro hands it to them; in a test that global
 * is this. Call it before the first read - the caches it feeds are cleared per test by hand.
 *
 * One of them cannot be cleared by hand, and is cleared here: a memo of the statistics is keyed on a revision
 * the app's own writes bump (`server/utils/statisticsPopulation`), while a test writes its rows through the
 * helpers below. Handing the modules a different database is what makes everything they remember of the
 * previous one stale, so the revision is moved at the same moment.
 */
export function installUseDb(db: DatabaseSync): void {
  ;(globalThis as Record<string, unknown>).useDb = () => db
  bumpStatisticsRevision()
}
