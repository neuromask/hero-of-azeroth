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
import { CURRENT_MAX_LEVEL, LEADERBOARD_SORTS } from '#shared/data/leaderboardSchema'
import type {
  LeaderboardFaction,
  LeaderboardLeader,
  LeaderboardPage,
  LeaderboardPlayer,
  LeaderboardQuery,
  LeaderboardSort,
  LeaderboardStanding,
  LeaderboardStats
} from '#shared/data/leaderboardSchema'
import { SCORE_WEIGHTS } from '#shared/utils/leaderboardScore'
import { totalCollectables, SCORE_VERSION } from './playerScore'
import { bumpStatisticsRevision } from './statisticsPopulation'

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

/** Whether a row stands at the level cap, which is the one rule an item level is printed under. */
const CAPPED_SQL = `CASE WHEN COALESCE(level, 0) >= ${CURRENT_MAX_LEVEL} THEN 1 ELSE 0 END`

/** The columns a row carries, in the order both of the shapes below select them, and the three the insert derives. */
const ROW_COLUMNS = `user_id, region, realm_slug, name_key, realm_name, display_name, avatar, class_id, faction,
  level, first_seen_at, updated_at, is_account, ilvl, mplus_score, honorable_kills, mounts, pets, toys, decor,
  reputations, achievements, collectables, score, capped`

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
    COALESCE(c.class_id, 0) AS class_id,
    ${FACTION_SQL('c.faction')} AS faction,
    COALESCE(c.level, 0) AS level,
    c.first_seen_at AS first_seen_at,
    s.taken_at AS updated_at,
    0 AS is_account,
    s.ilvl AS ilvl,
    COALESCE(s.mplus_score, 0) AS mplus_score,
    COALESCE(s.honorable_kills, 0) AS honorable_kills,
    COALESCE(s.mounts, 0) AS mounts,
    COALESCE(s.pets, 0) AS pets,
    COALESCE(s.toys, 0) AS toys,
    COALESCE(s.decor, 0) AS decor,
    COALESCE(s.reputations, 0) AS reputations,
    COALESCE(s.achievements, 0) AS achievements
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
    COALESCE(c.class_id, 0) AS class_id,
    ${FACTION_SQL('c.faction')} AS faction,
    COALESCE(c.level, 0) AS level,
    c.first_seen_at AS first_seen_at,
    a.taken_at AS updated_at,
    1 AS is_account,
    a.ilvl AS ilvl,
    COALESCE(a.mplus_score, 0) AS mplus_score,
    COALESCE(a.honorable_kills, 0) AS honorable_kills,
    COALESCE(a.mounts, 0) AS mounts,
    COALESCE(a.pets, 0) AS pets,
    COALESCE(a.toys, 0) AS toys,
    COALESCE(a.decor, 0) AS decor,
    COALESCE(a.reputations, 0) AS reputations,
    COALESCE(a.achievements, 0) AS achievements
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
          SELECT *, ${COLLECTABLES_SQL}, ${SCORE_SQL}, ${CAPPED_SQL} FROM (${rows})`
}

/** The columns a read hands back, named the way a player is read below. */
const READ_COLUMNS = `region, realm_slug AS realm, name_key AS name, realm_name, display_name, avatar, class_id,
  faction, level, first_seen_at, updated_at, is_account, ilvl, mplus_score AS mplus, honorable_kills AS kills,
  mounts, pets, toys, decor, reputations, achievements, score`

/** One row as a read hands it back, before it becomes a player. */
interface MemberRow {
  region: string
  realm: string
  name: string
  realm_name: string
  display_name: string
  avatar: string | null
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
    score: row.score,
    updatedAt: dayOf(row.updated_at),
    firstSeenAt: dayOf(row.first_seen_at)
  }
}

/**
 * Rewrites one guest's row, or removes it when the character is not a member of the population any more.
 *
 * Called by the writes that move a guest: a reading filed for a character no account holds (`./characterReading`),
 * and - through `dropGuestRow` - a character an account has claimed, which stops being a member of its own the
 * moment it is one.
 */
export function refreshGuestRow(region: string, realm: string, name: string): void {
  const db = useDb()
  const address = [region.toLowerCase(), realm.toLowerCase(), name.toLowerCase()]

  // Deleted first, so that a character that has left the population - claimed by an account, taken out of the
  // table with it - leaves nothing behind; then written back, if it is still a member.
  db.prepare('DELETE FROM leaderboard WHERE user_id IS NULL AND region = ? AND realm_slug = ? AND name_key = ?').run(...address)
  db.prepare(writeRows(GUEST_ROWS('c.region = ? AND c.realm_slug = ? AND c.name_key = ?'))).run(...address)

  bumpStatisticsRevision()
}

/**
 * Rewrites one account's row, or removes it when the account is not in the table any more.
 *
 * Called by the writes that move an account: its totals moved (`./accountSync`), its main was named
 * (`/api/profile/main`), it asked to be left out of the table (`/api/profile/fame`), a character of it was claimed
 * (`./profileFeed`). The row is found by the account rather than by an address, because naming a different main
 * changes the address the row is written under.
 */
export function refreshAccountRow(userId: number): void {
  const db = useDb()

  db.prepare('DELETE FROM leaderboard WHERE user_id = ?').run(userId)
  db.prepare(writeRows(ACCOUNT_ROWS('u.id = ?'))).run(userId)

  bumpStatisticsRevision()
}

/** Takes a member out of the table without writing it back, which is what a claim does to a guest's row. */
export function dropGuestRow(region: string, realm: string, name: string): void {
  const db = useDb()

  db.prepare('DELETE FROM leaderboard WHERE user_id IS NULL AND region = ? AND realm_slug = ? AND name_key = ?')
    .run(region.toLowerCase(), realm.toLowerCase(), name.toLowerCase())

  bumpStatisticsRevision()
}

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
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  bumpStatisticsRevision()

  return (db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get() as { n: number }).n
}

/**
 * Makes sure the table holds the population before anything reads it.
 *
 * Two things can leave it stale, and both are one-off costs paid on the first read after they happen:
 *
 *   - a fresh database, whose header carries no version yet - every deploy of a new database, and every test;
 *   - a rating whose weights have changed (`SCORE_VERSION`), which is a rebuild for the same reason the write path
 *     used to re-rate every row.
 *
 * Everything else is maintained as it moves, by the writes above, so this is a header read on the steady path.
 */
export function ensurePopulation(): void {
  const db = useDb()

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (version === SCORE_VERSION) return

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
  reputations: `reputations DESC, ${RATING_ORDER}, ${NAME_ORDER}`,
  ilvl: `capped DESC, ilvl DESC, ${RATING_ORDER}, ${NAME_ORDER}`
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
 * The place is counted by the table itself - a window function numbering the population in the very order the page
 * is drawn in, read back at one address - rather than by asking how many rows sort above the character: the two
 * orders are one expression, so a place and a page cannot disagree about who is ahead of whom.
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
    .prepare(
      `SELECT * FROM (
         SELECT ${READ_COLUMNS}, ROW_NUMBER() OVER (ORDER BY ${SORT_COLUMNS.total}) AS rank
         FROM leaderboard
       )
       WHERE region = ? AND realm = ? AND name = ?`
    )
    .get(character.region.toLowerCase(), character.realm.toLowerCase(), character.name.toLowerCase()) as
    | (MemberRow & { rank: number })
    | undefined

  if (!row) return null

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM leaderboard').get() as { total: number }

  return { player: toPlayer(row), rank: row.rank, total }
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
         COALESCE(SUM(achievements), 0) AS achievements
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
    rating: readLeader('mplus_score', SORT_COLUMNS.mplus, (player) => player.mPlusScore),
    architect: readLeader('decor', SORT_COLUMNS.decor, (player) => player.decor),
    totals: {
      mounts: totals.mounts,
      pets: totals.pets,
      toys: totals.toys,
      decor: totals.decor,
      reputations: totals.reputations,
      achievements: totals.achievements
    },
    realmsFacet,
    classesFacet,
    factionsFacet
  }
}

