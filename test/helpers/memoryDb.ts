/**
 * A throwaway SQLite database for the tests, and the one wire that lets a server module read it.
 *
 * The server's own database (`server/utils/db.ts`) is opened as a process-wide singleton over a file
 * in `server/data`, and it is deliberately left alone here: a test must never touch the data a running
 * site has written. What the modules under test reach for is `useDb()`, which Nitro auto-imports and
 * which this helper installs as a global pointing at a fresh in-memory database - so a rule that lives
 * in a query (`excludedLeaderboardKeys`, `accountLeaderboardKeys`, `readAccountTotals`) is exercised
 * through the very SQL the site runs, against rows a test controls, with nothing written to disk.
 *
 * The schema below is not the site's whole schema and is not meant to be: it is the tables and the
 * columns the tested queries touch. A column that is renamed or dropped in `server/utils/db.ts` shows
 * up here as a failing query rather than a silent pass, which is the point of writing them down.
 */
import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  hide_from_fame INTEGER NOT NULL DEFAULT 0,
  auth_expired INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  is_main INTEGER NOT NULL DEFAULT 0,
  level INTEGER,
  stats_read_at INTEGER
);

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
  honor_level INTEGER
);

CREATE TABLE account_pool (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
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
  /** The figures beside the collections (`server/utils/blizzard`), which no rating weighs. */
  titles?: number | null
  quests?: number | null
  recipes?: number | null
  transmogs?: number | null
  honorableKills?: number | null
  honorLevel?: number | null
}

export interface MemoryDb {
  db: DatabaseSync
  addUser(id: number, hideFromFame?: boolean): void
  addCharacter(character: NewCharacter): number
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
          `INSERT INTO characters (user_id, region, realm_slug, name, name_key, is_main, level, stats_read_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          character.userId,
          character.region,
          character.realm.toLowerCase(),
          character.name,
          character.name.toLowerCase(),
          character.isMain ? 1 : 0,
          character.level ?? null,
          character.statsReadAt ?? null
        )

      return Number(result.lastInsertRowid)
    },

    addSnapshot(snapshot) {
      db.prepare(
        `INSERT INTO snapshots
           (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations,
            titles, quests, recipes, transmogs, honorable_kills, honor_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        null,
        snapshot.titles ?? null,
        snapshot.quests ?? null,
        snapshot.recipes ?? null,
        snapshot.transmogs ?? null,
        snapshot.honorableKills ?? null,
        snapshot.honorLevel ?? null
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
 */
export function installUseDb(db: DatabaseSync): void {
  ;(globalThis as Record<string, unknown>).useDb = () => db
}
