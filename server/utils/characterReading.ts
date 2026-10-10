/**
 * The site's own record of what a character was the last time it was read.
 *
 * Two things are kept per character and they are read in one place here: the day's reading in
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
 * so the two can never file a day's row differently. The reading is keyed to the day, which makes the
 * record a step chart rather than a log: reading the same character twice in an afternoon updates one row
 * rather than adding a second.
 */
import type { CharacterData } from './blizzard'
import { nowSec } from './db'

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
 * are the same character, and the day a row is keyed to is bookkeeping rather than a boundary a reader
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
 * Files a character's reading as the day's own, along with the moment it was taken.
 *
 * The moment is written first and always: `stats_read_at` is what a character page weighs its own cached
 * Blizzard reading against (`readCharacterReading`), and a read that happened has happened whether or not
 * the figures below moved.
 *
 * The figures are written per day, replacing the day's copy when there is one, and a figure the reading
 * does not carry keeps what the day already holds - the way a partial profile does not erase the table's
 * row: a lookup whose reputation read timed out must not blank a number that was read this morning. A day
 * already holding these very figures is left alone, so a page the site has read today costs the disk
 * nothing beyond the moment above.
 */
export function fileDailyReading(characterId: number, profile: CharacterData, dayStart: number): void {
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
    reputations: profile.stats.reputations?.count ?? null
  }

  const stored = db
    .prepare(
      `SELECT ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations
         FROM snapshots WHERE character_id = ? AND taken_at = ?`
    )
    .get(characterId, dayStart) as Record<string, number | null> | undefined

  // What the day will hold: the reading, with whatever it does not say taken from the morning's copy.
  const next: Record<string, number | null> = { ...reading }
  if (stored) {
    for (const key of Object.keys(next)) {
      if (next[key] === null) next[key] = stored[key] ?? null
    }

    if (Object.keys(next).every((key) => next[key] === stored[key])) return
  }

  db.prepare('DELETE FROM snapshots WHERE character_id = ? AND taken_at = ?').run(characterId, dayStart)
  db.prepare(
    `INSERT INTO snapshots (character_id, taken_at, ilvl, mplus_score, achievements, mounts, pets, toys, decor, reputations)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    characterId,
    dayStart,
    next.ilvl,
    next.mplus_score,
    next.achievements,
    next.mounts,
    next.pets,
    next.toys,
    next.decor,
    next.reputations
  )
}
