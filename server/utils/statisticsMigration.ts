/**
 * Moves the hall of fame's own table into the database, once, and gives every account its first point of history.
 *
 * The table used to be kept in `server/data/leaderboard.json` - one row per character the site had read, written
 * by the very call that writes the sitemap's index (`./profileFeed`). Its rows are therefore characters the site
 * really read, and they belong in the database beside the ones read since: the table's rows, a character's
 * history and the distribution are all read from there now (`./statisticsPopulation`, `./leaderboardStorage`).
 *
 * What is deliberately *not* a source is the sitemap's index (`./characterIndex`): it lists the pages the site
 * can serve, which is a fact about addresses, and a character known only from that list is not a member of any
 * population. Nothing here reads it.
 *
 * Two steps, and both are idempotent:
 *
 *   1. every row of the file becomes a character of the database - a guest row, since a row of that file was
 *      never anybody's account - with one reading behind it, filed at the day the row was written. A character
 *      the database already has a reading for is left alone: what it holds was read in full, and a migration
 *      must never write over that;
 *   2. every account that has a reading is given its first point of history (`fileAccountReading`), so an
 *      account's own curve does not start empty on the day this ships.
 *
 * The file is left where it is. Nothing reads it after this, and deleting a site's data is not a migration's
 * job: a deploy that turns out wrong can be rolled back to a build that still understands it.
 *
 * The hall of fame's own rows need no step of their own here: both of the steps above write through the paths the
 * site writes with, and each of those keeps the row of the member it moved (`./leaderboardRows`) - a reading filed
 * rewrites a guest's row, a point filed rewrites the account's. A table that has never been built is built by the
 * first read of it, from the very rows this migration has just written.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDirectory } from './appPaths'
import { fileDailyReading } from './characterReading'
import { fileAccountReading } from './accountPool'
import { rememberGuestRow } from './profileFeed'
// The rating formula the file's scores were computed with, which is what decides whether they may be claimed.
import { SCORE_VERSION } from './playerScore'
import type { CharacterData } from './blizzard'

/** Where the table used to be kept, which is the one file this module knows how to read. */
const LEGACY_FILE = join(dataDirectory(), 'leaderboard.json')

/** One row of that file, as far as the migration reads it. */
interface LegacyPlayer {
  region?: string
  realm?: string
  realmName?: string
  name?: string
  displayName?: string
  avatar?: string
  classId?: number
  faction?: string
  level?: number
  ilvl?: number
  mPlusScore?: number
  honorableKills?: number
  mounts?: number
  pets?: number
  toys?: number
  decor?: number
  reputations?: number
  achievements?: number
  updatedAt?: string
  firstSeenAt?: string
}

/** The file itself: its rows, and the two things it says about them. */
interface LegacyTable {
  players: LegacyPlayer[]
  /** The day the table itself was written, which is the moment a row that kept none of its own is filed at. */
  updatedAt?: string
  /** The rating formula the file's scores were computed with, when the file says which. */
  scoreVersion?: number
}

/** What the migration moved, which is what a startup log line is made of. */
export interface StatisticsMigration {
  /** How many characters the file held that the database had no reading for. */
  characters: number
  /** How many accounts were given their first point of history. */
  accounts: number
  /**
   * How many rows of the file nothing could be filed for - one that named no address, or one whose moment the
   * store never kept. A file this build cannot read row by row says so here rather than passing for a complete
   * import.
   */
  skipped: number
  /**
   * Why the file could not be read at all, or `null` when it was read or simply was not there.
   *
   * The distinction is the whole point of this field: a site that never had a table and a site whose table is
   * unreadable look the same from inside `run()` unless something says which one this is. A file that is there
   * and cannot be read is reported, never silently treated as an empty source - and never deleted, so a build
   * that understands it can still be rolled back to.
   */
  error: string | null
}

let migrating: Promise<StatisticsMigration> | null = null

/**
 * Runs the migration once per process, and hands the same promise to every caller.
 *
 * Once per process rather than once per call: the two steps walk every character and every account, and the
 * startup plugin that asks for it (`server/plugins/statisticsMigration`) is not the only caller that may want to
 * know it has finished. A failure is not remembered, so a later caller tries again.
 */
export function migrateStatistics(): Promise<StatisticsMigration> {
  migrating ??= run().catch((error) => {
    migrating = null
    throw error
  })

  return migrating
}

/** The two steps, in the order they have to happen: the characters first, then the accounts they belong to. */
async function run(): Promise<StatisticsMigration> {
  let table: LegacyTable

  try {
    table = await readLegacyTable()
  } catch (error) {
    // A file that is there and cannot be read is not an empty table, and saying which of the two this is is the
    // whole reason the two are told apart (`readLegacyTable`). Nothing is thrown onward: this runs on the
    // leaderboard's own read path, and a page must not go down because an old file went bad. The file itself is
    // left exactly as it was, so a build that understands it can still be rolled back to.
    return {
      characters: 0,
      accounts: backfillAccounts(),
      skipped: 0,
      error: error instanceof Error ? error.message : String(error)
    }
  }

  const seeded = seedCharacters(table)

  return { characters: seeded.characters, accounts: backfillAccounts(), skipped: seeded.skipped, error: null }
}

/**
 * The file the table used to be kept in: its rows, and what it says about them.
 *
 * A file that is not there is the normal answer for a site that never had one - a fresh install, or one whose
 * host removed it once the migration was done - and is read as a table with no rows. Every other way of failing
 * is *reported* instead: a file that exists and cannot be read (a permission, a directory where a file should
 * be), one that is not JSON, one that is JSON but not this table, and one whose `players` is not a list. Reading
 * nothing out of any of those would be a migration that quietly loses a table, which is the one outcome a
 * migration may not have.
 */
async function readLegacyTable(): Promise<LegacyTable> {
  let text: string

  try {
    text = await readFile(LEGACY_FILE, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { players: [] }
    throw new Error(`the old table could not be read (${reason(error)}): ${LEGACY_FILE}`)
  }

  let file: unknown
  try {
    file = JSON.parse(text)
  } catch (error) {
    throw new Error(`the old table is not JSON (${reason(error)}): ${LEGACY_FILE}`)
  }

  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new Error(`the old table is not a table: ${LEGACY_FILE}`)
  }

  const { players, updatedAt, scoreVersion } = file as {
    players?: unknown
    updatedAt?: unknown
    scoreVersion?: unknown
  }

  if (!Array.isArray(players)) {
    throw new Error(`the old table names no rows: ${LEGACY_FILE}`)
  }

  return {
    players: players as LegacyPlayer[],
    updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined,
    scoreVersion: typeof scoreVersion === 'number' ? scoreVersion : undefined
  }
}

/** A failure as a line of text, for a message that is read by whoever is looking at the log. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A day on its own, which is the shape the store wrote. */
const LEGACY_DAY = /^\d{4}-\d{2}-\d{2}$/
/** A moment with a time but no zone, which is read as UTC: every moment this site writes is UTC. */
const LEGACY_NAIVE_MOMENT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/

/**
 * A moment the old table recorded, as seconds since the epoch, or `null` when the string is not one.
 *
 * Three shapes are read, and the third is the one that used to go wrong. A day on its own - what the store
 * actually wrote - is that day at the second it began; a full moment with a zone (`Z` or an offset) is the
 * instant it names; and a full moment without a zone is read as UTC, because every moment this site writes is
 * UTC (`nowSec`, `dayOf`) and a string with no zone has no other honest reading. The old code appended a day's
 * midnight to whatever it was given, so `2026-10-15T13:52:22Z` became `2026-10-15T13:52:22ZT00:00:00Z` - which
 * does not parse - and the row was filed as though it had just been read. Nothing here ever answers "now".
 */
function legacyMoment(value?: unknown): number | null {
  if (typeof value !== 'string') return null

  const text = value.trim()
  if (!text) return null

  const iso = LEGACY_DAY.test(text)
    ? `${text}T00:00:00Z`
    : LEGACY_NAIVE_MOMENT.test(text)
      ? `${text.replace(' ', 'T')}Z`
      : text

  const at = Date.parse(iso)
  return Number.isFinite(at) ? Math.floor(at / 1000) : null
}

/**
 * The figures of a legacy row, as the one writer of a reading reads them (`fileDailyReading`).
 *
 * The file holds the ten figures the table printed - which is nine of the fourteen a reading carries, plus the
 * level. The titles, the quests, the recipes, the wardrobe and the honor level were never in it, so they are
 * filed as `null`: unknown rather than zero, which is what keeps a figure nobody read out of a distribution and
 * out of a score. The five a row did carry are the row's own numbers, which is what the site showed at the time.
 */
function legacyFigures(player: LegacyPlayer): CharacterData {
  return {
    ilvl: player.ilvl ?? null,
    mPlusScore: player.mPlusScore ?? null,
    ap: player.achievements ?? null,
    stats: {
      mounts: { count: player.mounts ?? null },
      pets: { count: player.pets ?? null },
      toys: { count: player.toys ?? null },
      decor: { count: player.decor ?? null },
      reputations: { count: player.reputations ?? null },
      honorableKills: { count: player.honorableKills ?? null }
    }
  } as unknown as CharacterData
}

/**
 * Files every character of the file the database has no reading for, and answers what it did.
 *
 * A row is matched by its address, so a character that is already in the database - as an account's or as a
 * guest - is not written twice, and one whose row exists but has no reading is given one rather than skipped.
 *
 * The moment a reading is filed at is the row's own day, else the day the table itself was written, else the day
 * the character was first seen - never "now". A row whose moment the store did not keep is not a row read a
 * moment ago, and stamping it as one would put a reading the site never took at the top of a history and let it
 * outrank a live Blizzard answer (`readCharacterReading` weighs the two by their moments). A row with no moment
 * at all is counted in `skipped` and reported rather than filed under an invented one.
 *
 * The rating is the file's own when - and only when - the file says it was computed by the formula this build
 * has (`SCORE_VERSION`). A score is frozen at write time, and one re-derived by a formula that has moved on is
 * a number the site never held, so a file that does not say, or says something else, leaves its points without a
 * rating rather than with a guess (`./playerScore`).
 */
function seedCharacters(table: LegacyTable): { characters: number; skipped: number } {
  const db = useDb()
  const find = db.prepare('SELECT id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
  const filed = db.prepare('SELECT 1 FROM snapshots WHERE character_id = ? LIMIT 1')

  const fileMoment = legacyMoment(table.updatedAt)
  const rates = table.scoreVersion === SCORE_VERSION

  let characters = 0
  let skipped = 0

  for (const player of table.players) {
    if (!player || typeof player !== 'object') {
      skipped += 1
      continue
    }

    const region = String(player?.region || '').toLowerCase()
    const realm = String(player?.realm || '').toLowerCase()
    const name = String(player?.name || '').toLowerCase()

    if (!region || !realm || !name) {
      skipped += 1
      continue
    }

    const known = find.get(region, realm, name) as { id: number } | undefined
    const moment = legacyMoment(player.updatedAt) ?? fileMoment ?? legacyMoment(player.firstSeenAt)

    const id =
      known?.id ??
      rememberGuestRow({
        region,
        realm,
        name,
        realmName: player.realmName,
        displayName: player.displayName,
        avatar: player.avatar,
        classId: player.classId,
        level: player.level,
        faction: player.faction,
        firstSeenAt: legacyMoment(player.firstSeenAt) ?? fileMoment ?? undefined
      })

    // A character the database already has a reading for is left exactly as it is: that reading was taken in
    // full, and the file's row is a summary of one moment of the same character.
    if (filed.get(id)) continue

    // No moment the store ever kept: the row is kept as a character - its page still resolves, and its next
    // read files a point - but nothing is filed under a moment nobody recorded.
    if (moment === null) {
      skipped += 1
      continue
    }

    fileDailyReading(id, legacyFigures(player), moment)

    // A point whose rating cannot be honestly reproduced keeps its figures and no score, which is exactly what a
    // point written before a weight changed does (`snapshots.score`, `./db`). The reading was just filed at
    // `moment` and no earlier point exists (the character had no reading), so the moment names it exactly.
    if (!rates) {
      db.prepare('UPDATE snapshots SET score = NULL WHERE character_id = ? AND taken_at = ?').run(id, moment)
    }

    characters += 1
  }

  return { characters, skipped }
}

/**
 * Gives every account that has a reading its first point of history, and answers how many that was.
 *
 * The database has kept one character's readings for accounts since it was created, but an account's own totals
 * are a thing it has only just learned to keep (`account_snapshots`): without this, every account on the site
 * would show an empty history and no value in a distribution until something happened to refresh one of its
 * characters. `fileAccountReading` decides what a point is - a complete set, filed when it has moved - so an
 * account whose characters have never been read in full is simply left without one.
 */
function backfillAccounts(): number {
  const db = useDb()
  const accounts = db.prepare('SELECT DISTINCT user_id FROM characters WHERE user_id IS NOT NULL').all() as {
    user_id: number
  }[]
  const points = db.prepare('SELECT COUNT(*) AS n FROM account_snapshots WHERE user_id = ?')

  let filled = 0

  for (const account of accounts) {
    const before = (points.get(account.user_id) as { n: number }).n
    fileAccountReading(account.user_id)

    if ((points.get(account.user_id) as { n: number }).n > before) filled += 1
  }

  return filled
}
