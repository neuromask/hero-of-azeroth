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
 *
 * `characters.user_id` is nullable, and that is what a guest is: a character the site has read whose
 * owner has never signed in. Its readings are the site's own record of it - the history a comparison
 * board draws - so the row has to exist without an account behind it (`./profileFeed` writes one).
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
  -- The account that holds this character, or NULL for a guest: a character the site has read whose owner has
  -- never signed in. A guest row carries the site's own record of that character - the readings its history is
  -- drawn from - and every account-wide read is keyed by user_id or joins users, so a guest is invisible to all
  -- of them by itself. See ./profileFeed for what writes one.
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  realm_name TEXT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  display_name TEXT,
  class_id INTEGER,
  level INTEGER,
  /**
   * The item level the character was wearing when it was last read, which is a fact about the character rather
   * than a figure of its readings.
   *
   * Written the way the level above is: a profile read knows both, and both are things a character *is* rather
   * than things it has gathered (./characterReading writes this one beside stats_read_at). The site draws no
   * history of an item level - it climbs with gear and drops with a season, so a curve of it says nothing - and
   * that is why it is not one of the snapshot's metrics (see #shared/data/historySchema). A read that does not
   * carry one leaves what is here alone, exactly as the readings keep a figure they do not carry.
   */
  ilvl REAL,
  faction TEXT,
  avatar TEXT,
  profession_1 TEXT,
  profession_2 TEXT,
  is_main INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  /**
   * When the site first met this character, as seconds since the epoch, which no later lookup can tell.
   *
   * The hall of fame's table marks a row with the day it first appeared, and this is where that answer comes
   * from: the table's rows are read from these rows and the readings beside them (see ./leaderboardStorage), so
   * a field a row prints has to live here. It is written once, when the row is created, and never moved again -
   * a character looked up a hundred times was still first seen on one day.
   */
  first_seen_at INTEGER,
  /**
   * When this character's figures were last read from Blizzard, to the second.
   *
   * The readings beside this row are filed for the moment they were taken rather than for the day they belong
   * to (the taken_at column, see ./characterReading), so the day cannot say when a reading happened - and a
   * page that printed a day would answer a reader who just pressed Refresh with "20 hours ago". This is that
   * moment, and it is written only where a character is actually read.
   */
  stats_read_at INTEGER,
  UNIQUE (user_id, region, realm_slug, name_key)
);
CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id);
CREATE INDEX IF NOT EXISTS idx_characters_key ON characters(region, realm_slug, name_key);
-- A guest's address is unique on its own. UNIQUE (user_id, ...) cannot hold two NULL owners together - SQLite
-- reads every NULL as distinct - so without this a character read twice would be two rows, and its readings
-- would be split between them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_guest ON characters(region, realm_slug, name_key) WHERE user_id IS NULL;

-- One reading of one character: what its profile said when the site read it. A point is filed for the moment it
-- was taken and only when the figures have moved, so this is a character's real history rather than one row a day
-- (see ./characterReading). It is what a tile prints, what a page weighs a live Blizzard answer against, and what
-- a history and a distribution are drawn from (./statisticsPopulation).
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  mplus_score REAL,
  -- Read by nothing: the raid progress a profile used to carry. Kept where it is because a build that is rolled
  -- back still finds every column it selects - the migrations here only ever add (see migrate above).
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

-- The account's own figures over time, one point per change. The unit the statistics are counted over is the
-- *account* rather than its characters (see ./statisticsPopulation), so an account's history is kept here: a
-- character's own readings are one character's record - what a tile prints and what a page weighs a live
-- reading against - and every character of an account shows the account's numbers instead.
--
-- The figures are the account's totals (readAccountTotals in ./accountPool), which is what the hall of fame's
-- row for its main prints. The levels are deliberately not all the same aggregate, and each is named where it
-- is computed: the collections are the best of the pool's union and the roster's readings, reputations are the
-- pool's union alone, the item level, the rating and the honor level are the highest any character of the
-- account stands at, the wardrobe is the account's own document, and honorable kills are the *sum* over its
-- characters.
CREATE TABLE IF NOT EXISTS account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
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
-- A point is one change, and two writes inside one second must not become two points of one account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_snapshots_user ON account_snapshots(user_id, taken_at);

-- The population of the hall of fame, one row per member, materialised.
--
-- The rows are derived - a guest's own newest reading, an account's own newest totals under the identity of the
-- character it leads with (see ./statisticsPopulation, ./leaderboardRows) - and they are kept here because a
-- *page* of the table has to be an index scan rather than a sort of everybody. Reading the population as a query
-- was measured at two hundred thousand members: SQLite answered a first page in ~140 ms and a five-thousandth
-- page in ~1.7 s, with a temporary B-tree for the ordering in the plan, because the figure a page is ordered by is
-- computed rather than stored and no index can be built over a join. A row per member with the rating computed
-- once, at write time, is what makes the ten orders below plain indices.
--
-- The table is maintained by the writes that move the population - a reading filed, an account's totals moved, a
-- character claimed by an account, a main named, an account hidden (see ./leaderboardRows) - and rebuilt from
-- scratch when it is empty or when the rating's weights have changed (PRAGMA user_version carries the version
-- the stored ratings were computed with). Nothing reads it directly: ./leaderboardRows is the only way in.
CREATE TABLE IF NOT EXISTS leaderboard (
  -- The account whose row this is, or NULL for a guest's own: what the maintenance finds a row by when the
  -- account's identity moves (a main renamed, an account that left the table), since the address below is the
  -- key and changes with it.
  user_id INTEGER,
  region TEXT NOT NULL,
  realm_slug TEXT NOT NULL,
  name_key TEXT NOT NULL,
  realm_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar TEXT,
  class_id INTEGER NOT NULL DEFAULT 0,
  faction TEXT NOT NULL DEFAULT 'neutral',
  -- What the character *is*, read from its own row and from its newest reading: the level as the game reports it
  -- and the item level it wears. Both are materialised here for the same reason everything else is - a page of the
  -- table is drawn without touching the characters or the readings at all - and the item level is not an order the
  -- table offers (it is read beside the level under a row's name, see ./leaderboardRows), which is why nothing
  -- indexes it.
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
  -- How many collectables a row holds altogether - mounts, pets, toys and decor - which is what the "king of
  -- collections" widget leads on (see totalCollectables in ./playerScore). Stored for the same reason the rating is:
  -- it is a sum over four columns, so no index can order by it, and the widget would otherwise sort the
  -- population on every read.
  collectables INTEGER NOT NULL DEFAULT 0,
  -- The overall rating, computed from the figures above at write time (see ./playerScore): a stored column is
  -- what an index can order by, and the whole point of this table.
  score INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (region, realm_slug, name_key)
);
-- One index per order the page offers, each carrying the tie-breakers the table is drawn in: the preset's figure,
-- then the rating, then the name without case. LIMIT then stops after a page's worth of rows instead of sorting
-- the population, which is what these exist for.
CREATE INDEX IF NOT EXISTS idx_leaderboard_total ON leaderboard(score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_mounts ON leaderboard(mounts DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_pets ON leaderboard(pets DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_toys ON leaderboard(toys DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_decor ON leaderboard(decor DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_reputations ON leaderboard(reputations DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_mplus ON leaderboard(mplus_score DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_kills ON leaderboard(honorable_kills DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_achievements ON leaderboard(achievements DESC, score DESC, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_leaderboard_collectables ON leaderboard(collectables DESC, score DESC, display_name COLLATE NOCASE);
-- The filters: a realm chip and a class chip are the two the page draws, and each is worth an index of its own
-- because a filtered page still has to be ordered - the index above cannot be used for both at once.
CREATE INDEX IF NOT EXISTS idx_leaderboard_realm ON leaderboard(region, realm_slug);
CREATE INDEX IF NOT EXISTS idx_leaderboard_class ON leaderboard(class_id);
-- And the account behind a row, which is how the maintenance finds the row an account's own identity moved on.
CREATE INDEX IF NOT EXISTS idx_leaderboard_user ON leaderboard(user_id);

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
  // The day the site first met a character, which the hall of fame's table prints and no later lookup can tell.
  'ALTER TABLE characters ADD COLUMN first_seen_at INTEGER',
  // The item level a character was wearing, which is a fact about the character rather than a figure of its
  // readings: the site draws no history of it, and a row of the table reads it beside the level.
  'ALTER TABLE characters ADD COLUMN ilvl REAL',
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
 * Gives `characters` a nullable `user_id`, so the site can keep a character it has only read.
 *
 * A character page is a lookup by anyone, signed in or not, and the figures it returns are the site's own
 * record of that character - the history a comparison board draws. Keeping them needs a row, and a row used to
 * need an owner: with `user_id NOT NULL` a stranger's reading had nowhere to go (`./profileFeed`), so only the
 * characters of accounts that had signed in were ever filed. A guest row is that same row with no owner, and
 * every account-wide read is keyed by `user_id` or joins `users` - so a guest is invisible to the roster, the
 * pools, the presence dot and the exclusions without any of them being told about guests at all.
 *
 * SQLite cannot drop a `NOT NULL`, so the table is rebuilt, by the recipe SQLite's own documentation gives for
 * a change `ALTER TABLE` cannot make: the new table is filled from the old one, the old one is dropped, the new
 * one takes its name - all inside one transaction and with foreign keys off, so dropping `characters` cannot
 * cascade into the readings that point at it. The indexes and the unique constraint go back on afterwards, and
 * `foreign_key_check` is what says the rebuilt table is still the one `snapshots` refers to. A database this
 * cannot be done to is left exactly as it was, and the process says so: a migration must never be the reason a
 * site comes up without its history.
 *
 * Exported for the test that builds a database written by the older build and migrates it (`test/unit`): the
 * one thing that must not go wrong here is the reading of somebody's rows.
 */
export function migrateCharacterOwnership(connection: DatabaseSync): void {
  const columns = connection.prepare('PRAGMA table_info(characters)').all() as unknown as {
    name: string
    notnull: number
  }[]

  const owner = columns.find((column) => column.name === 'user_id')
  // Nothing to do: no table at all (a fresh database, created by the schema above) or one already rebuilt.
  if (!owner || owner.notnull === 0) return

  connection.exec('PRAGMA foreign_keys = OFF')

  try {
    connection.exec('BEGIN')

    connection.exec(`CREATE TABLE characters_migration (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      region TEXT NOT NULL,
      realm_slug TEXT NOT NULL,
      realm_name TEXT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      display_name TEXT,
      class_id INTEGER,
      level INTEGER,
      -- The item level the character wears, which this build keeps on the character rather than on its readings
      -- (the added-columns list adds it before this runs, so an older table has it by now). It has to be named
      -- here: the copy below writes every column the old table has, and a rebuilt table without one of them is a
      -- copy that fails outright - which is how a database that predates guests was left with a user_id it
      -- could not do without, and no guest could ever be filed into it.
      ilvl REAL,
      faction TEXT,
      avatar TEXT,
      profession_1 TEXT,
      profession_2 TEXT,
      is_main INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER NOT NULL,
      first_seen_at INTEGER,
      stats_read_at INTEGER,
      UNIQUE (user_id, region, realm_slug, name_key)
    )`)

    // Only the columns both tables have. `ADDED_COLUMNS` runs before this, so a column this build knows and the
    // old table has just been added and must be carried; a column the rebuilt table has never heard of must not
    // be the reason the whole rebuild is abandoned - a migration may never be why a site comes up without its
    // history. What cannot be carried is named rather than dropped in silence.
    const rebuilt = new Set(
      (connection.prepare('PRAGMA table_info(characters_migration)').all() as unknown as { name: string }[]).map(
        (column) => column.name
      )
    )
    const carried = columns.map((column) => column.name).filter((name) => rebuilt.has(name))
    const left = columns.map((column) => column.name).filter((name) => !rebuilt.has(name))

    if (left.length) {
      console.warn(`[db] the rebuild of characters cannot carry ${left.join(', ')}`)
    }

    const names = carried.join(', ')
    connection.exec(`INSERT INTO characters_migration (${names}) SELECT ${names} FROM characters`)
    connection.exec('DROP TABLE characters')
    connection.exec('ALTER TABLE characters_migration RENAME TO characters')

    connection.exec('CREATE INDEX IF NOT EXISTS idx_characters_user ON characters(user_id)')
    connection.exec('CREATE INDEX IF NOT EXISTS idx_characters_key ON characters(region, realm_slug, name_key)')
    connection.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_characters_guest ON characters(region, realm_slug, name_key) WHERE user_id IS NULL'
    )

    const broken = connection.prepare('PRAGMA foreign_key_check').all()
    if (broken.length) throw new Error(`${broken.length} broken reference(s) after the rebuild`)

    connection.exec('COMMIT')
  } catch (error) {
    try {
      connection.exec('ROLLBACK')
    } catch {
      // Nothing was begun, so there is nothing to undo.
    }

    console.warn(`[db] characters was left as it was: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    connection.exec('PRAGMA foreign_keys = ON')
  }
}

/**
 * Drops the columns this build has taken away from a table.
 *
 * Three of them, and each left for a reason that has gone:
 *
 *   - `leaderboard.capped`, which carried the item-level order the table no longer offers - the item level is read
 *     beside the level under a row's name (`shared/data/leaderboardSchema`);
 *   - `snapshots.ilvl` and `account_snapshots.ilvl`, which held an item level per reading. The site draws no
 *     history and no distribution of an item level - it climbs with gear and drops with a season, so a curve of it
 *     says nothing - and the figure is a fact about the character now (`characters.ilvl`), written beside its level.
 *
 * A database that has them is asked first - a fresh one is created without any of them (`CREATE TABLE` above) - and
 * one that does not is left exactly as it is, which is the rule every migration here follows. A database the
 * change cannot be made to keeps them, which costs a number a row and is read by nobody.
 *
 * The item level is *moved* before it is dropped, and that is the one part of this migration that is not a
 * removal: `snapshots.ilvl` holds the only copy of a figure the site still prints, so each character takes the
 * newest reading that carried one before the readings lose the column. Without that step every character would
 * come out of this wearing nothing and would stay that way until its next profile read - the hall of fame's table
 * and an account's page print that figure, and a dash for a character the site has known for months is a loss the
 * migration made rather than one it found. The account's own copy is not moved anywhere: it was the best gear
 * among its characters, which is no one character's, and an account has no item level of its own any more
 * (`./accountPool`).
 *
 * Exported for the test that builds a database written by the older build and migrates it (`test/unit`).
 */
export function migrateRemovedColumns(connection: DatabaseSync): void {
  const hasColumn = (table: string, column: string): boolean =>
    (connection.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).some(
      (entry) => entry.name === column
    )

  // Asked only while the reading still holds the column: on the next start there is nothing to move, and a
  // statement against a column that is gone would be a warning on every boot for a migration already done.
  if (hasColumn('snapshots', 'ilvl') && hasColumn('characters', 'ilvl')) {
    try {
      connection.exec(
        `UPDATE characters SET ilvl = (
           SELECT s.ilvl FROM snapshots s
            WHERE s.character_id = characters.id AND s.ilvl IS NOT NULL
            ORDER BY s.taken_at DESC LIMIT 1)
         WHERE ilvl IS NULL
           AND EXISTS (SELECT 1 FROM snapshots s WHERE s.character_id = characters.id AND s.ilvl IS NOT NULL)`
      )
    } catch (error) {
      console.warn(`[db] characters kept no item level: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const dropped: Array<{ table: string; column: string; index?: string }> = [
    { table: 'leaderboard', column: 'capped', index: 'idx_leaderboard_ilvl' },
    { table: 'snapshots', column: 'ilvl' },
    { table: 'account_snapshots', column: 'ilvl' }
  ]

  for (const { table, column, index } of dropped) {
    if (!hasColumn(table, column)) continue

    try {
      if (index) connection.exec(`DROP INDEX IF EXISTS ${index}`)
      connection.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
    } catch (error) {
      console.warn(
        `[db] ${table} kept its ${column} column: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

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

  // A table a column cannot be added to is rebuilt here, before anything else reads it.
  migrateCharacterOwnership(connection)

  // And the columns this build has taken *away* from a table.
  migrateRemovedColumns(connection)

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
