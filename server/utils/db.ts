/**
 * The one SQLite database the site keeps: accounts, their characters and the snapshots those
 * characters leave behind.
 *
 * A single file beside the JSON stores the site already keeps (`server/data`), opened once per
 * process and reused for every request. The schema is created on first open, so a fresh deploy -
 * or a checkout that has never run the site - is served without a migration step.
 *
 * `node:sqlite` is synchronous on purpose. A personal site's tables are small and indexed, so a
 * write is cheaper than the event-loop turn an async driver would cost - and the module ships with
 * Node itself, which is what keeps the build free of native dependencies (a real concern for a
 * Windows -> Linux FTP deploy of `.output`). It answers from Node 22.5 behind a flag and from
 * Node 23.4 without one; the host runs Node 24.
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { dataDirectory } from './appPaths'

/**
 * Where the database lives: the app's own data directory (`./appPaths`), which is the folder the JSON
 * stores use.
 *
 * It is deliberately not `process.cwd()`: on the host the app may be started from anywhere, and a data
 * directory that follows the working directory is a second, empty database the moment that changes.
 */
const DB_FILE = join(dataDirectory(), 'hoa.db')

/** The open database, or `null` until the first call opens it. */
let db: DatabaseSync | null = null

/**
 * The open database, opened now if this is the first call - schema included.
 *
 * The connection is a process-wide singleton rather than a per-request one: SQLite is a file, and
 * opening it per request would cost more than the query. The pragmas are what make the file safe
 * under a redeploy (`WAL`), keep the two write paths honest (`foreign_keys`) and hold the page
 * cache down - the process has 416 MiB for the whole site, so the cache is deliberately modest
 * (`cache_size` is in KiB, and the negative sign asks for a size rather than a page count).
 */
export function useDb(): DatabaseSync {
  if (db) return db

  mkdirSync(dirname(DB_FILE), { recursive: true })

  const connection = new DatabaseSync(DB_FILE)
  connection.exec('PRAGMA journal_mode = WAL')
  connection.exec('PRAGMA foreign_keys = ON')
  connection.exec('PRAGMA synchronous = NORMAL')
  connection.exec('PRAGMA cache_size = -8000')
  connection.exec(SCHEMA)
  migrate(connection)

  db = connection
  return db
}

/** Seconds since the epoch, the unit every timestamp in the database is written in. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * The whole schema, written so that applying it twice changes nothing.
 *
 * `main_character_id` is a plain integer rather than a foreign key on purpose: it points at a row
 * of `characters`, which is written by the same code path, and SQLite checks foreign keys as rows
 * arrive - a plain column lets the account row and its characters be created in any order.
 *
 * `is_main` on a character is the one flag the public leaderboard reads: exactly one character per
 * account carries it, and every other character of that account is kept out of the table (see
 * `./leaderboardExclusions`), which is what stops a thirty-alt account from filling it.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bnet_sub TEXT NOT NULL UNIQUE,
  battletag TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  access_token_expires_at INTEGER,
  main_character_id INTEGER,
  /**
   * The column the profile's old Public/Private setting wrote. The setting is gone from the site with
   * nothing reading the flag, and the column is left where it is: the migrations below only ever add
   * (a build that is rolled back still finds every column it selects), so a value nothing asks for is
   * cheaper than a schema change that breaks an older process.
   */
  is_public INTEGER NOT NULL DEFAULT 1,
  /**
   * Whether the account keeps its row out of the Hall of Fame.
   *
   * The table is the one public surface this site has, and a reader who does not want their
   * collections compared there asks for this rather than for privacy: the main is the only character
   * of an account the table ever shows, so this is the switch that decides whether they are in it at
   * all (see server/utils/leaderboardExclusions).
   */
  hide_from_fame INTEGER NOT NULL DEFAULT 0,
  /**
   * Whether the Battle.net sign-in behind this account stopped working.
   *
   * The token endpoint refusing a renewal - a rotated client secret, a grant Battle.net revoked - is the one
   * failure a reader cannot see for themselves: every page still renders from what the site already holds,
   * while the roster and the account's collections quietly stop moving (see server/utils/session). A page
   * that finds this set asks for a fresh sign-in instead of serving figures nobody can place.
   */
  auth_expired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  /**
   * When the account was last seen on the site, to the second, written by the presence heartbeat
   * (see server/utils/presence.ts - named without backticks on purpose: this whole schema is one template
   * literal, and a backtick in a comment inside it ends it). It is what the hall of fame's online dot is
   * read from, and it is the *account's* moment rather than a character's: characters.last_seen_at below is
   * when a character was last read into the table, which is a different fact altogether. An account that has
   * never beaten - or one written before this column existed - leaves it null, which is simply offline.
   */
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_enc TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS characters (
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
  /**
   * When this character's figures were last read from Blizzard, to the second.
   *
   * The snapshots are keyed to the day on purpose (the taken_at column, see ./accountSync), so the
   * day itself cannot say when a reading happened - and a page that printed the day would answer a
   * reader who just pressed Refresh with "20 hours ago". This is that moment, and it is written only
   * where a character is actually read.
   */
  stats_read_at INTEGER,
  UNIQUE (user_id, region, realm_slug, name_key)
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_key ON characters(region, realm_slug, name_key);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  ilvl REAL,
  mplus_score REAL,
  raid_progress INTEGER,
  achievements INTEGER,
  mounts INTEGER,
  pets INTEGER,
  toys INTEGER,
  decor INTEGER,
  reputations INTEGER,
  -- The figures that are not collections of items, read beside them from the same profile (server/utils/blizzard):
  -- the titles and quests a character has earned, the recipes its professions know, the appearance sources its
  -- account has unlocked, and the two figures of its player versus player side.
  --
  -- They are stored as counts, which is what a tile and a row print. The ids the account's unions are taken from
  -- do not live here: they are read by the account sync and folded straight into account_pool
  -- (server/utils/accountSync), which is the one place a union of ids is kept.
  titles INTEGER,
  quests INTEGER,
  recipes INTEGER,
  transmogs INTEGER,
  honorable_kills INTEGER,
  honor_level INTEGER,
  -- The overall rating the six figures above weigh, frozen at write time (see server/utils/playerScore):
  -- the weights change with SCORE_VERSION, and a history point must not silently re-rank behind a reader's
  -- back. Old rows keep NULL - the score cannot be re-derived honestly from a formula that has moved on.
  score INTEGER
);
CREATE INDEX IF NOT EXISTS idx_snapshots_character ON snapshots(character_id, taken_at);

CREATE TABLE IF NOT EXISTS account_pool (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
);
CREATE INDEX IF NOT EXISTS idx_account_pool_kind ON account_pool(user_id, kind);

/**
 * The characters an account remembers: the ones it looked up and the ones it saved with a star for a
 * comparison, which are one record carrying two moments.
 *
 * One row per character rather than two lists, because a character can be both - looked up and starred -
 * and the pair is what the field under a search box draws as one list (see shared/utils/savedCharacters,
 * which owns the shape, the key and the limits this table is cut at). seen_at is when the account last
 * looked the character up and starred_at when it was starred, either of them null: a row with neither is
 * a character nothing remembers any more, and the write that leaves it that way deletes it (see
 * server/utils/savedCharacters).
 *
 * The reader's own browser keeps the same two lists in its own storage; this table is what makes them
 * follow the account rather than the browser, so they are read back on any device the reader signs in on.
 * A foreign key on purpose, unlike main_character_id: nothing writes a saved row before the account exists.
 */
CREATE TABLE IF NOT EXISTS saved_characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_saved_characters_user ON saved_characters(user_id, seen_at, starred_at);
`

/**
 * The columns added after the first release.
 *
 * `ALTER TABLE` has no `IF NOT EXISTS`, so each one is attempted and a failure means the column is
 * already there - which is what keeps a database written by an older build readable by this one.
 */
const ADDED_COLUMNS = [
  'ALTER TABLE snapshots ADD COLUMN reputations INTEGER',
  'ALTER TABLE characters ADD COLUMN avatar TEXT',
  'ALTER TABLE characters ADD COLUMN profession_1 TEXT',
  'ALTER TABLE characters ADD COLUMN profession_2 TEXT',
  // The moment a character's figures were read, which is not the day its snapshot is keyed to.
  'ALTER TABLE characters ADD COLUMN stats_read_at INTEGER',
  // The account's choice not to appear in the public table at all.
  'ALTER TABLE users ADD COLUMN hide_from_fame INTEGER NOT NULL DEFAULT 0',
  // When the account was last seen on the site, which is what the hall of fame's online dot is read from.
  'ALTER TABLE users ADD COLUMN last_seen_at INTEGER',
  // A sign-in that stopped working, which is what the token endpoint refusing a renewal means: the site says
  // so on the reader's own pages rather than leaving a roster that silently stopped moving.
  'ALTER TABLE users ADD COLUMN auth_expired INTEGER NOT NULL DEFAULT 0',
  // The figures that are not collections of items, beside the six the rating weighs (see the note on the
  // `snapshots` table).
  'ALTER TABLE snapshots ADD COLUMN titles INTEGER',
  'ALTER TABLE snapshots ADD COLUMN quests INTEGER',
  'ALTER TABLE snapshots ADD COLUMN recipes INTEGER',
  'ALTER TABLE snapshots ADD COLUMN transmogs INTEGER',
  'ALTER TABLE snapshots ADD COLUMN honorable_kills INTEGER',
  'ALTER TABLE snapshots ADD COLUMN honor_level INTEGER',
  // The overall rating the six figures above weigh, stored so a history point freezes the score that
  // was computed when the reading was taken: the weights change with SCORE_VERSION, and a graph must
  // not silently re-rank old points. Old rows keep NULL - the score cannot be re-derived honestly.
  'ALTER TABLE snapshots ADD COLUMN score INTEGER'
]

/**
 * Brings an existing database up to the schema above.
 *
 * The tables themselves are created by `CREATE TABLE IF NOT EXISTS`, so the only thing left to do
 * is the columns a table that already exists cannot grow on its own.
 */
function migrate(connection: DatabaseSync): void {
  for (const statement of ADDED_COLUMNS) {
    try {
      connection.exec(statement)
    } catch {
      // The column is already there.
    }
  }

  // A unique (character_id, taken_at) makes the event-log writes race-free, but it must never be added
  // over history that already has duplicates - a duplicate is a real snapshot, and a migration must not
  // decide to discard one. The duplicates are counted first: with none the plain index is swapped for a
  // unique one; with some the plain index stays and the process says so rather than failing or deleting.
  const alreadyUnique = connection
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_snapshots_character' AND sql LIKE '%UNIQUE%'")
    .get()

  if (alreadyUnique) return

  const dupes = connection
    .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM snapshots GROUP BY character_id, taken_at HAVING COUNT(*) > 1)')
    .get() as { n: number }

  if (dupes.n === 0) {
    connection.exec('DROP INDEX IF EXISTS idx_snapshots_character')
    connection.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_character ON snapshots(character_id, taken_at)')
  } else {
    console.warn(`[db] snapshots has ${dupes.n} duplicate (character_id, taken_at) groups; the unique index was left off to preserve history`)
  }
}
