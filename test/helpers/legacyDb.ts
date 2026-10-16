/**
 * The shapes an older build of this site wrote, built on disk for the migration tests.
 *
 * `upgradeFromBackup.test.ts` replays an upgrade against the site's own backups, which is the strongest thing a
 * migration test can do - and the one thing a fresh clone cannot run, because those backups are one developer's
 * and are not in the repository. This helper is the same coverage without them: the shapes that matter, built
 * from a few lines of schema and a handful of synthetic rows, with nothing of anybody's in it.
 *
 *   1. `pre-guests` - the build before a character could belong to nobody: `characters.user_id NOT NULL`, no
 *      `account_snapshots`, no materialised `leaderboard`;
 *   2. `guests-no-stats` - guests supported and the table not yet a table: a database half-way through this
 *      migration, which is what a build that was interrupted leaves;
 *   3. `capped-table` - the build whose `leaderboard` still carried `capped` and whose header carried no row
 *      version, so the table has to be rebuilt rather than served as it is.
 *
 * The rows are deliberately awkward where the migration has to be careful: an account with two characters whose
 * **alt wears better gear than its main** (which is what the item level of a row is read from), and a guest the
 * site met that nobody signed in for. Every moment is a fixed second in 2023, so a test can name it.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
// The weights' version this build rates with, which the older build's header already carried: the fixture says
// so, so that the only thing forcing a rebuild is the row version the older build never wrote.
import { SCORE_VERSION } from '../../server/utils/playerScore'

/** The three shapes, named as the file that documents them names them. */
export type LegacyShape = 'pre-guests' | 'guests-no-stats' | 'capped-table'

/** The second every fixture moment is, so a test can name it rather than compute it. */
export const FIXTURE_AT = 1_700_000_000
export const FIXTURE_DAY = '2023-11-14'

/** The account every fixture holds, and the two characters it leads with. */
export const FIXTURE_USER = 1
export const FIXTURE_MAIN = { id: 11, name: 'Mainchar', ilvl: 320, mounts: 100 }
export const FIXTURE_ALT = { id: 12, name: 'Altchar', ilvl: 350, mounts: 200 }
export const FIXTURE_GUEST = { id: 13, name: 'Guestchar', ilvl: 300, mounts: 50 }

/** The two columns a character's ownership is written with, per shape. */
const OWNERSHIP = {
  'pre-guests': { user_id: 'INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE', firstSeen: '' },
  'guests-no-stats': { user_id: 'INTEGER REFERENCES users(id) ON DELETE CASCADE', firstSeen: 'first_seen_at INTEGER,' },
  'capped-table': { user_id: 'INTEGER REFERENCES users(id) ON DELETE CASCADE', firstSeen: 'first_seen_at INTEGER,' }
} as const

/** The six collections every fixture reading carries, so a point is complete and an account gets its totals. */
function reading(mounts: number): Record<string, number> {
  return { mounts, pets: 40, toys: 30, decor: 20, reputations: 5, achievements: 1000 }
}

/**
 * Writes one shape into `dir` and answers the path of the database it wrote.
 *
 * The connection is closed before it is handed back: the migration opens the same file as the site does, and a
 * second writer left open on Windows is a file the test runner cannot remove afterwards.
 */
export function writeLegacyDatabase(dir: string, shape: LegacyShape): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'hoa.db')

  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(schema(shape))

  if (shape === 'capped-table') {
    db.exec(ACCOUNT_SNAPSHOTS)
    db.exec(CAPPED_LEADERBOARD)
  }

  db.prepare('INSERT INTO users (id, bnet_sub, battletag) VALUES (?, ?, ?)').run(
    FIXTURE_USER,
    'bnet-sub-1',
    'Test#1'
  )

  const firstSeen = shape === 'pre-guests' ? '' : ', first_seen_at'
  const firstSeenValue = shape === 'pre-guests' ? '' : `, ${FIXTURE_AT}`
  const character = db.prepare(
    `INSERT INTO characters
       (id, user_id, region, realm_slug, realm_name, name, name_key, display_name, class_id, level, faction, avatar,
        is_main, last_seen_at, stats_read_at${firstSeen})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${firstSeenValue})`
  )

  character.run(
    FIXTURE_MAIN.id, FIXTURE_USER, 'eu', 'gordunni', 'Gordunni', FIXTURE_MAIN.name, 'mainchar', 'Mainchar',
    1, 90, 'alliance', 'avatar-main.jpg', 1, FIXTURE_AT, FIXTURE_AT
  )
  character.run(
    FIXTURE_ALT.id, FIXTURE_USER, 'eu', 'gordunni', 'Gordunni', FIXTURE_ALT.name, 'altchar', 'Altchar',
    3, 80, 'horde', 'avatar-alt.jpg', 0, FIXTURE_AT, FIXTURE_AT
  )

  if (shape !== 'pre-guests') {
    character.run(
      FIXTURE_GUEST.id, null, 'eu', 'silvermoon', 'Silvermoon', FIXTURE_GUEST.name, 'guestchar', 'Guestchar',
      11, 90, 'alliance', 'avatar-guest.jpg', 0, FIXTURE_AT, FIXTURE_AT
    )
  }

  const snapshot = db.prepare(
    `INSERT INTO snapshots
       (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations, titles)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const [id, figures] of [
    [FIXTURE_MAIN.id, { ...reading(FIXTURE_MAIN.mounts), ilvl: FIXTURE_MAIN.ilvl }],
    [FIXTURE_ALT.id, { ...reading(FIXTURE_ALT.mounts), ilvl: FIXTURE_ALT.ilvl }],
    [FIXTURE_GUEST.id, { ...reading(FIXTURE_GUEST.mounts), ilvl: FIXTURE_GUEST.ilvl }]
  ] as [number, Record<string, number>][]) {
    if (shape === 'pre-guests' && id === FIXTURE_GUEST.id) continue

    snapshot.run(
      id, FIXTURE_AT, figures.ilvl, 0, figures.achievements, figures.mounts, figures.pets, figures.toys,
      figures.decor, figures.reputations, 10
    )
  }

  if (shape === 'capped-table') {
    // The account's own point, as the older build kept it: with an item level of its own (the best gear on the
    // roster), which this build has taken away.
    db.prepare(
      `INSERT INTO account_snapshots
         (user_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(FIXTURE_USER, FIXTURE_AT, FIXTURE_ALT.ilvl, 0, 1000, FIXTURE_ALT.mounts, 40, 30, 20, 5, 0)

    // And its row, written the old way: under the alt's address (the best gear led) and with the cap flag.
    db.prepare(
      `INSERT INTO leaderboard
         (user_id, region, realm_slug, name_key, realm_name, display_name, class_id, faction, level, first_seen_at,
          updated_at, is_account, ilvl, mounts, pets, toys, decor, reputations, achievements, collectables, score, capped)
       VALUES (?, 'eu', 'gordunni', 'altchar', 'Gordunni', 'Altchar', 3, 'horde', 80, ?, ?, 1, ?, ?, 40, 30, 20, 5, 1000, 290, 0, 1)`
    ).run(FIXTURE_USER, FIXTURE_AT, FIXTURE_AT, FIXTURE_ALT.ilvl, FIXTURE_ALT.mounts)

    // The header the older build left: the weights' version it rated with, and no row version at all.
    db.exec(`PRAGMA user_version = ${SCORE_VERSION}`)
    db.exec('PRAGMA application_id = 0')
  }

  db.close()
  return path
}


/** The schema every shape shares: the account, its characters, and their readings. */
function schema(shape: LegacyShape): string {
  const ownership = OWNERSHIP[shape]

  return `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bnet_sub TEXT NOT NULL UNIQUE,
  battletag TEXT
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id ${ownership.user_id},
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
  ${ownership.firstSeen}
  stats_read_at INTEGER,
  UNIQUE (user_id, region, realm_slug, name_key)
);
CREATE INDEX idx_characters_user ON characters(user_id);
CREATE INDEX idx_characters_key ON characters(region, realm_slug, name_key);

CREATE TABLE snapshots (
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
  titles INTEGER,
  quests INTEGER,
  recipes INTEGER,
  transmogs INTEGER,
  honorable_kills INTEGER,
  honor_level INTEGER
);
CREATE INDEX idx_snapshots_character ON snapshots(character_id, taken_at);
`
}

/** The account's own totals, which only the build whose table is already a table knows how to keep. */
const ACCOUNT_SNAPSHOTS = `
CREATE TABLE account_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
`

/** The table as it was before this build: an item-level order, and the flag it was drawn under. */
const CAPPED_LEADERBOARD = `
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
CREATE INDEX idx_leaderboard_total ON leaderboard(score DESC, display_name COLLATE NOCASE);
CREATE INDEX idx_leaderboard_ilvl ON leaderboard(capped, ilvl DESC);
CREATE INDEX idx_leaderboard_user ON leaderboard(user_id);
`
