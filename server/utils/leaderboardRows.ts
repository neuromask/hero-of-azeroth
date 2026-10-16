/**
 * The hall of fame's rows: the population as a table of its own, and the reads that answer with a page of it.
 *
 * A member of the population (`./statisticsPopulation`) is an **account** or a **guest**, and its row is *derived*
 * - a guest's own newest reading, an account's own newest totals under the identity of the character it leads
 * with. The rows are kept materialised here, one per member, because a page of the table has to be an index scan:
 * with the rows left as a query, SQLite sorted the whole population for every page. Measured at two hundred
 * thousand members that was ~140 ms for the first page and ~1.7 s for the five-thousandth, with `USE TEMP B-TREE
 * FOR ORDER BY` in the plan - the figure a page is ordered by was computed rather than stored, and no index can
 * be built over a join.
 *
 * This module is the only way in and the only way to maintain it:
 *
 *   - the reads - a page, a place, the widgets - answer from the table, ordered by one of its indices;
 *   - the writes that move the population call `refreshGuestRow`, `refreshAccountRow` or `dropGuestRow`, each of
 *     which rewrites the one row that moved and tells the statistics that it has (`bumpStatisticsRevision`);
 *   - `ensurePopulation` builds the whole table when it is empty, and rebuilds it when the rating's weights have
 *     changed (`PRAGMA user_version`) - which is what a fresh deploy and a formula change need, and nothing else.
 */
import { LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
import { metricFigureOf, metricLeaderboardOf } from '#shared/data/leaderboardSchema'
import type { DatabaseSync } from 'node:sqlite'
import type {
  LeaderboardFaction,
  LeaderboardLeader,
  LeaderboardPage,
  LeaderboardPlayer,
  LeaderboardQuery,
  LeaderboardSort,
  LeaderboardStanding,
  LeaderboardStats,
  LeaderboardRealmFacet,
  MetricLeaderboard,
  MetricLeaderboardPage,
  MetricLeaderboardRank,
  MetricLeaderboardRanks,
  MetricLeaderboardScope,
  MetricLeaderboardSlug
} from '#shared/data/leaderboardSchema'
import { SCORE_WEIGHTS } from '#shared/utils/leaderboardScore'
import { totalCollectables, SCORE_VERSION } from './playerScore'
// The regions the site serves, which is what an address segment of a metric page is checked against.
import { isRegion } from './params'
// The season a stored Mythic+ rating is counted in: a score read before the season began counts as nothing.
import { seasonRatingSql } from './mplus'
import { bumpStatisticsRevision, statisticsRevision } from './statisticsPopulation'

/**
 * The rating, as SQL: every category multiplied by its weight and added up.
 *
 * `MAX(x, 0)` is SQLite's scalar maximum, which is the formula's own `value()` - a figure that is missing or
 * nonsensical counts as zero rather than poisoning the sum. The weights are interpolated from the one table that
 * names them, so the query and `calculatePlayerScore` cannot drift apart.
 */
const SCORE_SQL = `ROUND(
  MAX(COALESCE(achievements, 0), 0) * ${SCORE_WEIGHTS.achievements} +
  MAX(COALESCE(mounts, 0), 0) * ${SCORE_WEIGHTS.mounts} +
  MAX(COALESCE(toys, 0), 0) * ${SCORE_WEIGHTS.toys} +
  MAX(COALESCE(decor, 0), 0) * ${SCORE_WEIGHTS.decor} +
  MAX(COALESCE(pets, 0), 0) * ${SCORE_WEIGHTS.pets} +
  MAX(COALESCE(reputations, 0), 0) * ${SCORE_WEIGHTS.reputations}
)`

/**
 * How many collectables a row holds, as SQL: the plain count of mounts, pets, toys and decor that the "king of
 * collections" widget leads on (`totalCollectables` in ./playerScore, whose rule this repeats - a figure that is
 * missing or nonsensical counts as zero).
 */
const COLLECTABLES_SQL = `MAX(COALESCE(mounts, 0), 0) + MAX(COALESCE(pets, 0), 0)
  + MAX(COALESCE(toys, 0), 0) + MAX(COALESCE(decor, 0), 0)`

/**
 * The columns a row is *made of*, in the order both of the shapes below select them: everything a member's own
 * row and reading say. The insert derives two more beside them - the collectables the "king of collections"
 * widget leads on and the rating the table is ordered by (`COLLECTABLES_SQL`, `SCORE_SQL`).
 *
 * One list rather than two strings, because the maintenance compares the row it is about to write with the one
 * that is there (`sameRow`): a comparison that spelled its columns out again would be a comparison that could
 * forget one.
 */
const SOURCE_COLUMN_NAMES = [
  'user_id',
  'region',
  'realm_slug',
  'name_key',
  'realm_name',
  'display_name',
  'avatar',
  'guild',
  'class_id',
  'faction',
  'level',
  'first_seen_at',
  'updated_at',
  'is_account',
  'ilvl',
  'mplus_score',
  'honorable_kills',
  'mounts',
  'pets',
  'toys',
  'decor',
  'reputations',
  'achievements',
  // The five figures a metric leaderboard may rank, in the order the comparison board reads them
  // (`METRIC_LEADERBOARDS` in #shared/data/leaderboardSchema). They are nullable where the six above are not,
  // and that is the whole of how a metric ranking says "no figure read for this member" rather than "zero".
  'titles',
  'quests',
  'recipes',
  'transmogs',
  'honor_level'
] as const

/** Those columns as SQL, for the two reads that compare a row with the one about to replace it. */
const SOURCE_COLUMNS = SOURCE_COLUMN_NAMES.join(', ')

/** Every column of the table, in the order the insert writes them. */
const ROW_COLUMNS = `${SOURCE_COLUMNS}, collectables, score`

/**
 * The side a row plays for, as the table stores it: the API's own spelling folded to the one the filters ask in, and
 * anything else - a character whose side Blizzard will not state - `neutral`, which is a real answer here rather
 * than a missing one (`normalizeFaction` below).
 */
const FACTION_SQL = (column: string): string =>
  `CASE WHEN LOWER(COALESCE(${column}, '')) IN ('alliance', 'horde') THEN LOWER(${column}) ELSE 'neutral' END`

/**
 * A guest's row: the character itself, and its newest reading.
 *
 * A figure the reading does not carry is written as zero rather than left null, which is what the file this table
 * replaces held: a collection nobody has read is a zero in the column, not a missing row - and a null would sort
 * *below* every zero in an order the table is drawn in.
 */
const GUEST_ROWS = (where: string): string => `
  SELECT
    NULL AS user_id,
    c.region AS region,
    c.realm_slug AS realm_slug,
    c.name_key AS name_key,
    COALESCE(c.realm_name, c.realm_slug) AS realm_name,
    COALESCE(c.display_name, c.name) AS display_name,
    c.avatar AS avatar,
    c.guild AS guild,
    COALESCE(c.class_id, 0) AS class_id,
    ${FACTION_SQL('c.faction')} AS faction,
    COALESCE(c.level, 0) AS level,
    c.first_seen_at AS first_seen_at,
    s.taken_at AS updated_at,
    0 AS is_account,
    c.ilvl AS ilvl,
    -- The Mythic+ rating, read in the season Blizzard is running rather than in the one it was read in
    -- (see ./mplus): a score from a season that has passed counts as nothing.
    COALESCE(${seasonRatingSql('s.mplus_score', 's.taken_at')}, 0) AS mplus_score,
    COALESCE(s.honorable_kills, 0) AS honorable_kills,
    COALESCE(s.mounts, 0) AS mounts,
    COALESCE(s.pets, 0) AS pets,
    COALESCE(s.toys, 0) AS toys,
    COALESCE(s.decor, 0) AS decor,
    COALESCE(s.reputations, 0) AS reputations,
    COALESCE(s.achievements, 0) AS achievements,
    -- The five figures a metric leaderboard ranks, copied as the reading holds them: a figure nobody has read
    -- stays NULL, which is what keeps that member out of that one ranking rather than at the bottom of it.
    s.titles AS titles,
    s.quests AS quests,
    s.recipes AS recipes,
    s.transmogs AS transmogs,
    s.honor_level AS honor_level
  FROM characters c
  JOIN snapshots s ON s.id = (
    SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
  )
  WHERE c.user_id IS NULL AND ${where}`

/**
 * An account's row: its own newest totals, under the identity of the character it leads with.
 *
 * The main is the character the account named, or the strongest it has until one is named - the same choice the
 * row was written with when a write path made it, and it is made here so that a row and the account's own page
 * cannot disagree about which character an account is represented by.
 */
const ACCOUNT_ROWS = (where: string): string => `
  SELECT
    u.id AS user_id,
    c.region AS region,
    c.realm_slug AS realm_slug,
    c.name_key AS name_key,
    COALESCE(c.realm_name, c.realm_slug) AS realm_name,
    COALESCE(c.display_name, c.name) AS display_name,
    c.avatar AS avatar,
    -- The guild of the very character this row is named after (the main joined above), never the roster's: a
    -- guild belongs to a character, and the row's identity is one character's.
    c.guild AS guild,
    COALESCE(c.class_id, 0) AS class_id,
    ${FACTION_SQL('c.faction')} AS faction,
    COALESCE(c.level, 0) AS level,
    c.first_seen_at AS first_seen_at,
    a.taken_at AS updated_at,
    1 AS is_account,
    -- The item level of the very character this row is named after (the main joined above), never the roster's
    -- best: an item level is always one character's, so a row shows the one its identity is read from.
    c.ilvl AS ilvl,
    -- The account's Mythic+ rating, which is the highest any of its characters stands at, counted in the season
    -- Blizzard is running (see ./mplus).
    COALESCE(${seasonRatingSql('a.mplus_score', 'a.taken_at')}, 0) AS mplus_score,
    COALESCE(a.honorable_kills, 0) AS honorable_kills,
    COALESCE(a.mounts, 0) AS mounts,
    COALESCE(a.pets, 0) AS pets,
    COALESCE(a.toys, 0) AS toys,
    COALESCE(a.decor, 0) AS decor,
    COALESCE(a.reputations, 0) AS reputations,
    COALESCE(a.achievements, 0) AS achievements,
    -- The five figures a metric leaderboard ranks, read from the account's own totals - the very numbers the
    -- comparison board prints for this character (readAccountTotals in ./accountPool), so a main's place and
    -- the figure beside it are one answer. Left as the totals hold them rather than folded to zero: an account
    -- whose totals have never carried a titles count is unranked in the titles ranking, not last in it.
    a.titles AS titles,
    a.quests AS quests,
    a.recipes AS recipes,
    a.transmogs AS transmogs,
    a.honor_level AS honor_level
  FROM users u
  JOIN account_snapshots a ON a.id = (
    SELECT id FROM account_snapshots WHERE user_id = u.id ORDER BY taken_at DESC LIMIT 1
  )
  JOIN characters c ON c.id = (
    SELECT id FROM characters WHERE user_id = u.id ORDER BY is_main DESC, COALESCE(level, 0) DESC, name ASC LIMIT 1
  )
  WHERE COALESCE(u.hide_from_fame, 0) = 0 AND ${where}`

/**
 * The statement that writes rows of either shape, with the rating and the cap computed from what the row holds.
 *
 * The rating is computed *here* rather than on every read, which is the whole point of the table: a stored column
 * is what an index can order by.
 */
function writeRows(rows: string): string {
  return `INSERT OR REPLACE INTO leaderboard (${ROW_COLUMNS})
          SELECT *, ${COLLECTABLES_SQL}, ${SCORE_SQL} FROM (${rows})`
}

/** The columns a read hands back, named the way a player is read below. */
const READ_COLUMNS = `region, realm_slug AS realm, name_key AS name, realm_name, display_name, avatar, guild, class_id,
  faction, level, first_seen_at, updated_at, is_account, ilvl, mplus_score AS mplus, honorable_kills AS kills,
  mounts, pets, toys, decor, reputations, achievements, titles, quests, recipes, transmogs, honor_level, score`

/** One row as a read hands it back, before it becomes a player. */
interface MemberRow {
  region: string
  realm: string
  name: string
  realm_name: string
  display_name: string
  avatar: string | null
  guild: string | null
  class_id: number
  faction: string
  level: number
  first_seen_at: number | null
  updated_at: number
  is_account: number
  ilvl: number | null
  mplus: number | null
  kills: number | null
  mounts: number | null
  pets: number | null
  toys: number | null
  decor: number | null
  reputations: number | null
  achievements: number | null
  titles: number | null
  quests: number | null
  recipes: number | null
  transmogs: number | null
  honor_level: number | null
  score: number
}

/**
 * The side a row plays for, as the table spells it.
 *
 * The API sends the type in capitals and a stored row may carry it lowercased; anything else - a row written
 * before factions were kept, a character whose side Blizzard will not state - reads as `neutral`, which is a real
 * answer here rather than a missing one, and is what the faction filter leaves out.
 */
export function normalizeFaction(faction?: string): LeaderboardFaction {
  const value = (faction || '').trim().toLowerCase()
  return value === 'alliance' || value === 'horde' ? value : 'neutral'
}

/** A moment as the day it fell on, `YYYY-MM-DD`, which is what a row prints. */
function dayOf(seconds: number | null): string {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : ''
}

/** One member of the population, as the table draws it. */
function toPlayer(row: MemberRow): LeaderboardPlayer {
  return {
    region: row.region,
    realm: row.realm,
    realmName: row.realm_name || row.realm,
    name: row.name,
    displayName: row.display_name || row.name,
    avatar: row.avatar || undefined,
    // A guild the site has never read is left off rather than written as an empty string: a row of a table
    // prints a dash for it, and "" is a guild name nobody could have.
    ...(row.guild ? { guild: row.guild } : {}),
    ...(row.is_account ? { isAccount: true as const } : {}),
    classId: row.class_id ?? 0,
    faction: normalizeFaction(row.faction ?? undefined),
    level: row.level ?? 0,
    ilvl: row.ilvl ?? 0,
    mPlusScore: row.mplus ?? 0,
    honorableKills: row.kills ?? 0,
    mounts: row.mounts ?? 0,
    pets: row.pets ?? 0,
    toys: row.toys ?? 0,
    decor: row.decor ?? 0,
    reputations: row.reputations ?? 0,
    achievements: row.achievements ?? 0,
    // The five figures a metric leaderboard ranks, which are the one part of a row that is allowed to be
    // unknown: `null` here is a member the site has no reading of for that figure, and the ranking of it leaves
    // them out rather than printing a nought nobody measured (`null` on the wire, not `0`).
    titles: row.titles ?? null,
    quests: row.quests ?? null,
    recipes: row.recipes ?? null,
    transmogs: row.transmogs ?? null,
    honorLevel: row.honor_level ?? null,
    score: row.score,
    updatedAt: dayOf(row.updated_at),
    firstSeenAt: dayOf(row.first_seen_at)
  }
}

/**
 * Whether two rows of the table say the same thing, column by column.
 *
 * `null` and a missing column are the same answer - "nothing there" - and everything else is compared as it
 * stands. A row that is absent on one side and present on the other is never the same row.
 */
function sameRow(left: unknown, right: unknown): boolean {
  if (!left || !right) return left === right

  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>

  return SOURCE_COLUMN_NAMES.every((column) => (a[column] ?? null) === (b[column] ?? null))
}

/**
 * One write in one transaction, and a write inside one joins it rather than opening a second.
 *
 * `SAVEPOINT` is what nests: it begins a transaction when none is open and marks a point inside one when it is,
 * so a call made from inside another write cannot turn that write's `COMMIT` into SQLite's "cannot start a
 * transaction within a transaction" - or, worse, have its own `ROLLBACK` undo the outer work. The row writes
 * below are called both from a request path and from one another (`fileDailyReading` files a point and then
 * rewrites the guest's row), which is exactly the case this exists for.
 */
function transact(work: () => void): void {
  const db = useDb()

  db.exec('SAVEPOINT leaderboard_row')
  try {
    work()
    db.exec('RELEASE leaderboard_row')
  } catch (error) {
    db.exec('ROLLBACK TO leaderboard_row')
    db.exec('RELEASE leaderboard_row')
    throw error
  }
}

/**
 * Rewrites one guest's row, or removes it when the character is not a member of the population any more.
 *
 * Called by the writes that move a guest: a reading filed for a character no account holds (`./characterReading`),
 * and - through `dropGuestRow` - a character an account has claimed, which stops being a member of its own the
 * moment it is one.
 *
 * The row is taken out and written back in one transaction, so a reader never sees the member missing and a
 * write that fails leaves the row that was there. That matters more here than it looks: the table's version
 * stamp would still say it was current after a half-done write, so nothing would ever rebuild the row a failure
 * had dropped (`ensurePopulation`).
 *
 * A row that would say exactly what the row already says is left alone, and the revision is not moved: this is
 * called on every reading a guest is given, and moving the revision without a change would keep the
 * leaderboard's own hour-long cache (`server/api/leaderboard`) from ever being reused.
 */
export function refreshGuestRow(region: string, realm: string, name: string): void {
  // A table this build has not built yet is not maintained row by row: the next read of it builds the whole of
  // it from the very rows this write would have gone into (`populationIsCurrent`).
  if (!populationIsCurrent()) return

  const db = useDb()
  const address = [region.toLowerCase(), realm.toLowerCase(), name.toLowerCase()]
  const where = 'c.region = ? AND c.realm_slug = ? AND c.name_key = ?'

  const stored = db
    .prepare(
      `SELECT ${SOURCE_COLUMNS} FROM leaderboard
        WHERE user_id IS NULL AND region = ? AND realm_slug = ? AND name_key = ?`
    )
    .get(...address)

  const next = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM (${GUEST_ROWS(where)})`).get(...address)

  if (sameRow(stored, next)) return

  transact(() => {
    // Deleted first, so that a character that has left the population - claimed by an account, taken out of the
    // table with it - leaves nothing behind; then written back, if it is still a member.
    db.prepare('DELETE FROM leaderboard WHERE user_id IS NULL AND region = ? AND realm_slug = ? AND name_key = ?').run(...address)
    db.prepare(writeRows(GUEST_ROWS(where))).run(...address)
  })

  bumpStatisticsRevision()
}

/**
 * Rewrites one account's row, or removes it when the account is not in the table any more.
 *
 * Called by the writes that move an account: its totals moved (`./accountSync`), its main was named
 * (`/api/profile/main`), it asked to be left out of the table (`/api/profile/fame`), a character of it was claimed
 * (`./profileFeed`). The row is found by the account rather than by an address, because naming a different main
 * changes the address the row is written under.
 *
 * A row that would say exactly what the row already says is left alone, and the revision is not moved - the same
 * reason the guest's row is (`refreshGuestRow`): this is called on every character read an account is given, and
 * a write that moved the revision without changing a figure would keep the table's cache from ever being reused.
 * The comparison is what makes that safe: the row is still read from the character the account leads with, so a
 * change to *that* character - its item level, its level, its portrait, its name - moves the row even when not a
 * single collection did (`./accountPool`).
 */
export function refreshAccountRow(userId: number): void {
  // The same as a guest's row: nothing is maintained in a table this build has not built yet (`populationIsCurrent`).
  if (!populationIsCurrent()) return

  const db = useDb()

  const stored = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM leaderboard WHERE user_id = ?`).get(userId)
  const next = db.prepare(`SELECT ${SOURCE_COLUMNS} FROM (${ACCOUNT_ROWS('u.id = ?')})`).get(userId)

  if (sameRow(stored, next)) return

  transact(() => {
    db.prepare('DELETE FROM leaderboard WHERE user_id = ?').run(userId)
    db.prepare(writeRows(ACCOUNT_ROWS('u.id = ?'))).run(userId)
  })

  bumpStatisticsRevision()
}

/**
 * Takes a member out of the table without writing it back, which is what a claim does to a guest's row.
 *
 * The revision moves whether or not a row was there to take out, and that is deliberate: the population moved
 * when the character changed owner, and the table is only one of the aggregates keyed on that revision - a
 * distribution and a history are read from the same rows and must not be answered from before the claim just
 * because the character's row had not been materialised yet (`./statisticsPopulation`).
 */
export function dropGuestRow(region: string, realm: string, name: string): void {
  useDb()
    .prepare('DELETE FROM leaderboard WHERE user_id IS NULL AND region = ? AND realm_slug = ? AND name_key = ?')
    .run(region.toLowerCase(), realm.toLowerCase(), name.toLowerCase())

  bumpStatisticsRevision()
}

/**
 * The version of the rows the table holds, stamped beside the weights' own (`PRAGMA application_id`, next to the
 * `user_version` `SCORE_VERSION` is kept in).
 *
 * A row is a materialised copy of a member - the collections, the rating and the item level, frozen so that an
 * index can order by them (`./db`) - so a build that changes *what a row holds* leaves every row written by the
 * older build saying something the site no longer means, while the weights' stamp still matches and the table is
 * served as it is. Bumping this is the one-line way to say so: the next process to start rebuilds the population
 * once (`ensurePopulation`), exactly as a changed weight does.
 *
 * 2: an account's row carries the item level of the main it is named after rather than the best gear on its
 *    roster, which is what the row had been written with.
 *
 * 3: a row carries the guild of the character it is named after and the five figures a metric leaderboard
 *    ranks (`titles`, `quests`, `recipes`, `transmogs`, `honor_level`), which a row written by an older build
 *    simply does not hold - a metric page read from those rows would find every one of them unranked.
 */
export const ROW_VERSION = 3

/**
 * Rebuilds every row from the database, which is what a fresh database and a changed formula need.
 *
 * The version the rows were rated with is kept in the database's own header (`PRAGMA user_version`), so a process
 * that starts against a table written by an older formula knows to rebuild it rather than serve a table ordered by
 * a rating nobody computes any more. Answers how many rows the population holds.
 *
 * It is the one write here that touches the whole population, and it is paid once: measured at two hundred thousand
 * members it takes ~14 s on a developer's machine, nearly all of it the thirteen indices being maintained row by
 * row. That is why the site builds the table at startup rather than leaving the first reader to pay for it
 * (`server/plugins/statisticsMigration`).
 */
export function rebuildPopulation(): number {
  const db = useDb()

  // One transaction, so that a reader sees the table as it was or the table as it is and never a half of it: the
  // rows are removed and written back in one go, and a rebuild that fails leaves what was there rather than an
  // empty table (the version stamp below is what tells the next caller to try again).
  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM leaderboard')
    db.prepare(writeRows(GUEST_ROWS('1 = 1'))).run()
    db.prepare(writeRows(ACCOUNT_ROWS('1 = 1'))).run()
    db.exec(`PRAGMA user_version = ${SCORE_VERSION}`)
    db.exec(`PRAGMA application_id = ${ROW_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  bumpStatisticsRevision()

  return (db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get() as { n: number }).n
}

/**
 * Whether the table holds the population as this build means it.
 *
 * One question, asked by both ends of the maintenance: the read that builds the whole table when it is stale
 * (`ensurePopulation`) and the writes that keep one row of it true (`refreshGuestRow`, `refreshAccountRow`). A
 * write into a table this build has not built yet is a row thrown away a moment later - the next read rebuilds
 * the whole of it from the very rows the write would have gone into - and a revision moved for a change nobody
 * ever saw, which is why the writes ask this first rather than after.
 *
 * The answer is two header fields, which is what makes asking it cheap: the weights' version (`user_version`,
 * `SCORE_VERSION`) and the row's own (`application_id`, `ROW_VERSION`).
 */
function populationIsCurrent(): boolean {
  const db = useDb()

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const { application_id: rows } = db.prepare('PRAGMA application_id').get() as { application_id: number }

  return version === SCORE_VERSION && rows === ROW_VERSION
}

/**
 * Makes sure the table holds the population before anything reads it.
 *
 * Two things can leave it stale, and both are one-off costs paid on the first read after they happen:
 *
 *   - a fresh database, whose header carries no version yet - every deploy of a new database, and every test;
 *   - a rating whose weights have changed (`SCORE_VERSION`) or a row whose content has (`ROW_VERSION`), which is
 *     a rebuild for the same reason the write path used to re-rate every row.
 *
 * Everything else is maintained as it moves, by the writes above, so this is a header read on the steady path.
 */
export function ensurePopulation(): void {
  if (populationIsCurrent()) return

  rebuildPopulation()
}

/**
 * The order each sort draws the table in, as SQL: the figure the order is about, then the rating, then the name
 * without case.
 *
 * Written expression for expression as the indices the table carries (`./db`), which is what makes a page an index
 * scan: SQLite walks one of them and stops after a page's worth of rows rather than sorting the population. The
 * tie-breakers are the ones a reader expects - equal figures are settled by the overall rating, equal ratings by
 * the name - so a page cannot reshuffle between two reads of it.
 */
const RATING_ORDER = 'score DESC'
const NAME_ORDER = 'display_name COLLATE NOCASE ASC'

const SORT_COLUMNS: Record<LeaderboardSort, string> = {
  total: `${RATING_ORDER}, ${NAME_ORDER}`,
  mounts: `mounts DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  decor: `decor DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  mplus: `mplus_score DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  kills: `honorable_kills DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  achievements: `achievements DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  pets: `pets DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  toys: `toys DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  reputations: `reputations DESC, ${RATING_ORDER}, ${NAME_ORDER}`
}

/** The order the "king of collections" widget leads by: the count of collectables, which is stored for it. */
const COLLECTABLES_ORDER = `collectables DESC, ${RATING_ORDER}, ${NAME_ORDER}`

/** Whether a caller's order is one the table offers, so that a query string can be trusted with it. */
export function isSort(value: unknown): value is LeaderboardSort {
  return typeof value === 'string' && (LEADERBOARD_SORTS as readonly string[]).includes(value)
}

/** The sides the facet lists, in the order the chips are drawn; `neutral` last, and only when it holds anybody. */
const FACTION_ORDER: readonly LeaderboardFaction[] = ['alliance', 'horde', 'neutral']

/**
 * The filter a query asks for, as SQL, and the values it binds.
 *
 * Every fragment is written against the materialised row rather than against the character or the account behind
 * it, so a filter costs nothing beyond the scan it is applied to. A fragment a caller did not ask for is simply
 * absent: an empty query is the whole table.
 */
function whereClause(query: LeaderboardQuery): { where: string; params: (string | number)[] } {
  const clauses: string[] = []
  const params: (string | number)[] = []

  // A region, which only a metric leaderboard's own scope names (`LeaderboardQuery.region`): a code this build
  // does not serve keeps nobody rather than everybody, because a caller that asked for `xx` did not ask for the
  // world - and a realm below it means nothing without the region that identifies it.
  const region = (query.region || '').trim().toLowerCase()
  if (region) {
    if (!isRegion(region)) return { where: 'WHERE 0 = 1', params: [] }
    clauses.push('region = ?')
    params.push(region)
  }

  if (query.faction && query.faction !== 'all') {
    clauses.push('faction = ?')
    params.push(normalizeFaction(query.faction))
  }

  const realm = (query.realm || '').trim().toLowerCase()
  if (realm) {
    clauses.push('realm_slug = ?')
    params.push(realm)
  }

  const classId = typeof query.classId === 'number' ? query.classId : Number(query.classId)
  if (Number.isFinite(classId) && classId > 0) {
    clauses.push('class_id = ?')
    params.push(classId)
  }

  // The name as it is stored - already folded to lower case, the way the address is keyed - so a search for a
  // fragment of it is a substring of one column. `instr` rather than `LIKE`, so that a wildcard a reader types
  // means nothing, and a Cyrillic fragment is found by the same comparison an ASCII one is.
  const search = (query.q || '').trim().toLowerCase()
  if (search) {
    clauses.push('instr(name_key, ?) > 0')
    params.push(search)
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}


/**
 * One page of the table: the rows the query keeps, ordered, counted and sliced - and the day the newest of them was
 * written, so a reader can judge how fresh the answer is.
 *
 * The count and the page are one query each, both against the same filter, and the page is a `LIMIT` over an index:
 * a caller asking for the five-thousandth page pays for the walk to it rather than for sorting the population. A
 * page past the end is the last page rather than an empty answer, which is what keeps a stale link to `?page=900`
 * from reading as a table that lost its rows.
 */
export function readLeaderboardPage(query: LeaderboardQuery, perPage: number): Omit<LeaderboardPage, 'stats'> {
  const db = useDb()
  ensurePopulation()

  const sort: LeaderboardSort = isSort(query.sort) ? query.sort : 'total'
  const { where, params } = whereClause(query)
  const size = Math.max(1, Math.floor(perPage))

  const counted = db
    .prepare(`SELECT COUNT(*) AS total, MAX(updated_at) AS newest FROM leaderboard ${where}`)
    .get(...params) as { total: number; newest: number | null }

  const pages = Math.max(1, Math.ceil(counted.total / size))
  const page = Math.min(pages, Math.max(1, Math.floor(query.page || 1)))

  const rows = db
    .prepare(`SELECT ${READ_COLUMNS} FROM leaderboard ${where} ORDER BY ${SORT_COLUMNS[sort]} LIMIT ? OFFSET ?`)
    .all(...params, size, (page - 1) * size) as unknown as MemberRow[]

  return {
    players: rows.map(toPlayer),
    total: counted.total,
    page,
    perPage: size,
    pages,
    sort,
    updatedAt: dayOf(counted.newest)
  }
}

/**
 * Where one member stands in the overall table, or nothing at all for a character the table does not draw.
 *
 * The place is counted by the table itself - how many members sort strictly above this one, plus one - and the
 * comparison is the page's own order written as a predicate: the rating first, then the name without case
 * (`SORT_COLUMNS.total`). The two therefore cannot disagree about who is ahead of whom, which is the property a
 * place has to have, and it is why the order below is spelled out here rather than derived from the page's.
 *
 * Counted rather than numbered, and that is a measurement rather than a taste: a window function has to number
 * the whole population for every reader - at two hundred thousand members, 329 ms of SQL against 9 ms, and the
 * synchronous driver means that is the event loop blocked for a third of a second per call. This walks the index
 * only as far as the character's own row (`idx_leaderboard_total`). The one difference a reader can see is a tie:
 * two members with the same rating *and* the same name share a place rather than being given two arbitrary ones,
 * which is what a tie means.
 *
 * The address is compared as it is stored, folded to lower case: a caller arrives with the name a page printed, and
 * a row is keyed by the name an address carries.
 */
export function readLeaderboardStanding(
  character: Pick<LeaderboardPlayer, 'region' | 'realm' | 'name'>
): LeaderboardStanding | null {
  const db = useDb()
  ensurePopulation()

  const row = db
    .prepare(`SELECT ${READ_COLUMNS} FROM leaderboard WHERE region = ? AND realm = ? AND name = ?`)
    .get(character.region.toLowerCase(), character.realm.toLowerCase(), character.name.toLowerCase()) as
    | MemberRow
    | undefined

  if (!row) return null

  const { above } = db
    .prepare(
      `SELECT COUNT(*) AS above FROM leaderboard
        WHERE score > ? OR (score = ? AND display_name < ? COLLATE NOCASE)`
    )
    .get(row.score, row.score, row.display_name) as { above: number }

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM leaderboard').get() as { total: number }

  return { player: toPlayer(row), rank: above + 1, total }
}

/**
 * The row leading one figure, or nothing when nobody holds any of it.
 *
 * A leader is read off the table's own order rather than by taking the largest figure out of the population: that
 * order is an index, so the row is the first one SQLite finds, and the number a widget prints is read off the very
 * row it is about. A figure nobody holds - a table where no decor has been counted at all - is answered with no
 * leader rather than with a row of zeroes, which would name somebody for holding nothing.
 */
function readLeader(
  column: string,
  order: string,
  figure: (player: LeaderboardPlayer) => number
): LeaderboardLeader | null {
  const row = useDb()
    .prepare(`SELECT ${READ_COLUMNS}, ${column} AS leading FROM leaderboard ORDER BY ${order} LIMIT 1`)
    .get() as (MemberRow & { leading: number | null }) | undefined

  if (!row) return null

  const player = toPlayer(row)
  const value = figure(player)

  return value > 0 ? { player, value } : null
}

/**
 * The order one metric leaderboard is drawn in, as SQL: the figure it ranks, then the rating, then the name
 * without case - the table's own order - and then the three segments a row is keyed by.
 *
 * That last part is not decoration. A ranking is a *total* order: a page and a place have to be the same
 * ranking, and a count of the rows above a member can only agree with the page if the two name the same
 * comparison down to the last tie. The rating settles two members with the same figure; the name settles two
 * with the same rating; and the address settles the two that are still equal - the same name on two realms,
 * which is a real pair of members and not a duplicate. Without it the database would be free to order those
 * two either way on either read, and a reader's place would move while they looked at it.
 *
 * Written expression for expression as the indices in `./db` (`LEADERBOARD_ORDER_TAIL`), which is what keeps a
 * page an index scan rather than a sort of the population.
 */
export function metricOrder(metric: MetricLeaderboard): string {
  const lead = `${metric.column} DESC`
  const tail = [RATING_ORDER, NAME_ORDER, 'region ASC', 'realm_slug ASC', 'name_key ASC']

  return [lead, ...tail.filter((term) => term !== lead)].join(', ')
}

/**
 * The comparison that says a row sorts strictly above one member, as SQL.
 *
 * It is the order above, written as a predicate - and the only honest way to count a place without numbering
 * the whole population, which is a window function SQLite pays for with a scan of everybody
 * (`readLeaderboardStanding` measured the two). A member's place is one more than the number of rows the
 * comparison keeps.
 *
 * The six alternatives are one term of the order each, and they are written *flat* - a chain of `AND`s joined by
 * one `OR` - rather than nested, which is what the order's tail looks like when it is transcribed literally. A
 * flat chain is a shape SQLite turns into a handful of index seeks (its "multi-index OR"); the same comparison
 * with an `OR` inside an `OR` makes the planner give up and count the whole index instead. At two hundred thousand
 * members that is the difference between 4 ms and 40 ms for one place, and the plan of either is printed by the
 * load test.
 */
function metricAboveSql(column: string): string {
  return `(
    ${column} > ? OR
    (${column} = ? AND score > ?) OR
    (${column} = ? AND score = ? AND display_name < ? COLLATE NOCASE) OR
    (${column} = ? AND score = ? AND display_name = ? COLLATE NOCASE AND region < ?) OR
    (${column} = ? AND score = ? AND display_name = ? COLLATE NOCASE AND region = ? AND realm_slug < ?) OR
    (${column} = ? AND score = ? AND display_name = ? COLLATE NOCASE AND region = ? AND realm_slug = ? AND name_key < ?)
  )`
}

/**
 * The values that predicate binds, in the order the six alternatives read them: the figure for the first, the
 * figure and the rating for the second, and one more term of the address for each alternative after it.
 */
function metricAboveValues(player: LeaderboardPlayer, value: number): (string | number)[] {
  const name = player.displayName || player.name
  const { score, region, realm } = player

  return [
    value,
    value,
    score,
    value,
    score,
    name,
    value,
    score,
    name,
    region,
    value,
    score,
    name,
    region,
    realm,
    value,
    score,
    name,
    region,
    realm,
    player.name
  ]
}

/** The scope a query names, echoed back the way a page prints it: a region, and the realm inside it. */
function scopeOf(query: LeaderboardQuery): MetricLeaderboardScope {
  const region = (query.region || '').trim().toLowerCase()
  const realm = (query.realm || '').trim().toLowerCase()

  return {
    ...(region ? { region } : {}),
    ...(region && realm ? { realm } : {})
  }
}

/**
 * The realm menus read so far, each with the revision of the data it was read at (`statisticsRevision`).
 *
 * A menu is small - one row per realm - so the map is bounded by the rankings and scopes in play rather than by the
 * population: thirteen figures, each with a world menu and one per region, and the oldest entry is dropped when the
 * cap is reached, exactly as the distribution's own memo does (`server/utils/characterReading`).
 */
const realmsMemo = new Map<string, { revision: number; realms: LeaderboardRealmFacet[] }>()

/** How many menus are kept before the oldest is dropped. One per ranking and scope, with room to spare. */
const REALMS_MEMO_LIMIT = 64

/**
 * The realms one ranking holds members in, as the realm menu of its filter bar reads them.
 *
 * Read over the *region* the page is scoped to rather than over the realm it shows: a reader standing on
 * `eu/gordunni` is offered the other realms of EU - the siblings of the one they are looking at - and a reader on
 * the world page is offered every realm of both regions. The faction and the name a reader has typed are
 * deliberately not part of it, for the reason the front door's own facet is not narrowed by its chips: the menu
 * is about the population the table could show, not about the slice of it currently on screen.
 *
 * `realm_name` is left out although the front door's facet carries it: the column is not part of the covering
 * index, so reading it would fetch every row of the scope to see a name - and the site's own realm list already
 * names a realm in the language being read (`app/composables/realmNames.ts`), which is what the menu prints
 * anyway.
 *
 * It is memoised per ranking and scope, for the reason the widgets are memoised
 * (`getGlobalStats` in `./leaderboardStorage`): the menu of every page of one ranking is the same menu, the pass
 * that builds it is the only read here that has to sort (`GROUP BY` over a figure's index), and a burst of readers
 * should pay for it once. A write that moves the population moves the revision the memo is keyed on, so a menu can
 * never be a menu of a table that has moved.
 */
function readMetricRealms(db: DatabaseSync, metric: MetricLeaderboard, scope: MetricLeaderboardScope): LeaderboardRealmFacet[] {
  const memoKey = `${metric.slug}|${scope.region || '*'}`
  const at = statisticsRevision()
  const answered = realmsMemo.get(memoKey)

  if (answered && answered.revision === at) return answered.realms

  const { where, params } = whereClause({ region: scope.region })

  const realms = throughMetricIndex(
    db,
    metric,
    (from) =>
      `SELECT region, realm_slug AS realm, '' AS realmName, COUNT(*) AS count ${from}
        ${where || 'WHERE 1 = 1'} AND ${metric.column} IS NOT NULL
        GROUP BY region, realm_slug ORDER BY count DESC, region ASC, realm_slug ASC`,
    (statement) => statement.all(...params) as unknown as LeaderboardRealmFacet[]
  )

  realmsMemo.set(memoKey, { revision: at, realms })
  if (realmsMemo.size > REALMS_MEMO_LIMIT) {
    const oldest = realmsMemo.keys().next().value
    if (oldest !== undefined) realmsMemo.delete(oldest)
  }

  return realms
}

/**
 * One page of one metric leaderboard: the members that hold a figure for the metric, ordered by it and sliced.
 *
 * The population of a metric ranking is narrower than the table's, and deliberately: a member whose row holds no
 * figure for this metric is not a member with none of it, and placing them at the bottom would be the site
 * inventing a nought nobody measured (NULL in ./db, and the note on the leaderboard table). So the read keeps the
 * rows that hold a figure and nothing else - the count, the page and the place of a member all name the same
 * population, which is the property a place has to have.
 *
 * The scope is a LeaderboardQuery and nothing else: the world names no region, a region names its own, and a
 * realm names its region beside its slug, so `gordunni` in EU is one realm rather than every realm of that name
 * (whereClause above).
 *
 * The rows are read *through* the ranking's own index (`INDEXED BY`, and `MetricLeaderboard.index` for why): the
 * page is one ordered walk of it, stopping after a page's worth of rows that the scope keeps. Left to itself,
 * SQLite answers a scoped page by filtering with the realm index and sorting what is left - correct, and ten times
 * the cost of the walk at two hundred thousand members. The count above is deliberately *not* pinned: counting a
 * scope is what the realm index is for, and the planner's own choice there is the right one.
 *
 * A database that does not have that index at all - the migration that writes it reports the failure it hit rather
 * than throwing (`migrateLeaderboardIndexes`) - cannot be read through it, and SQLite says so by refusing the
 * statement. That is answered with the same query without the directive rather than with a 500: a slower page is a
 * great deal better than no page.
 */
export function readMetricLeaderboardPage(
  metric: MetricLeaderboard,
  query: LeaderboardQuery,
  perPage: number
): MetricLeaderboardPage {
  const db = useDb()
  ensurePopulation()

  const { where, params } = whereClause(query)
  const ranked = `${where || 'WHERE 1 = 1'} AND ${metric.column} IS NOT NULL`
  const size = Math.max(1, Math.floor(perPage))

  const counted = throughMetricIndex(
    db,
    metric,
    (from) => `SELECT COUNT(*) AS total, MAX(updated_at) AS newest ${from} ${ranked}`,
    (statement) => statement.get(...params) as { total: number; newest: number | null }
  )

  const pages = Math.max(1, Math.ceil(counted.total / size))
  const page = Math.min(pages, Math.max(1, Math.floor(query.page || 1)))

  const order = `ORDER BY ${metricOrder(metric)} LIMIT ? OFFSET ?`
  const values = [...params, size, (page - 1) * size]

  const rows = throughMetricIndex(
    db,
    metric,
    (from) => `SELECT ${READ_COLUMNS} ${from} ${ranked} ${order}`,
    (statement) => statement.all(...values) as unknown as MemberRow[]
  )

  return {
    slug: metric.slug,
    scope: scopeOf(query),
    players: rows.map(toPlayer),
    total: counted.total,
    page,
    perPage: size,
    pages,
    realms: readMetricRealms(db, metric, scopeOf(query)),
    updatedAt: dayOf(counted.newest)
  }
}

/**
 * How many characters one ranks request answers for, which is what a comparison board can name: its two sides,
 * and a little room beside them. The same bound the distribution endpoint keeps (`server/api/distribution`), and
 * for the same reason - a caller cannot turn one request into a walk of the population.
 */
export const RANK_KEYS_LIMIT = 4

/**
 * Answers one read of a metric's rows, through the metric's own index where the database has it.
 *
 * The index is the difference between an in-index walk and a table lookup per row. `region = 'eu' AND mounts IS NOT
 * NULL` is answered by the realm index and then has to fetch eighty thousand rows to see whether they hold a
 * figure, where the same question asked of the covering metric index is answered by walking it once: at two hundred
 * thousand members, 12 ms against 90 ms for the count of a region, and 22 ms against 190 ms for a page of one
 * (`test/bench` measures each of them). So every statement below that knows which metric it is about is prepared
 * against that metric's index rather than left to the planner.
 *
 * A database that does not have the index at all - the migration that writes it reports the failure it hit rather
 * than throwing (`migrateLeaderboardIndexes` in ./db) - cannot answer a statement prepared against it, and SQLite
 * says so outright ("no query solution"). That is answered with the very same statement without the directive,
 * because a slower page is a great deal better than no page.
 */
function throughMetricIndex<T>(
  db: DatabaseSync,
  metric: MetricLeaderboard,
  build: (from: string) => string,
  run: (statement: ReturnType<DatabaseSync['prepare']>) => T
): T {
  const from = (indexed: boolean) => (indexed ? `FROM leaderboard INDEXED BY ${metric.index}` : 'FROM leaderboard')

  try {
    return run(db.prepare(build(from(true))))
  } catch (error) {
    console.warn(
      `[leaderboard] ${metric.slug} was read without its own index: ${error instanceof Error ? error.message : String(error)}`
    )

    return run(db.prepare(build(from(false))))
  }
}

/**
 * Where the characters a caller named stand in one metric's three rankings - the world, their own region and
 * their own realm - in one answer.
 *
 * Three places rather than one, because that is what a reader of a comparison board is shown: a figure means
 * little on its own, and the same figure means three different things among everybody, among the region's
 * players and among a single realm's. All three are read from the same rows and the same order as the page
 * (`readMetricLeaderboardPage`), so a place and the page it opens cannot disagree.
 *
 * A character is answered for whether or not they are in the population. A key the table does not hold is
 * `participating: false` with no places at all - an alt that is neither its account's main nor a guest row of its
 * own is not in the table, and inventing a place for it would be the site answering a question about a member
 * that does not exist. The population sizes are still reported, because they are facts about the *ranking*
 * rather than about the character: a reader is told how many hold a figure, which is what makes an absent place
 * read as "not in this ranking" rather than as an error.
 *
 * The populations are memoised per scope within one call, so two characters of one realm pay for that realm's
 * population once - and the places are counted against the index the page itself is read from.
 */
export function readMetricRanks(metric: MetricLeaderboard, keys: string[]): MetricLeaderboardRanks {
  const db = useDb()
  ensurePopulation()

  /** The rows a scope ranks, as the `WHERE` of every count below: the scope's, and a figure held. */
  const ranked = (scope: MetricLeaderboardScope): { where: string; params: string[] } => {
    const { where, params } = whereClause({ region: scope.region, realm: scope.realm })
    return { where: `${where || 'WHERE 1 = 1'} AND ${metric.column} IS NOT NULL`, params: params as string[] }
  }

  const populations = new Map<string, number>()

  /** How many members hold a figure in one scope, counted once per scope per call. */
  const population = (scope: MetricLeaderboardScope): number => {
    const id = `${scope.region || '*'}|${scope.realm || '*'}`
    const known = populations.get(id)
    if (known !== undefined) return known

    const { where, params } = ranked(scope)
    const counted = throughMetricIndex(
      db,
      metric,
      (from) => `SELECT COUNT(*) AS n ${from} ${where}`,
      (statement) => (statement.get(...params) as { n: number }).n
    )

    populations.set(id, counted)
    return counted
  }

  /** One member's place in one scope, which the scope's own count of the rows above them is. */
  const place = (scope: MetricLeaderboardScope, player: LeaderboardPlayer, value: number): number => {
    const { where, params } = ranked(scope)
    const above = metricAboveSql(metric.column)
    const values = [...params, ...metricAboveValues(player, value)]

    const counted = throughMetricIndex(
      db,
      metric,
      (from) => `SELECT COUNT(*) AS above ${from} ${where} AND ${above}`,
      (statement) => (statement.get(...values) as { above: number }).above
    )

    return counted + 1
  }

  const worldTotal = population({})

  const players = keys.slice(0, RANK_KEYS_LIMIT).map((key): MetricLeaderboardRank => {
    const [region = '', realm = '', ...rest] = key.split(':')
    const name = rest.join(':')

    const row = db
      .prepare(`SELECT ${READ_COLUMNS} FROM leaderboard WHERE region = ? AND realm = ? AND name = ?`)
      .get(region, realm, name) as MemberRow | undefined

    // A region and a realm are only rankings at all when the key names a region this build serves: a realm slug
    // on its own names no realm (`MetricLeaderboardScope`).
    const inRegion = isRegion(region)
    const regionTotal = inRegion ? population({ region }) : 0
    const realmTotal = inRegion ? population({ region, realm }) : 0

    if (!row) {
      return {
        key,
        participating: false,
        value: null,
        worldRank: null,
        regionRank: null,
        realmRank: null,
        worldTotal,
        regionTotal,
        realmTotal
      }
    }

    const player = toPlayer(row)
    const value = metricFigureOf(player, metric.metric)

    return {
      key,
      participating: true,
      player,
      value,
      worldRank: value === null ? null : place({}, player, value),
      regionRank: value === null || !inRegion ? null : place({ region }, player, value),
      realmRank: value === null || !inRegion ? null : place({ region, realm }, player, value),
      worldTotal,
      regionTotal,
      realmTotal
    }
  })

  const { newest } = db.prepare('SELECT MAX(updated_at) AS newest FROM leaderboard').get() as {
    newest: number | null
  }

  return { slug: metric.slug, players, updatedAt: dayOf(newest) }
}

/**
 * The row leading one of the site's rankings, which is what a widget about that figure prints.
 *
 * Read through the ranking's own order (`metricOrder`), so the member a widget names is the member standing *first*
 * on the page that figure's ranking opens with - and the read is the index seek that order is backed by (`./db`)
 * rather than a sort of the population. A figure nobody holds is no leader at all, which is the honest answer for a
 * table backfilled from pages nobody has opened (`readLeader`).
 */
function readMetricLeader(slug: MetricLeaderboardSlug): LeaderboardLeader | null {
  const metric = metricLeaderboardOf(slug)
  if (!metric) return null

  return readLeader(metric.column, metricOrder(metric), (player) => metricFigureOf(player, metric.metric) ?? 0)
}

/**
 * The figures behind the widgets, gathered in one pass over the population.
 *
 * Everything here is an aggregate over the table as a whole - how many members it holds, how many realms and classes
 * they are spread over, who leads each figure, what everybody has gathered between them, and the facets the filters
 * are built from - and none of it can be answered from a page: a widget counting the population has to count all of
 * it. That is why the storage memoises the whole object per revision of the data (`./leaderboardStorage`) rather
 * than letting every reader pay for the pass.
 *
 * A member with no class - a character nobody has read a class for - is not a class: it is left out of the class
 * facet and the class count rather than gathered under an id no page can name.
 */
export function readGlobalStats(): LeaderboardStats {
  const db = useDb()
  ensurePopulation()

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS players,
         COUNT(DISTINCT region || '/' || realm_slug) AS realms,
         COUNT(DISTINCT CASE WHEN class_id > 0 THEN class_id END) AS classes,
         COALESCE(SUM(mounts), 0) AS mounts,
         COALESCE(SUM(pets), 0) AS pets,
         COALESCE(SUM(toys), 0) AS toys,
         COALESCE(SUM(decor), 0) AS decor,
         COALESCE(SUM(reputations), 0) AS reputations,
         COALESCE(SUM(achievements), 0) AS achievements,
         MAX(updated_at) AS newest
       FROM leaderboard`
    )
    .get() as {
    players: number
    realms: number
    classes: number
    mounts: number
    pets: number
    toys: number
    decor: number
    reputations: number
    achievements: number
    newest: number | null
  }

  const classesFacet = db
    .prepare(
      `SELECT class_id AS classId, COUNT(*) AS count
       FROM leaderboard WHERE class_id > 0 GROUP BY class_id ORDER BY count DESC, class_id ASC`
    )
    .all() as { classId: number; count: number }[]

  const realmsFacet = db
    .prepare(
      `SELECT region, realm_slug AS realm, COALESCE(MAX(realm_name), realm_slug) AS realmName, COUNT(*) AS count
       FROM leaderboard GROUP BY region, realm_slug ORDER BY count DESC, realm_slug ASC`
    )
    .all() as { region: string; realm: string; realmName: string; count: number }[]

  const factionsFacet = (
    db.prepare('SELECT faction, COUNT(*) AS count FROM leaderboard GROUP BY faction').all() as {
      faction: string
      count: number
    }[]
  )
    .map((row) => ({ faction: normalizeFaction(row.faction), count: row.count }))
    .filter((faction) => faction.count > 0)
    .sort((left, right) => FACTION_ORDER.indexOf(left.faction) - FACTION_ORDER.indexOf(right.faction))

  const top = classesFacet[0]

  return {
    players: totals.players,
    realms: totals.realms,
    classes: totals.classes,
    topClass: top
      ? { classId: top.classId, count: top.count, share: Math.round((top.count / totals.players) * 100) }
      : null,
    collector: readLeader('collectables', COLLECTABLES_ORDER, totalCollectables),
    architect: readMetricLeader('decor'),
    pets: readMetricLeader('pets'),
    toys: readMetricLeader('toys'),
    mounts: readMetricLeader('mounts'),
    reputations: readMetricLeader('reputations'),
    titles: readMetricLeader('titles'),
    transmogs: readMetricLeader('transmogs'),
    totals: {
      mounts: totals.mounts,
      pets: totals.pets,
      toys: totals.toys,
      decor: totals.decor,
      reputations: totals.reputations,
      achievements: totals.achievements
    },
    updatedAt: dayOf(totals.newest),
    realmsFacet,
    classesFacet,
    factionsFacet
  }
}

