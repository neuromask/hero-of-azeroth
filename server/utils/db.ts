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
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Where the database lives: the folder the JSON stores use, resolved against the run directory. */
const DB_FILE = resolve(process.cwd(), 'server/data', 'hoa.db')

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
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
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
  reputations INTEGER
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
  'ALTER TABLE users ADD COLUMN hide_from_fame INTEGER NOT NULL DEFAULT 0'
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
}
