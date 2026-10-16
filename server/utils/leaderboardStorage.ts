/**
 * The hall of fame's table: what a page asks for, and what it is answered with.
 *
 * The rows are the hall of fame's own table in the database (`./leaderboardRows`) - one row per member of the
 * population (`./statisticsPopulation`), materialised and maintained as it moves, filtered, ordered, counted and
 * sliced by SQLite. This module is the rest of what a caller needs: the bounds a page may ask for, the memo of the
 * widgets, and the stamp an endpoint's cache is keyed on.
 *
 * It is deliberately thin, and what is not here is the point. What used to live in this file was a document of
 * records in `server/data`, a snapshot of the whole of it in memory, a write path that merged a profile into a
 * row, a sitemap backfill and a comparator that ordered an array - all of it replaced by the query, because a
 * table that is read from a database has no business holding itself in a process.
 */
import type {
  CharacterRanks,
  LeaderboardPage,
  LeaderboardPlayer,
  LeaderboardQuery,
  LeaderboardStanding,
  LeaderboardStats,
  MetricLeaderboard,
  MetricLeaderboardPage,
  MetricLeaderboardRanks
} from '#shared/data/leaderboardSchema'
import { METRIC_LEADERBOARDS } from '#shared/data/leaderboardSchema'
import {
  readGlobalStats,
  readLeaderboardPage,
  readLeaderboardStanding,
  readMetricLeaderboardPage,
  readMetricRanks
} from './leaderboardRows'
import { migrateStatistics } from './statisticsMigration'
import { statisticsRevision } from './statisticsPopulation'

/** How many players a page holds when a caller does not say, and the bounds a caller may ask for. */
export const DEFAULT_PER_PAGE = 25
const MIN_PER_PAGE = 5
const MAX_PER_PAGE = 100

/** The widgets' figures, and the revision of the data they were gathered at. */
let statsMemo: LeaderboardStats | null = null
let statsStamp = -1

/**
 * A stamp of the table's own data, which is what an endpoint's cache is keyed on.
 *
 * The revision moves on every write that changes what the table draws - a reading filed, an account's totals
 * moved, a character claimed by an account, a main named, an account hidden (`./statisticsPopulation`) - and the
 * stamp is that number read out loud. An answer cached under one stamp is unreachable under the next, which is
 * what keeps a reader from being served a table an hour behind the site.
 */
export function leaderboardDataStamp(): string {
  return String(statisticsRevision())
}

/**
 * One page of the table, with the widgets riding along - one request, not two.
 *
 * The migration that moves the site's old table into the database is awaited first (`./statisticsMigration`): it
 * is a no-op on every call but the first of a process, and a page read before it has run would be a page with
 * rows missing.
 */
export async function getLeaderboard(query: LeaderboardQuery = {}): Promise<LeaderboardPage> {
  await migrateStatistics()

  const perPage = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, Math.floor(query.perPage || DEFAULT_PER_PAGE)))

  return { ...readLeaderboardPage(query, perPage), stats: await getGlobalStats() }
}

/**
 * Where one character stands in the overall table, or nothing at all for one the table does not draw.
 *
 * A place is a place in the *overall* table - every member, ordered by the rating, with no filter in front of it
 * - because that is the table the page opens on and the only one a place can mean without saying whose filters
 * it was read under.
 */
export async function getLeaderboardStanding(
  character: Pick<LeaderboardPlayer, 'region' | 'realm' | 'name'>
): Promise<LeaderboardStanding | null> {
  await migrateStatistics()

  return readLeaderboardStanding(character)
}

/**
 * One page of one metric leaderboard, with the same prologue every read here has: the migration that moves the
 * site's old table into the database is awaited first, so a page read before it has run is not a page with rows
 * missing.
 *
 * The figures are the members' own - a guest's newest reading, an account's own totals - because that is what the
 * rows are made of, and this read does nothing to them but order and slice (`./leaderboardRows`).
 */
export async function getMetricLeaderboard(
  metric: MetricLeaderboard,
  query: LeaderboardQuery = {},
  perPage = DEFAULT_PER_PAGE
): Promise<MetricLeaderboardPage> {
  await migrateStatistics()

  const size = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, Math.floor(perPage || DEFAULT_PER_PAGE)))

  return readMetricLeaderboardPage(metric, query, size)
}

/**
 * The three places each of the named characters holds in one metric's rankings.
 *
 * One answer for the whole comparison rather than one per scope per character: a comparison board asks about its
 * two sides at once, and the world's population is the same number for both of them - which is a fact the read
 * memoises within the call (`readMetricRanks`).
 */
export async function getMetricRanks(
  metric: MetricLeaderboard,
  keys: string[]
): Promise<MetricLeaderboardRanks> {
  await migrateStatistics()

  return readMetricRanks(metric, keys)
}

/**
 * Where one character stands in every ranking of the site, which is the same question `getMetricRanks` answers
 * asked the other way round: that one reads a figure's ranking for the names a caller has, this one reads a name
 * against every figure's ranking.
 *
 * It exists because a page of a character's figures is a page of thirteen doors, and every one of those doors is a
 * link carrying the place its reader holds in the table it opens (`?rank=`; `CharacterRanks`). Asked one figure at
 * a time that is thirteen requests for one page's worth of links; asked here it is one, and the endpoint in front
 * of it caches the answer under the stamp of the data, so a character's places cost one read per revision however
 * many readers follow them.
 *
 * The places are the *world's*, and only the world's: a door from a character's page opens the ranking whole (the
 * table the site keeps), so the place the address carries is the one in that table, and a region's or a realm's
 * place would be a place in a page the door does not open. A ranking the table does not hold them in answers
 * `null`, which is also what a figure the site has never read for them answers - the one value a link can be
 * written from either way.
 */
export async function getCharacterRanks(
  character: Pick<LeaderboardPlayer, 'region' | 'realm' | 'name'>
): Promise<CharacterRanks> {
  await migrateStatistics()

  // The key the table keys a row by, spelled the way every caller of the ranks read spells it.
  const key = `${character.region}:${character.realm}:${character.name}`.toLowerCase()

  return Object.fromEntries(
    METRIC_LEADERBOARDS.map((metric) => [metric.slug, readMetricRanks(metric, [key]).players[0]?.worldRank ?? null])
  ) as CharacterRanks
}

/**
 * The figures behind the widgets, gathered once per revision of the data rather than once per reader.
 *
 * A reader opening the page, switching a preset, filtering by realm or searching a name all read the same
 * object, and every write that moves the population makes the next read gather it again. The point of the memo
 * is that the page's cost does not grow with the table: a burst of readers pays for the aggregation once.
 */
export async function getGlobalStats(): Promise<LeaderboardStats> {
  await migrateStatistics()

  // The stamp is taken *after* the read, because reading can move the data: a table that has to be built - a fresh
  // database, a rating whose weights have changed - is built by the read itself (`./leaderboardRows`), and a memo
  // keyed on the revision the data held before that would answer once too often from the numbers it replaced.
  const stamp = statisticsRevision()
  if (statsMemo && stamp === statsStamp) return statsMemo

  statsMemo = readGlobalStats()
  statsStamp = statisticsRevision()

  return statsMemo
}
