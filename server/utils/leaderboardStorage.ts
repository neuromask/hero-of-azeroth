/**
 * The repository the leaderboard is read and written through.
 *
 * Everything the table needs is behind the four functions this module exports - `getLeaderboard`,
 * `getLeaderboardStanding`, `upsertPlayer` and `getGlobalStats` - and that is the whole contract. The
 * endpoint that serves
 * `/api/leaderboard` and the components that draw it know a query and a payload, never a file, a
 * key or a driver, which is what makes the storage itself a private detail: swapping the JSON file
 * below for SQLite (`better-sqlite3`, `db0`) is a rewrite of this one file and a change to nothing
 * else. The same holds for the record shape, which lives in `#shared/data/leaderboardSchema`.
 *
 * Two decisions are worth knowing about before reading the code:
 *
 *   - **Nothing is aggregated per request.** The table is small enough to hold in memory, so the
 *     file is read once and kept in a process-wide snapshot; a write replaces the snapshot and
 *     clears the memoised statistics, and a read is a filter and a sort over an array. The overall
 *     rating is not even computed on read - it is computed when a profile is written, so a reader
 *     costs the same whether the table holds ten players or ten thousand.
 *   - **A write is never a half-written file.** Records are appended through one promise chain, so
 *     two lookups landing together cannot read the same file and overwrite each other, and the
 *     document is written to a temporary name and renamed over the target, which is atomic on the
 *     volume - a process killed mid-write leaves the previous file intact, not a truncated one.
 *
 * The file lives in `server/data`, beside the character index the sitemap is built from, and is
 * created on first write. A table that has never been written is filled from that index on the
 * first read, so the page has content from the day it ships rather than from the next lookup (see
 * `backfillFromIndex`).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDirectory } from './appPaths'
// The formula, which lives on the server alone: the table's own column, the account's totals and every
// page's rating are one number because they are one call (`server/utils/playerScore`).
import { calculatePlayerScore, totalCollectables, SCORE_VERSION } from './playerScore'
// The index the sitemap is built from: the same characters, and what the backfill starts from.
import { readCharacterIndex } from './characterIndex'
// The one rule the table learns from the site's accounts: a character an account kept to itself
// does not belong here, and only a main does (see `./leaderboardExclusions`).
import { excludedLeaderboardKeys, exclusionsRevision, leaderboardKey } from './leaderboardExclusions'
// And who belongs to an account at all, which is the other fact the table learns from that database: the
// rows whose figures are an account's own rather than one lookup's (see `./accounts`).
import { accountLeaderboardKeys } from './accounts'
// The account behind a row, and the figures it holds: what makes the table print the account's
// numbers for a signed-in player rather than one character's (see `withAccountTotals`).
import { accountTotalsByCharacterKey, bestExtras, bestFigures } from './accountPool'
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
import { LEADERBOARD_SORTS, isAtItemLevelCap } from '#shared/data/leaderboardSchema'
import { DISTRIBUTION_METRICS } from '#shared/data/historySchema'
import type {
  DistributionBin,
  DistributionMetricKey,
  DistributionPosition,
  DistributionResponse
} from '#shared/data/historySchema'

/**
 * Where the table is kept: the app's own data directory (`./appPaths`), the same one the database and the
 * character index use.
 *
 * It used to be resolved against the working directory, which is not the app's directory whenever a panel
 * or a process manager starts the server from somewhere else - and the table a site had been building then
 * came up empty, written from scratch into a second, fresh data directory. The table is the site's front
 * page, so the path is taken from the running script instead.
 */
const DATA_DIR = dataDirectory()
const DATA_FILE = join(DATA_DIR, 'leaderboard.json')

/** The record shape this build writes, so a file from an older build can be told apart. */
const SCHEMA_VERSION = 1

/**
 * How many players the table keeps. A personal site's population is nowhere near this, but a file
 * that grew without a bound would eventually be a slow parse at every boot; past the cap the
 * stalest character falls off the end, exactly as the sitemap's index does it.
 */
const PLAYER_LIMIT = 20000

/** How many players a page holds when a caller does not say, and the bounds a caller may ask for. */
export const DEFAULT_PER_PAGE = 25
const MIN_PER_PAGE = 5
const MAX_PER_PAGE = 100

/**
 * What a caller writes: one character as the profile endpoint read it. Every figure is optional,
 * because a profile that could not be read in full (Blizzard refused the pet collection, say) must
 * not erase what an earlier, complete lookup wrote down - a field left out keeps the value on file.
 */
export interface PlayerProfileInput {
  region: string
  realm: string
  /** The realm as the game spells it, when the caller has it. */
  realmName?: string
  name: string
  displayName?: string
  /** Blizzard's square portrait of the character, when the profile carried one. */
  avatar?: string
  classId?: number
  /** As the profile API reports it (`ALLIANCE`, `HORDE`, `NEUTRAL`), or already lowercased. */
  faction?: string
  level?: number
  ilvl?: number
  mPlusScore?: number
  /**
   * Honorable kills, which is the figure the table's own column prints after the rating. An account's main is
   * written with the account's total here (`syncMainToLeaderboard`), and every other row with the reading of
   * the one character it stands for.
   */
  honorableKills?: number
  mounts?: number
  pets?: number
  toys?: number
  decor?: number
  /** Factions driven to the top of their own ladder, which is what the reputation column prints. */
  reputations?: number
  achievements?: number
}

/** The document as it is stored on disk. */
interface LeaderboardFile {
  version: number
  /**
   * The weights the ratings in this file were computed with (see `SCORE_VERSION`). A file written by
   * a build with other multipliers is re-derived once, on the first read after that build starts -
   * which is what keeps a weight a one-line edit that reaches the whole table rather than only the
   * characters looked up afterwards.
   */
  scoreVersion?: number
  /** The day the file was last written, `YYYY-MM-DD`, which the page prints as its freshness. */
  updatedAt: string
  players: LeaderboardPlayer[]
}

/** The day a record is written, in the `YYYY-MM-DD` the rest of the site's data files use. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A figure as a record stores it: a positive whole number, or zero for anything unusable. */
function count(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** A slug as a name to print: `gordunni` and `tarren-mill` read as `Gordunni`, `Tarren Mill`. */
function titleCase(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/** The identity a record is unique on: its three address segments, lowercased. */
function identity(record: Pick<LeaderboardPlayer, 'region' | 'realm' | 'name'>): string {
  return `${record.region}:${record.realm}:${record.name}`.toLowerCase()
}

/**
 * The side a profile plays for, as a record spells it. The API sends the type in capitals and a
 * profile may arrive with it already lowercased; anything else - a record written before factions
 * were kept, a character whose side Blizzard will not state - reads as `neutral`, which is a real
 * answer here rather than a missing one, and is what the faction filter leaves out.
 */
export function normalizeFaction(faction?: string): LeaderboardFaction {
  const value = (faction || '').trim().toLowerCase()
  if (value.startsWith('alliance')) return 'alliance'
  if (value.startsWith('horde')) return 'horde'
  return 'neutral'
}

/** Whether a value read off disk is a record this build can draw. */
function isPlayerLike(value: unknown): value is LeaderboardPlayer {
  const player = value as LeaderboardPlayer | null
  return Boolean(
    player &&
      typeof player === 'object' &&
      typeof player.region === 'string' &&
      typeof player.realm === 'string' &&
      typeof player.name === 'string'
  )
}

/**
 * Whether the record on file already says everything this profile does.
 *
 * Every field that is ever printed is compared, `updatedAt` included: a day later the same figures
 * are still written down, because the day is what the table's freshness line and the cap on its
 * length both read. This comparison is what makes feeding the table on *every* request affordable -
 * a reader opening a page the table already knows does not touch the disk - while a record written
 * from the sitemap's thinner index (which knows no faction, no portrait, no pets) fails the test on
 * the first field it is missing and is replaced the first time somebody looks that character up.
 */
function isSameRecord(a: LeaderboardPlayer, b: LeaderboardPlayer): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.displayName === b.displayName &&
    a.realmName === b.realmName &&
    (a.avatar || '') === (b.avatar || '') &&
    a.classId === b.classId &&
    a.faction === b.faction &&
    a.level === b.level &&
    a.ilvl === b.ilvl &&
    a.mPlusScore === b.mPlusScore &&
    a.honorableKills === b.honorableKills &&
    a.mounts === b.mounts &&
    a.pets === b.pets &&
    a.toys === b.toys &&
    a.decor === b.decor &&
    a.reputations === b.reputations &&
    a.achievements === b.achievements &&
    a.score === b.score
  )
}

/**
 * A stored record built from a profile: every field normalised, the realm and the name lowercased
 * for the address, and the overall rating computed once, here, so no read ever has to.
 */
function toPlayer(input: PlayerProfileInput, firstSeenAt: string): LeaderboardPlayer {
  const realm = input.realm.toLowerCase()
  const name = input.name.toLowerCase()

  const figures = {
    mounts: count(input.mounts),
    pets: count(input.pets),
    toys: count(input.toys),
    decor: count(input.decor),
    reputations: count(input.reputations),
    achievements: count(input.achievements),
    mPlusScore: count(input.mPlusScore),
    // Beside the rating rather than among the six the rating weighs: a kill is something a character has done,
    // not something it gathered (`ScoreInput` in `./playerScore`), and this one figure travels with the row for
    // the table's own column.
    honorableKills: count(input.honorableKills),
    ilvl: count(input.ilvl),
    level: count(input.level)
  }

  return {
    region: input.region.toLowerCase(),
    realm,
    realmName: input.realmName?.trim() || titleCase(realm),
    name,
    displayName: input.displayName?.trim() || titleCase(name),
    // An empty string is dropped rather than stored, so the JSON carries no `avatar` key at all
    // for a row that has no portrait - which is what the table checks.
    avatar: input.avatar?.trim() || undefined,
    classId: count(input.classId),
    faction: normalizeFaction(input.faction),
    ...figures,
    score: calculatePlayerScore(figures),
    updatedAt: today(),
    firstSeenAt
  }
}

/* ------------------------------------------------------------------------------------------------
 * Reading
 * --------------------------------------------------------------------------------------------- */

/**
 * The table as the process knows it, and the read in flight that will fill it.
 *
 * The snapshot is what makes a read cheap: the file is parsed once per process (and once more
 * after every write, which replaces it in place), so a page of the table costs a filter and a sort
 * over an array rather than a parse of the document. `loading` holds the promise of a read that is
 * already running, so two requests arriving together on a cold process share one disk read instead
 * of racing for it.
 */
let snapshot: LeaderboardFile | null = null
let loading: Promise<LeaderboardFile> | null = null

/** The statistics of the snapshot, memoised until a write replaces it (see `getGlobalStats`). */
let statsMemo: LeaderboardStats | null = null

/** How many times the file has been written, which is what a stamp of the table itself is made of. */
let revision = 0

/** The stamp the memoised statistics were read from, so a pool that moved behind them is noticed. */
let statsStamp = ''

/**
 * A stamp of everything the table is drawn with: the table's own file, the pool, and the readings
 * the accounts' figures are taken from.
 *
 * The endpoint that serves the table holds its answer for an hour (`server/api/leaderboard`), which
 * is the site's performance story - but an hour is also how long a pool that just grew, or a
 * character that was just read, would stay invisible behind that answer. The stamp is what the
 * endpoint compares its entry against: it moves whenever any of the three moves, and the entry is
 * rebuilt from the stamp that is current rather than from the one it was built with.
 */
export function leaderboardDataStamp(): string {
  return `${revision}:${exclusionsRevision()}:${accountDataStamp()}`
}

/**
 * A stamp of what the accounts hold: the pool, and the newest reading of a character.
 *
 * A memo taken before a sync must not answer after it. The pool grows in the background
 * (`./accountPool`) and the snapshots are written by the same task, while the table's own file can
 * sit untouched for weeks - so the widgets, which are computed from the rows, would keep printing
 * the figures of a pool that has since been filled in.
 */
function accountDataStamp(): string {
  try {
    const row = useDb()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM account_pool) AS pool,
                (SELECT COALESCE(MAX(first_seen_at), 0) FROM account_pool) AS poolSeen,
                (SELECT COUNT(*) FROM snapshots) AS readings,
                (SELECT COALESCE(MAX(taken_at), 0) FROM snapshots) AS readingAt`
      )
      .get() as { pool: number; poolSeen: number; readings: number; readingAt: number }

    return `${row.pool}:${row.poolSeen}:${row.readings}:${row.readingAt}`
  } catch {
    // No database yet: nothing that could move behind the memo's back.
    return 'none'
  }
}

/** A table with nothing in it, which is what an unreadable or missing file reads as. */
function emptyFile(): LeaderboardFile {
  return { version: SCHEMA_VERSION, scoreVersion: SCORE_VERSION, updatedAt: '', players: [] }
}

/**
 * The table as it was stored, or an empty one.
 *
 * A file that is not there yet is not an error - the first lookup creates it - and neither is one
 * that cannot be parsed (a hand-edited file, a half-written one from a build before the atomic
 * rename): an empty table is served, the next write replaces the file, and the site stays up.
 */
async function readFromDisk(): Promise<LeaderboardFile> {
  try {
    const raw = await readFile(DATA_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LeaderboardFile>
    if (!parsed || !Array.isArray(parsed.players)) return emptyFile()

    return {
      version: parsed.version || SCHEMA_VERSION,
      // A file written before the stamp existed counts as older than any formula, so its ratings are
      // re-derived once rather than trusted (see `SCORE_VERSION`).
      scoreVersion: typeof parsed.scoreVersion === 'number' ? parsed.scoreVersion : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      // A record written before a column existed carries no such key at all, and an absent figure is
      // not the same thing as a nought once anything is done with it: `Math.max(undefined, n)` is
      // `NaN`, so a row whose account synced would come back with a rating of `NaN` and sort to the
      // end of the table. Filling the gap in as the record is read keeps every later pass - the
      // order, the widgets, the account's own overlay - reading a plain number, which is what the
      // type has always promised.
      players: parsed.players.filter(isPlayerLike).map((player) => ({
        ...player,
        reputations: count(player.reputations),
        // And the same for the kills, which are the column this build added to a file that was written
        // without them: an absent key would be filled in as `NaN` by the account's own merge (`bestExtras`)
        // rather than as nought, and a row would print a figure no number can be read beside.
        honorableKills: count(player.honorableKills)
      }))
    }
  } catch {
    return emptyFile()
  }
}

/**
 * The first read of a table that has never been written: the sitemap's own index, mapped into
 * records.
 *
 * The index holds the characters the site has rendered, which is the same population this table is
 * about, and it keeps what a profile said about each of them - the portrait, the side it plays for,
 * the level, the class, the item level, the Mythic+ rating and everything gathered - so a row
 * backfilled from it is a whole row rather than half of one. A record written before a field was
 * kept carries none of it, which is what the optional fields of that record are for: such a row
 * prints a dash where the figure is unknown, and it is filled in the next time that character is fed
 * into the table at all - by a character page being read, or by a card being drawn
 * (`server/utils/profileFeed.ts`). The point of the whole function is that `/leaderboard` opens on
 * the day it ships with the site's own history in it rather than with an empty table, and it costs
 * one file read on the first request after a deploy.
 */
async function backfillFromIndex(): Promise<LeaderboardPlayer[]> {
  const index = await readCharacterIndex().catch(() => [])

  return index
    .filter((entry) => entry.region && entry.realm && entry.name)
    .map((entry) =>
      toPlayer(
        {
          region: entry.region,
          realm: entry.realm,
          name: entry.name,
          displayName: entry.displayName,
          avatar: entry.avatar,
          faction: entry.faction,
          classId: entry.classId,
          level: entry.level,
          ilvl: entry.ilvl,
          mPlusScore: entry.mPlusScore,
          honorableKills: entry.honorableKills,
          mounts: entry.mounts,
          pets: entry.pets,
          toys: entry.toys,
          decor: entry.decor,
          reputations: entry.reputations,
          achievements: entry.achievements
        },
        entry.firstSeenAt || entry.updatedAt || today()
      )
    )
}

/** The table, read from disk at most once per process (or once per write). */
async function readTable(): Promise<LeaderboardFile> {
  if (snapshot) return snapshot
  if (loading) return loading

  loading = (async () => {
    const file = await readFromDisk()

    // A file whose ratings were computed with other weights is re-derived before it is served, so the
    // table can never show a score the formula in `server/utils/playerScore` would not produce.
    // It is the only pass in this module that touches every record at once, and it happens once per
    // weight change rather than once per request.
    if (file.players.length && file.scoreVersion !== SCORE_VERSION) {
      const rescored: LeaderboardFile = {
        version: SCHEMA_VERSION,
        scoreVersion: SCORE_VERSION,
        updatedAt: file.updatedAt || today(),
        players: file.players.map((player) => ({ ...player, score: calculatePlayerScore(player) }))
      }

      await writeTable(rescored).catch(() => undefined)
      snapshot = rescored
      loading = null
      return rescored
    }

    if (!file.players.length) {
      const players = await backfillFromIndex()
      if (players.length) {
        // Written straight away, so the backfill happens once rather than on every cold start.
        const filled: LeaderboardFile = {
          version: SCHEMA_VERSION,
          scoreVersion: SCORE_VERSION,
          updatedAt: today(),
          players
        }
        await writeTable(filled).catch(() => undefined)
        snapshot = filled
        loading = null
        return filled
      }
    }

    snapshot = file
    loading = null
    return file
  })()

  return loading
}

/* ------------------------------------------------------------------------------------------------
 * Writing
 * --------------------------------------------------------------------------------------------- */

/**
 * Writes the document, atomically.
 *
 * The JSON goes to a temporary name in the same folder and is renamed over the target, which is
 * atomic on one volume: a reader - or a crash, or a process the host kills - sees either the whole
 * previous file or the whole new one, never a half-written document. The temporary name carries the
 * process id, so two servers sharing one folder (a dev server and a built one) cannot collide on it.
 */
async function writeTable(file: LeaderboardFile): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })

  const temporary = `${DATA_FILE}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, 'utf8')
  await rename(temporary, DATA_FILE)
}

/**
 * The one promise chain every write is threaded onto.
 *
 * Two lookups landing together would otherwise both read the table, and the second would write its
 * own version over the first - losing a player, and on a busy day several. Threading the writes
 * means each one sees the file the one before it left, which is what makes the sequence of writes
 * the only thing that decides what the table holds. Reads are not queued: they read the snapshot,
 * which a write replaces in one assignment.
 */
let writes: Promise<void> = Promise.resolve()

/**
 * Writes a player down, or refreshes one already in the table.
 *
 * What the profile carried is written; what it did not is kept from the record this one replaces,
 * so a detail is only ever lost when the character itself stops reporting it - a lookup whose pet
 * read timed out does not wipe a stored pet count. The first day is the one thing no later lookup
 * can tell, and it is kept for good. The overall rating is recomputed here, from the merged record,
 * which is why it is stored rather than derived: a read never has to weigh anything.
 *
 * A failure is swallowed on purpose. The caller is a page that has already been rendered from the
 * very profile this write was made for, and a table that could not be updated is a stale row, not a
 * broken page.
 */
export function upsertPlayer(profile: PlayerProfileInput): Promise<void> {
  writes = writes.then(async () => {
    try {
      // A character an account kept to itself never enters the public table (see
      // `./leaderboardExclusions`); its main is not excluded, so naming one is what puts an
      // account's character here at all.
      if (excludedLeaderboardKeys().has(leaderboardKey(profile.region, profile.realm, profile.name))) return

      const file = await readTable()
      const key = identity(profile)
      const previous = file.players.find((entry) => identity(entry) === key)

      const record = toPlayer(
        {
          ...profile,
          classId: profile.classId ?? previous?.classId,
          level: profile.level ?? previous?.level,
          ilvl: profile.ilvl ?? previous?.ilvl,
          mPlusScore: profile.mPlusScore ?? previous?.mPlusScore,
          honorableKills: profile.honorableKills ?? previous?.honorableKills,
          mounts: profile.mounts ?? previous?.mounts,
          pets: profile.pets ?? previous?.pets,
          toys: profile.toys ?? previous?.toys,
          decor: profile.decor ?? previous?.decor,
          reputations: profile.reputations ?? previous?.reputations,
          achievements: profile.achievements ?? previous?.achievements,
          displayName: profile.displayName || previous?.displayName,
          avatar: profile.avatar || previous?.avatar,
          realmName: profile.realmName || previous?.realmName,
          faction: profile.faction || previous?.faction
        },
        previous?.firstSeenAt || today()
      )

      // A record that already says everything this profile does is not written again. It is the
      // common case - the profile itself is cached for two hours, so a reader who comes back to a
      // character they have already opened changes nothing - and skipping it is what keeps feeding
      // the table on every request from touching the disk. A record the sitemap's index wrote half
      // of, on the other hand, differs at the first field it never knew, so it is replaced here.
      if (previous && isSameRecord(previous, record)) return

      // Newest first, which is the order the cap drops from the end of: the stalest character
      // falls off the table once it is longer than the site ever needs.
      const players = [record, ...file.players.filter((entry) => identity(entry) !== key)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, PLAYER_LIMIT)

      const next: LeaderboardFile = {
        version: SCHEMA_VERSION,
        scoreVersion: SCORE_VERSION,
        updatedAt: today(),
        players
      }

      // The snapshot is replaced before the file is written, so the readers that arrive while the
      // disk is being written see the new table rather than the old one. The revision moves with it,
      // which is how a cache keyed on the data knows this table is not the one it answered from.
      snapshot = next
      statsMemo = null
      revision += 1

      await writeTable(next)
    } catch (error) {
      console.error('[leaderboard] could not write the table', error)
    }
  })

  return writes
}

/* ------------------------------------------------------------------------------------------------
 * The three functions the rest of the server knows
 * --------------------------------------------------------------------------------------------- */

/** Whether a sort name that arrived in a query string is one this build knows. */
function isSort(value: unknown): value is LeaderboardSort {
  return typeof value === 'string' && (LEADERBOARD_SORTS as readonly string[]).includes(value)
}

/** The figure a preset orders by. Everything else about the table is a column, not an order. */
function sortValue(player: LeaderboardPlayer, sort: LeaderboardSort): number {
  switch (sort) {
    case 'mounts':
      return player.mounts
    case 'pets':
      return player.pets
    case 'toys':
      return player.toys
    case 'decor':
      return player.decor
    case 'reputations':
      return player.reputations
    case 'mplus':
      return player.mPlusScore
    case 'kills':
      return player.honorableKills
    case 'achievements':
      return player.achievements
    case 'ilvl':
      return player.ilvl
    default:
      return player.score
  }
}

/**
 * The order of two players: the preset's own figure first, then the overall rating, then the name.
 *
 * The tie-breakers matter more than they look: the overall table is ordered by a weighted rating,
 * and two characters of the same class and realm often share a figure exactly - a rating of 0, a
 * pet count of 0 for records backfilled from the index. Falling back to the rating and then to the
 * name keeps every row in a place a reader can find twice, rather than leaving the order to the
 * sort's own whim.
 *
 * Item level is the one figure with a rule in front of it. A character who has not finished the
 * climb has an item level stored and nothing shown for it (see `isAtItemLevelCap`), so it is the one
 * figure that may order only the rows it is printed on: the characters the table prints it for are
 * ranked first and by it, and everybody else follows them, in the order their own rows do show - the
 * rating, then the name. Sorting those rows by a number no reader can see is what puts a dash at the
 * top of an item-level column, which is what a table sorted wrong looks like.
 */
function compare(a: LeaderboardPlayer, b: LeaderboardPlayer, sort: LeaderboardSort): number {
  if (sort === 'ilvl') {
    const aCapped = isAtItemLevelCap(a.level)
    const bCapped = isAtItemLevelCap(b.level)

    if (aCapped !== bCapped) return aCapped ? -1 : 1
    if (!aCapped) return byRating(a, b)
  }

  const primary = sortValue(b, sort) - sortValue(a, sort)
  if (primary) return primary

  return byRating(a, b)
}

/** The order of two characters whose figures tie: the overall rating, then the name. */
function byRating(a: LeaderboardPlayer, b: LeaderboardPlayer): number {
  const secondary = b.score - a.score
  if (secondary) return secondary

  return a.displayName.localeCompare(b.displayName)
}

/** Whether a player survives the filters a caller asked for. */
/**
 * The account's own figures laid over the rows that belong to one.
 *
 * The table lists one character per account - its main - and a collector comparing rows there is
 * comparing accounts, so that row has to print the account's collections rather than one character's
 * faction-limited ones (`./accountPool`). Writing that into the row is not enough on its own: a row
 * is written when the pool grows or when somebody opens that character, so a table that trusted the
 * file would keep whatever the row said the last time it was written - which, for a character nobody
 * has opened since the pool was built, is the number the site had before it ever had accounts.
 *
 * So the totals are laid over the row on the way out instead, which is what makes the table and the
 * character's own page one number by construction rather than by timing.
 *
 * Nothing is lowered, with the one deliberate exception the merge itself names: a reputation figure the pool
 * holds is the account's own (`bestFigures`), because the number a stored row carries for reputations can
 * still be the account-wide counter Blizzard used to be read for.
 *
 * The figures beside the collections are laid over the row the same way (`bestExtras`), and of those a row
 * carries exactly one: the honorable kills, which stand in the table's own column after the rating. An
 * account answers for them by *adding its characters up* rather than by keeping the best of them, so a row
 * belonging to an account prints the account's total and every other row prints the single reading it was
 * written with - the same two readings, and the same rule, every other column of the table follows.
 */
function withAccountTotals(players: LeaderboardPlayer[]): LeaderboardPlayer[] {
  const accounts = accountTotalsByCharacterKey()
  if (!accounts.size) return players

  return players.map((player) => {
    const account = accounts.get(leaderboardKey(player.region, player.realm, player.name))
    if (!account) return player

    // The site's one rule for the two readings of an account (`server/utils/accountPool`), which the
    // character page and the account's own profile are merged with as well: a row and a page can only
    // disagree if they are merged in two places.
    const figures = bestFigures(
      {
        achievements: player.achievements,
        mounts: player.mounts,
        pets: player.pets,
        toys: player.toys,
        decor: player.decor,
        reputations: player.reputations
      },
      account
    )

    // And the figures beside the collections, of which a row carries exactly one: the honorable kills, the
    // column standing after the rating. It is merged under that same rule (`bestExtras`) rather than handled
    // here, so a row and a page cannot answer the account differently - and the other five are handed over as
    // nothing, because a row has nothing to say about a title, a quest or a wardrobe. What comes back for
    // those is the account's own number, which is simply not read; the kills are the account's own total,
    // which is the *sum* over its characters, so nothing is added up a second time here.
    const extras = bestExtras(
      {
        titles: 0,
        quests: 0,
        recipes: 0,
        transmogs: 0,
        honorableKills: player.honorableKills,
        honorLevel: 0
      },
      account
    )

    // A row the account has nothing to add to is handed back as it stands, so the common case - an
    // account whose row was already written from its own pool - allocates nothing.
    if (isSameFigures(player, figures) && player.honorableKills === extras.honorableKills) return player

    // The rating is a stored column, so it is recomputed here from the figures being served: the
    // table's order is the order of what a reader sees.
    return {
      ...player,
      ...figures,
      honorableKills: extras.honorableKills,
      score: calculatePlayerScore({ ...player, ...figures })
    }
  })
}

/** Whether a row already prints these figures. */
function isSameFigures(
  player: LeaderboardPlayer,
  figures: Pick<LeaderboardPlayer, 'mounts' | 'pets' | 'toys' | 'decor' | 'reputations' | 'achievements'>
): boolean {
  return (
    player.mounts === figures.mounts &&
    player.pets === figures.pets &&
    player.toys === figures.toys &&
    player.decor === figures.decor &&
    player.reputations === figures.reputations &&
    player.achievements === figures.achievements
  )
}

/**
 * The players the public table may draw: everybody the site knows, minus the characters an
 * account kept to itself, and with each account's own figures over its own row.
 *
 * The exclusion is read from SQLite through a minute-long memo (`./leaderboardExclusions`), so a
 * burst of page reads pays one query for a fact that almost never moves. The totals are read the
 * same way, once per read rather than once per row.
 */
function visiblePlayers(players: LeaderboardPlayer[]): LeaderboardPlayer[] {
  const excluded = excludedLeaderboardKeys()
  const roster = excluded.size
    ? players.filter((player) => !excluded.has(leaderboardKey(player.region, player.realm, player.name)))
    : players

  return withAccountMark(withAccountTotals(roster))
}

/**
 * Marks the rows that belong to an account on the site, which is what the table's blue halo is read from.
 *
 * It stands on the same step the account's own figures are merged into a row, because the two are one fact
 * asked twice: a row the pool has figures for is a row whose account signed in, and the mark is that fact
 * said out loud (`./accounts` holds the join). An empty set - a checkout that never opened the database -
 * hands the rows back untouched rather than copying every one of them for nothing.
 */
function withAccountMark(players: LeaderboardPlayer[]): LeaderboardPlayer[] {
  const accounts = accountLeaderboardKeys()
  if (!accounts.size) return players

  return players.map((player) =>
    accounts.has(identity(player)) ? { ...player, isAccount: true as const } : player
  )
}

/** Whether a player survives the filters a caller asked for. */
function matches(player: LeaderboardPlayer, query: LeaderboardQuery): boolean {
  if (query.faction && query.faction !== 'all' && player.faction !== query.faction) return false
  if (query.realm && player.realm !== query.realm.toLowerCase()) return false
  if (query.classId && query.classId !== 'all' && player.classId !== Number(query.classId)) return false

  const needle = (query.q || '').trim().toLowerCase()
  if (needle && !`${player.displayName} ${player.name}`.toLowerCase().includes(needle)) return false

  return true
}

/**
 * One page of the table: the population filtered, ordered and sliced, with the widgets' figures
 * riding along.
 *
 * Everything here runs against the in-memory snapshot, so the cost is a filter and a sort over an
 * array - no disk, no aggregation, and the rating is a stored column rather than a sum. The whole
 * answer is then cached by the endpoint for an hour (see `server/api/leaderboard/index.ts`), which
 * is what keeps this function off the request path of the site's other pages entirely.
 */
export async function getLeaderboard(query: LeaderboardQuery = {}): Promise<LeaderboardPage> {
  const file = await readTable()

  const sort = isSort(query.sort) ? query.sort : 'total'
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(MIN_PER_PAGE, Math.floor(query.perPage || DEFAULT_PER_PAGE))
  )
  const asked = Math.max(1, Math.floor(query.page || 1))

  // `filter` copies, so the snapshot's own array is never reordered by a reader.
  const players = visiblePlayers(file.players)
    .filter((player) => matches(player, query))
    .sort((a, b) => compare(a, b, sort))

  const pages = Math.max(1, Math.ceil(players.length / perPage))
  const page = Math.min(asked, pages)

  return {
    players: players.slice((page - 1) * perPage, page * perPage),
    total: players.length,
    page,
    perPage,
    pages,
    sort,
    stats: await getGlobalStats(),
    updatedAt: file.updatedAt
  }
}

/**
 * Where one character stands in the overall table: their row, their place, and the population that
 * place is a place in.
 *
 * The order is the one the page opens on, taken from the same comparator the page's own table is
 * sorted with, so a place can never be a place in an order the reader cannot also see. Nothing is
 * filtered: a place is a fact about the table, not about what the reader last asked it for.
 *
 * A character the table does not know is answered with nothing at all rather than with a place at the
 * end of the table. There is nothing to say about a row that is not there, and a place would say
 * something the data does not: the page draws no plate, and the same question answers differently the
 * moment that character is looked up.
 */
export async function getLeaderboardStanding(
  character: Pick<LeaderboardPlayer, 'region' | 'realm' | 'name'>
): Promise<LeaderboardStanding | null> {
  const file = await readTable()
  const key = identity(character)

  const visible = visiblePlayers(file.players)
  const player = visible.find((entry) => identity(entry) === key)
  if (!player) return null

  // `sort` copies, so the snapshot's own array is left in the order the writes put it in.
  const ranked = visible.slice().sort((a, b) => compare(a, b, 'total'))

  return {
    player,
    rank: ranked.findIndex((entry) => identity(entry) === key) + 1,
    total: ranked.length
  }
}

/**
 * How a metric's figure is read off a row, for each of the ten metrics the table really carries. Item level
 * is the one figure with a rule in front of it (`isAtItemLevelCap`), so a row the table does not print it for
 * reads as `null` here and is left out of that histogram rather than counted as a level-40 character wearing 120.
 */
const DISTRIBUTION_FIELDS: Record<(typeof DISTRIBUTION_METRICS)[number], (player: LeaderboardPlayer) => number | null> = {
  score: (player) => player.score,
  mounts: (player) => player.mounts,
  pets: (player) => player.pets,
  toys: (player) => player.toys,
  decor: (player) => player.decor,
  reputations: (player) => player.reputations,
  achievements: (player) => player.achievements,
  mPlusScore: (player) => player.mPlusScore,
  honorableKills: (player) => player.honorableKills,
  ilvl: (player) => (isAtItemLevelCap(player.level) ? player.ilvl : null)
}

/** How many buckets a histogram is cut into. */
const DISTRIBUTION_BINS = 24

/** A histogram of one figure: equal-width buckets from the lowest to the highest value in the population. */
function buildBins(values: number[]): DistributionBin[] {
  if (!values.length) return []

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [{ from: min, to: max, count: values.length }]

  const width = (max - min) / DISTRIBUTION_BINS
  const bins: DistributionBin[] = Array.from({ length: DISTRIBUTION_BINS }, (_, index) => ({
    from: Math.round(min + index * width),
    to: Math.round(index === DISTRIBUTION_BINS - 1 ? max : min + (index + 1) * width),
    count: 0
  }))

  for (const value of values) {
    const index = Math.min(DISTRIBUTION_BINS - 1, Math.floor((value - min) / width))
    bins[index]!.count += 1
  }

  return bins
}

/**
 * One metric's distribution over the canonical table, with the positions of the players a caller named.
 *
 * The histogram is the population's and is therefore shared: one answer serves a whole comparison. The
 * positions are the players' own - their figure, their place (one-based, highest first) and their percentile
 * as a whole percent from the top - and a key the table does not know is answered with `null`s rather than a
 * fabricated place (`decision: never show a rank the source cannot support`).
 *
 * The population is the one the page's own table draws (`visiblePlayers`), and the metric is one the table
 * really carries (`DISTRIBUTION_METRICS`): the five snapshot metrics the table never had are not drawn here at
 * all, so a histogram is never padded with a population that is not the table.
 */
export async function getDistribution(metric: DistributionMetricKey, playerKeys: string[]): Promise<DistributionResponse> {
  const file = await readTable()
  const players = visiblePlayers(file.players)
  const read = DISTRIBUTION_FIELDS[metric]

  const values = players
    .map((player) => read(player))
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const byKey = new Map(players.map((player) => [identity(player), player]))

  const positions: DistributionPosition[] = playerKeys.map((key) => {
    const player = byKey.get(key)
    const own = player ? read(player) : null
    const placed = typeof own === 'number' && Number.isFinite(own)
    const rank = placed ? values.filter((value) => value > own).length + 1 : null

    return {
      key,
      value: placed ? own : null,
      rank,
      percentile: rank !== null && values.length ? Math.max(1, Math.round((rank / values.length) * 100)) : null
    }
  })

  return {
    metric,
    bins: buildBins(values),
    population: values.length,
    positions,
    updatedAt: file.updatedAt
  }
}

/** The factions in the order the chips are drawn: the two sides, then everything else. */
const FACTION_ORDER: readonly LeaderboardFaction[] = ['alliance', 'horde', 'neutral']

/**
 * The figures behind the widgets, computed once per table and then served from memory.
 *
 * The pass below is the only aggregation in the module, and it is memoised: a reader opening the
 * page, switching a preset, filtering by realm or searching a name all read the same object, which
 * a write clears. A population of a few thousand characters is a single loop either way, but the
 * point of the memo is that the page's cost does not grow with the table at all.
 */
export async function getGlobalStats(): Promise<LeaderboardStats> {
  // The memo follows the data, not only the table's own writes: a pool that grew since the last
  // read moves the widgets' figures even when no row was rewritten for it (`accountDataStamp`).
  const stamp = accountDataStamp()
  if (statsMemo && stamp === statsStamp) return statsMemo

  const file = await readTable()
  statsMemo = computeStats(visiblePlayers(file.players))
  statsStamp = stamp

  return statsMemo
}

/**
 * One pass over the table, gathering everything the widgets print and the filters offer.
 *
 * A leader with nothing to their name is reported as no leader at all rather than as a row of
 * zeroes: a table backfilled from the sitemap's index knows no character's decor, and "master
 * architect, 0 pieces" would be a claim the data does not support. The widget prints a dash
 * instead, and the figure appears the first time somebody with decor is looked up.
 */
function computeStats(players: LeaderboardPlayer[]): LeaderboardStats {
  const realmCounts = new Map<string, { region: string; realm: string; realmName: string; count: number }>()
  const classCounts = new Map<number, number>()
  const factionCounts = new Map<LeaderboardFaction, number>()

  const totals = { mounts: 0, pets: 0, toys: 0, decor: 0, reputations: 0, achievements: 0 }
  let collector: LeaderboardLeader | null = null
  let rating: LeaderboardLeader | null = null
  let architect: LeaderboardLeader | null = null

  for (const player of players) {
    totals.mounts += player.mounts
    totals.pets += player.pets
    totals.toys += player.toys
    totals.decor += player.decor
    totals.reputations += player.reputations
    totals.achievements += player.achievements

    const realmKey = `${player.region}:${player.realm}`
    const realm = realmCounts.get(realmKey) || {
      region: player.region,
      realm: player.realm,
      realmName: player.realmName || player.realm,
      count: 0
    }
    realm.count += 1
    realmCounts.set(realmKey, realm)

    if (player.classId > 0) classCounts.set(player.classId, (classCounts.get(player.classId) || 0) + 1)
    factionCounts.set(player.faction, (factionCounts.get(player.faction) || 0) + 1)

    const held = totalCollectables(player)
    if (!collector || held > collector.value) collector = { player, value: held }
    if (!rating || player.mPlusScore > rating.value) rating = { player, value: player.mPlusScore }
    if (!architect || player.decor > architect.value) architect = { player, value: player.decor }
  }

  const topClass = [...classCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]

  return {
    players: players.length,
    realms: realmCounts.size,
    classes: classCounts.size,
    topClass: topClass
      ? {
          classId: topClass[0],
          count: topClass[1],
          share: players.length ? Math.round((topClass[1] / players.length) * 100) : 0
        }
      : null,
    collector: collector && collector.value > 0 ? collector : null,
    rating: rating && rating.value > 0 ? rating : null,
    architect: architect && architect.value > 0 ? architect : null,
    totals,
    // The facets are sorted the way a reader scans them: the busiest choice first, and a stable
    // order for the ties, so the same table always draws the same chips.
    realmsFacet: [...realmCounts.values()].sort(
      (a, b) => b.count - a.count || a.realmName.localeCompare(b.realmName)
    ),
    classesFacet: [...classCounts.entries()]
      .map(([classId, count]) => ({ classId, count }))
      .sort((a, b) => b.count - a.count || a.classId - b.classId),
    factionsFacet: FACTION_ORDER.filter((faction) => factionCounts.has(faction)).map((faction) => ({
      faction,
      count: factionCounts.get(faction) || 0
    }))
  }
}
