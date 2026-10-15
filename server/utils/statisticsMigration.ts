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
import { nowSec } from './db'
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

/** What the migration moved, which is what a startup log line is made of. */
export interface StatisticsMigration {
  /** How many characters the file held that the database had no reading for. */
  characters: number
  /** How many accounts were given their first point of history. */
  accounts: number
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
  const players = await readLegacyTable()

  return {
    characters: players.length ? seedCharacters(players) : 0,
    accounts: backfillAccounts()
  }
}

/** The rows of the file the table used to be kept in, or none at all for a site that never had one. */
async function readLegacyTable(): Promise<LegacyPlayer[]> {
  try {
    const file = JSON.parse(await readFile(LEGACY_FILE, 'utf8')) as { players?: LegacyPlayer[] }
    return Array.isArray(file?.players) ? file.players : []
  } catch {
    // No file, or one this build cannot read: nothing to move.
    return []
  }
}

/** One day of the file, as the second it began at: the only moment that store ever kept. */
function dayStart(day?: string): number {
  const at = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(at) ? Math.floor(at / 1000) : nowSec()
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
 * Files every character of the file the database has no reading for, and answers how many that was.
 *
 * A row is matched by its address, so a character that is already in the database - as an account's or as a
 * guest - is not written twice, and one whose row exists but has no reading is given one rather than skipped.
 * The reading is filed at the day the row was written, which is the only moment that store kept.
 */
function seedCharacters(players: LegacyPlayer[]): number {
  const db = useDb()
  const find = db.prepare('SELECT id FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
  const filed = db.prepare('SELECT 1 FROM snapshots WHERE character_id = ? LIMIT 1')

  let seeded = 0

  for (const player of players) {
    const region = String(player?.region || '').toLowerCase()
    const realm = String(player?.realm || '').toLowerCase()
    const name = String(player?.name || '').toLowerCase()
    if (!region || !realm || !name) continue

    const known = find.get(region, realm, name) as { id: number } | undefined

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
        firstSeenAt: dayStart(player.firstSeenAt)
      })

    // A character the database already has a reading for is left exactly as it is: that reading was taken in
    // full, and the file's row is a summary of one moment of the same character.
    if (filed.get(id)) continue

    fileDailyReading(id, legacyFigures(player), dayStart(player.updatedAt))
    seeded += 1
  }

  return seeded
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
