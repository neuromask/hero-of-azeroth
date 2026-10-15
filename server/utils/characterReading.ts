/**
 * The site's own record of what a character was the last time it was read.
 *
 * Two things are kept per character and they are read in one place here: the reading in
 * `snapshots` - every figure a tile or a table's row prints, filed by the background pass and by any
 * page or card that read the character in full - and the moment that reading was taken, on the
 * character's own row (`characters.stats_read_at`).
 *
 * The module exists because those figures have several readers and they have to answer the same question
 * the same way: the account's collections are computed from these readings (`server/utils/accountPool`),
 * the profile page draws them, and a character page weighs its own, possibly cached, Blizzard reading
 * against them - and a second reader is a second opinion unless the record is read in one place.
 *
 * The writing is one function too (`fileDailyReading`), called from both of the places a reading is taken,
 * so the two can never file a point differently. A point is one real update rather than a day: reading the
 * same character twice in an afternoon leaves one new point only when the figures actually moved, which is
 * what keeps the history an honest log of change and not a wall of repeated readings.
 */
import type { CharacterData } from './blizzard'
import type { HistorySeries, MetricKey } from '#shared/data/historySchema'
import { nowSec } from './db'
import { calculatePlayerScore } from './playerScore'

/**
 * What the site knows about a character of its own, apart from the collections the account's figures are
 * merged into: the figures that really are one character's, and the moment they were read.
 *
 * `readAt` is what makes them usable. A character page holds a Blizzard reading of its own, cached for two
 * hours (`server/utils/swrCache`), and the only way to tell that reading from a stored one - which of the
 * two a reader should be shown - is to know when each was taken. A reading whose moment is not on file is
 * not weighed against one that has a moment: it is older than anything the site timed.
 */
export interface CharacterReading {
  ilvl: number | null
  mplus: number | null
  level: number | null
  /** When the reading was taken, as seconds since the epoch, or `null` when nothing timed it. */
  readAt: number | null
}

/**
 * The newest reading of a character, or `null` for one the site has no row for.
 *
 * The newest rather than today's: a reading filed just before midnight and a page opened just after it
 * are the same character, and a point's moment is bookkeeping rather than a boundary a reader
 * should be able to see.
 */
export function readCharacterReading(region: string, realm: string, name: string): CharacterReading | null {
  try {
    const row = useDb()
      .prepare(
        `SELECT c.level AS level, c.stats_read_at AS read_at, s.ilvl AS ilvl, s.mplus_score AS mplus
           FROM characters c
           LEFT JOIN snapshots s ON s.id = (
             SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
           )
          WHERE c.region = ? AND c.realm_slug = ? AND c.name_key = ?
          LIMIT 1`
      )
      .get(region, String(realm).toLowerCase(), String(name).toLowerCase()) as
      | { level: number | null; read_at: number | null; ilvl: number | null; mplus: number | null }
      | undefined

    if (!row) return null

    return { ilvl: row.ilvl, mplus: row.mplus, level: row.level, readAt: row.read_at }
  } catch {
    // No database, or none with this character: the caller keeps its own reading, which is the honest
    // answer for a site that has never stored one.
    return null
  }
}

/**
 * The snapshot column each wire metric is kept in, read in one place.
 *
 * The wire and the views speak camelCase (`mPlusScore`, `honorableKills`), the database keeps the snake_case
 * it was written with (`mplus_score`, `honorable_kills`) - and the mapping is written down once, here, so a
 * reader and the writer above can never drift apart over a column's name. The keys are the metric union, so a
 * metric added to the wire without a column does not compile.
 */
const METRIC_COLUMNS: Record<MetricKey, string> = {
  score: 'score',
  ilvl: 'ilvl',
  mPlusScore: 'mplus_score',
  achievements: 'achievements',
  mounts: 'mounts',
  pets: 'pets',
  toys: 'toys',
  decor: 'decor',
  reputations: 'reputations',
  titles: 'titles',
  quests: 'quests',
  recipes: 'recipes',
  transmogs: 'transmogs',
  honorableKills: 'honorable_kills',
  honorLevel: 'honor_level'
}

/**
 * One metric's history for a character, oldest point first.
 *
 * Read here, beside `fileDailyReading`, because the point's shape is the writer's business: the snapshot's
 * snake_case column is mapped to the camelCase the wire speaks in one place (`METRIC_COLUMNS`), so a change to
 * a column cannot drift the reader and the writer apart. One metric rather than all fifteen, because a view
 * that draws one figure at a time should pay for one figure at a time. A character the site has no row for is
 * `null`.
 */
export function readCharacterHistory(
  region: string,
  realm: string,
  name: string,
  metric: MetricKey
): HistorySeries | null {
  const db = useDb()
  const row = db
    .prepare('SELECT id, display_name FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1')
    .get(region, realm, name) as { id: number; display_name: string | null } | undefined

  if (!row) return null

  const points = db
    .prepare(`SELECT taken_at, ${METRIC_COLUMNS[metric]} AS value FROM snapshots WHERE character_id = ? ORDER BY taken_at ASC`)
    .all(row.id) as Array<{ taken_at: number; value: number | null }>

  return {
    character: { region, realm, name, displayName: row.display_name },
    metric,
    points: points.map((point) => ({ takenAt: point.taken_at, value: point.value ?? null }))
  }
}

/**
 * Files a character's reading as its own point, along with the moment it was taken.
 *
 * The moment is written first and always: `stats_read_at` is what a character page weighs its own cached
 * Blizzard reading against (`readCharacterReading`), and a read that happened has happened whether or not
 * the figures below moved.
 *
 * The figures are written as one point per real update, not one per day: a figure the reading does not carry
 * keeps what the newest point already holds - the way a partial profile does not erase the record: a lookup
 * whose reputation read timed out must not blank a number that was read this morning. A point already holding
 * these very figures is left alone, so a page the site has read again costs the disk nothing beyond the
 * moment above.
 */
export function fileDailyReading(characterId: number, profile: CharacterData): void {
  const db = useDb()

  db.prepare('UPDATE characters SET stats_read_at = ? WHERE id = ?').run(nowSec(), characterId)

  const reading: Record<string, number | null> = {
    ilvl: profile.ilvl ?? null,
    mplus_score: profile.mPlusScore ?? null,
    achievements: profile.ap ?? null,
    mounts: profile.stats.mounts.count,
    pets: profile.stats.pets.count,
    toys: profile.stats.toys.count,
    decor: profile.stats.decor.count,
    reputations: profile.stats.reputations?.count ?? null,
    // And the figures beside the collections. Each is the character's own reading where the profile carries
    // one, and `null` where it does not - the appearance sources, which a page read does not fetch - which is
    // what keeps a figure read by the account sync from being blanked by a page that never asked for it.
    titles: profile.stats.titles?.count ?? null,
    quests: profile.stats.quests?.count ?? null,
    recipes: profile.stats.recipes?.count ?? null,
    transmogs: profile.stats.transmogs?.count ?? null,
    honorable_kills: profile.stats.honorableKills?.count ?? null,
    honor_level: profile.stats.honorLevel?.count ?? null
  }

  const latest = db
    .prepare(
      `SELECT ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations,
              titles, quests, recipes, transmogs, honorable_kills, honor_level, taken_at
         FROM snapshots WHERE character_id = ? ORDER BY taken_at DESC LIMIT 1`
    )
    .get(characterId) as (Record<string, number | null> & { taken_at: number }) | undefined

  // What the point will hold: the reading, with whatever it does not say kept from the newest snapshot, so
  // a partial profile never blanks a figure that was read before.
  const next: Record<string, number | null> = { ...reading }
  if (latest) {
    for (const key of Object.keys(next)) {
      if (next[key] === null) next[key] = latest[key] ?? null
    }

    // Nothing moved since the newest point, so the log keeps it as is.
    if (Object.keys(next).every((key) => next[key] === latest[key])) return
  }

  // The overall rating, computed only when all six figures it weighs are present - a partial read leaves
  // the point without a score rather than a wrong one.
  const score =
    [next.achievements, next.mounts, next.pets, next.toys, next.decor, next.reputations].every(
      (value) => typeof value === 'number'
    )
      ? calculatePlayerScore({
          achievements: next.achievements as number,
          mounts: next.mounts as number,
          pets: next.pets as number,
          toys: next.toys as number,
          decor: next.decor as number,
          reputations: next.reputations as number
        })
      : null

  // A point is one real update, so its moment is the second it was read - and never earlier than the newest
  // point already on file, so two reads inside one second cannot collide on the unique key.
  const now = nowSec()
  const takenAt = latest && latest.taken_at >= now ? latest.taken_at + 1 : now

  // Seventeen values is more than `node:sqlite`'s typed overloads name, so they go over as one list.
  const values = [
    characterId,
    takenAt,
    next.ilvl,
    next.mplus_score,
    next.achievements,
    next.mounts,
    next.pets,
    next.toys,
    next.decor,
    next.reputations,
    next.titles,
    next.quests,
    next.recipes,
    next.transmogs,
    next.honorable_kills,
    next.honor_level,
    score
  ]

  db.prepare(
    `INSERT INTO snapshots
       (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations,
        titles, quests, recipes, transmogs, honorable_kills, honor_level, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(...(values as any[]))
}
