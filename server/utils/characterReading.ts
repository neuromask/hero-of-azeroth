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
import type { DistributionResponse, HistorySeries, MetricKey } from '#shared/data/historySchema'
import { nowSec } from './db'
import { calculatePlayerScore } from './playerScore'
// The scale a histogram is cut by, and the empty buckets of one: the half of the rule that the chart and the
// SQL below have to agree on.
import { binEdges, DISTRIBUTION_BINS } from './distribution'
// Who the statistics are about, and how a memo of them is thrown away when that moves.
import { bumpStatisticsRevision, populationRows, statisticsRevision } from './statisticsPopulation'
// The season a stored Mythic+ rating is counted in: a score read before the season began counts as nothing.
import { seasonRating, seasonRatingSql } from './mplus'
// The row a guest's reading is drawn from, rewritten here the moment the reading moves.
import { refreshGuestRow } from './leaderboardRows'

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
        `SELECT c.level AS level, c.stats_read_at AS read_at, c.ilvl AS ilvl,
                s.mplus_score AS mplus, s.taken_at AS taken_at
           FROM characters c
           LEFT JOIN snapshots s ON s.id = (
             SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
           )
          WHERE c.region = ? AND c.realm_slug = ? AND c.name_key = ?
          LIMIT 1`
      )
      .get(region, String(realm).toLowerCase(), String(name).toLowerCase()) as
      | { level: number | null; read_at: number | null; ilvl: number | null; mplus: number | null; taken_at: number | null }
      | undefined

    if (!row) return null

    // The rating is read in the season Blizzard is running rather than in the one it was read in (`./mplus`): a
    // score from a season that has passed counts as nothing, and the live profile the caller holds wins with the
    // score of the season being played.
    return { ilvl: row.ilvl, mplus: seasonRating(row.mplus, row.taken_at), level: row.level, readAt: row.read_at }
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
 * a column cannot drift the reader and the writer apart. One metric rather than all fourteen, because a view
 * that draws one figure at a time should pay for one figure at a time. A character the site has no row for is
 * `null`.
 *
 * A character of an account is answered with the **account's** history rather than its own: what the statistics
 * count is the account (`./statisticsPopulation`), so a main and its alts show one curve - the account's own
 * figures, which is what every one of them prints beside it. A guest's history is its own reading.
 */
export function readCharacterHistory(
  region: string,
  realm: string,
  name: string,
  metric: MetricKey
): HistorySeries | null {
  const db = useDb()
  const row = db
    .prepare(
      'SELECT id, user_id, display_name FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ? LIMIT 1'
    )
    .get(region, realm, name) as { id: number; user_id: number | null; display_name: string | null } | undefined

  if (!row) return null

  // The Mythic+ rating is counted in the season Blizzard is running rather than in the one it was read in
  // (`./mplus`): a point read before the season began reads as nothing, which is where a new season starts.
  const column =
    metric === 'mPlusScore' ? seasonRatingSql(METRIC_COLUMNS[metric], 'taken_at') : METRIC_COLUMNS[metric]

  const points =
    row.user_id === null
      ? (db
          .prepare(`SELECT taken_at, ${column} AS value FROM snapshots WHERE character_id = ? ORDER BY taken_at ASC`)
          .all(row.id) as Array<{ taken_at: number; value: number | null }>)
      : (db
          .prepare(`SELECT taken_at, ${column} AS value FROM account_snapshots WHERE user_id = ? ORDER BY taken_at ASC`)
          .all(row.user_id) as Array<{ taken_at: number; value: number | null }>)

  return {
    character: { region, realm, name, displayName: row.display_name },
    metric,
    points: points.map((point) => ({ takenAt: point.taken_at, value: point.value ?? null }))
  }
}

/**
 * The distributions already answered, and the revision of the data they were answered at.
 *
 * A comparison board asks for one metric's distribution every time a stat row is opened, and the answer is the
 * population's rather than a reader's: a pass over the population to cut the bars, another to place the players
 * named beside them. Both are worth not paying twice, so the whole answer is kept until the data moves.
 *
 * Two things bound it. The key is a metric and the players a caller named - at most four addresses
 * (`parsePlayers` in `server/api/distribution`) - and the map is capped: the oldest entry is dropped when a new
 * one arrives, which is what keeps a caller walking through metrics and pairs from growing it without end. The
 * revision is what makes it correct: every write that moves the population calls `bumpStatisticsRevision`, so a
 * stale entry is unreachable rather than merely old.
 */
const DISTRIBUTION_MEMO_LIMIT = 64
const distributionMemo = new Map<string, { revision: number; answer: DistributionResponse }>()

/**
 * One metric's distribution over the site's own readings, for every one of the fourteen figures.
 *
 * The population is the one `./statisticsPopulation` describes - every guest the site has read, and the main of
 * every account that signed in, and nobody else - which is the same population a history is drawn from and the
 * same one the hall of fame's table draws. An alt, an account that asked to be left out of the table, and a
 * character the sitemap knows of but nobody has read are all absent, deliberately.
 *
 * It is also deliberately small in memory, and that is the point of its shape. The scale is cut by the shared
 * rule (`./distribution`) and the counts are grouped in SQL, so what comes back is one row per bucket -
 * twenty-four of them - however many characters the site has read; a player's place is a `SUM` over the same
 * walk rather than a list of figures to sort. Nothing here grows with the population but the time it takes,
 * which is what lets a population of two hundred thousand be drawn by the same code as a population of ten.
 *
 * A key the site has never read is answered with `null`s rather than a fabricated place.
 */
export function readSnapshotDistribution(metric: MetricKey, playerKeys: string[]): DistributionResponse {
  const memoKey = `${metric}|${playerKeys.join(',')}`
  const at = statisticsRevision()

  const answered = distributionMemo.get(memoKey)
  if (answered && answered.revision === at) return answered.answer

  const db = useDb()
  const column = METRIC_COLUMNS[metric]

  // The population's readings, one per member, at the newest point of each. A figure a reading does not carry is
  // left out rather than counted as a zero, which is what keeps a collection nobody has read out of the bars.
  const readings = `SELECT value, taken_at FROM (${populationRows(column)}) WHERE value IS NOT NULL`

  // The players' own figures, each a keyed lookup rather than a walk: the *member* the key names - a guest's own
  // newest reading, an account's own newest totals - which is the very figure the histogram counts and the one
  // every other page prints for them (`./statisticsPopulation`). A character of an account is answered with the
  // account's figure, so a main and each of its alts are placed in the same bucket, and a character whose own
  // reading never carried a figure - a collection only the account's own point has - is placed by the account
  // rather than left off the chart.
  const own = playerKeys.map((key) => {
    const [region = '', realm = '', ...rest] = key.split(':')
    const row = db
      .prepare(
        `SELECT CASE WHEN c.user_id IS NULL THEN s.${column} ELSE a.${column} END AS value
           FROM characters c
           LEFT JOIN snapshots s ON s.id = (
             SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
           )
           LEFT JOIN account_snapshots a ON a.id = (
             SELECT id FROM account_snapshots WHERE user_id = c.user_id ORDER BY taken_at DESC LIMIT 1
           )
          WHERE c.region = ? AND c.realm_slug = ? AND c.name_key = ?
          LIMIT 1`
      )
      .get(region, realm, rest.join(':')) as { value: number | null } | undefined

    return typeof row?.value === 'number' ? row.value : null
  })

  // One row for the whole population: how many characters hold a figure at all, the two ends of the scale the
  // buckets are cut over, when those readings were taken, and how many figures stand above each player. The
  // count above a figure is a sum over the same walk, which is what keeps this one row and not one per
  // character.
  const aboveColumns = playerKeys.map((_, index) => `, SUM(value > ?) AS above_${index}`).join('')
  const totals = db
    .prepare(
      `WITH readings AS (${readings})
       SELECT COUNT(value) AS population, MIN(value) AS lo, MAX(value) AS hi, MAX(taken_at) AS newest${aboveColumns}
         FROM readings`
    )
    .get(...own) as Record<string, number | null>

  const population = Number(totals.population ?? 0)
  const lo = Number(totals.lo ?? 0)
  const hi = Number(totals.hi ?? 0)
  const newest = Number(totals.newest ?? 0)

  // The scale, cut the way the table's own histogram cuts it, with the counts read off the database's buckets.
  const bins = population ? binEdges(lo, hi) : []
  if (population) {
    const counts = db
      .prepare(
        `WITH readings AS (${readings})
         SELECT MIN(${DISTRIBUTION_BINS - 1}, CAST((value - ?) * ${DISTRIBUTION_BINS} / ? AS INTEGER)) AS bin,
                COUNT(*) AS count
           FROM readings
          GROUP BY bin`
      )
      .all(lo, hi - lo || 1) as Array<{ bin: number; count: number }>

    for (const bucket of counts) {
      const edge = bins[bucket.bin]
      if (edge) edge.count = bucket.count
    }
  }

  const answer: DistributionResponse = {
    metric,
    bins,
    population,
    positions: playerKeys.map((key, index) => {
      const value = own[index] ?? null
      const above = value === null ? null : Number(totals[`above_${index}`] ?? 0)
      const rank = above === null ? null : above + 1

      return {
        key,
        value,
        rank,
        percentile: rank !== null && population ? Math.max(1, Math.round((rank / population) * 100)) : null
      }
    }),
    updatedAt: newest ? new Date(newest * 1000).toISOString() : ''
  }

  // Kept until the data moves, and never beyond the cap: a map hands its keys back in the order they were
  // added, so the first one is the oldest.
  distributionMemo.set(memoKey, { revision: at, answer })
  if (distributionMemo.size > DISTRIBUTION_MEMO_LIMIT) {
    const oldest = distributionMemo.keys().next().value
    if (oldest !== undefined) distributionMemo.delete(oldest)
  }

  return answer
}

/**
 * A reading as a caller hands it in: the figures a profile carries, any of which may be missing.
 *
 * `CharacterData` is what a full Blizzard read answers with, and it is what the two readers of a profile hand
 * over. A caller that has read *one* figure hands over that one - the tray fetches the wardrobe, which no profile
 * carries (`server/api/transmog`) - and everything it does not say is carried forward from the newest point
 * already on file, exactly as a partial profile is (`fileDailyReading` below). So the shape is the profile with
 * every field optional, its nested stats included.
 */
export type ProfileReading = Partial<Omit<CharacterData, 'stats'>> & { stats?: Partial<CharacterData['stats']> }

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
 *
 * `readAt` is the moment the reading was taken, in seconds, and it is now unless a caller says otherwise. The
 * two readers of a profile file the second they read it; the migration that moves the hall of fame's own table
 * into the database (`./statisticsMigration`) files the day that table recorded instead, because a reading taken
 * days ago must not be filed as one taken now - a history would then start with a point that never happened.
 */
export function fileDailyReading(characterId: number, profile: ProfileReading, readAt?: number): void {
  const db = useDb()
  const moment = readAt ?? nowSec()

  db.prepare('UPDATE characters SET stats_read_at = ? WHERE id = ?').run(moment, characterId)

  // The item level is not a figure of the reading any more: it is what the character *wears*, so it is written on
  // the character's own row, beside its level (`./db`) - and only where this reading carries one, so a lookup that
  // did not ask for it leaves the figure that is there alone. That is the rule the readings state for a figure
  // they do not carry, applied to a fact that lives one level up.
  if (typeof profile.ilvl === 'number') {
    db.prepare('UPDATE characters SET ilvl = ? WHERE id = ?').run(profile.ilvl, characterId)
  }

  const reading: Record<string, number | null> = {
    mplus_score: profile.mPlusScore ?? null,
    achievements: profile.ap ?? null,
    // The collections a profile carries, each read only where it is there: a caller that has read one figure
    // hands over one figure, and the four below are carried forward from the newest point like everything else.
    mounts: profile.stats?.mounts?.count ?? null,
    pets: profile.stats?.pets?.count ?? null,
    toys: profile.stats?.toys?.count ?? null,
    decor: profile.stats?.decor?.count ?? null,
    reputations: profile.stats?.reputations?.count ?? null,
    // And the figures beside the collections. Each is the character's own reading where the profile carries
    // one, and `null` where it does not - the appearance sources, which a page read does not fetch - which is
    // what keeps a figure read by the account sync from being blanked by a page that never asked for it.
    titles: profile.stats?.titles?.count ?? null,
    quests: profile.stats?.quests?.count ?? null,
    recipes: profile.stats?.recipes?.count ?? null,
    transmogs: profile.stats?.transmogs?.count ?? null,
    honorable_kills: profile.stats?.honorableKills?.count ?? null,
    honor_level: profile.stats?.honorLevel?.count ?? null
  }

  const latest = db
    .prepare(
      `SELECT mplus_score, achievements, mounts, pets, toys, decor, reputations,
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

    // Nothing moved since the newest point, so the log keeps it as is. The row the table draws a member by is
    // not the log, though, and it is still kept true: it is read from the character itself - its level, the item
    // level it wears, its portrait - as well as from the newest reading, so a re-read that changed only those
    // moves the row without moving a figure (`refreshRowOfMember`).
    if (Object.keys(next).every((key) => next[key] === latest[key])) {
      refreshRowOfMember(characterId)
      return
    }
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
  const takenAt = latest && latest.taken_at >= moment ? latest.taken_at + 1 : moment

  // Sixteen values is more than `node:sqlite`'s typed overloads name, so they go over as one list.
  const values = [
    characterId,
    takenAt,
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
       (character_id, taken_at, mplus_score, achievements, mounts, pets, toys, decor, reputations,
        titles, quests, recipes, transmogs, honorable_kills, honor_level, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(...(values as any[]))

  // A reading was filed, so the population's aggregates are stale from this moment: a distribution memo keyed on
  // the revision cannot answer from before it (`./statisticsPopulation`).
  bumpStatisticsRevision()

  // And the row itself, when the character is nobody's - which is the same call whether or not a point was
  // filed above, because the row is not made of the point alone.
  refreshRowOfMember(characterId)
}

/**
 * Keeps the row the hall of fame draws a member by true, after a character has been read.
 *
 * A guest is a member of the population in its own right and its row holds this character's own figures, so the
 * row is rewritten here rather than left for a rebuild (`./leaderboardRows`). A character an account holds is not
 * a member of its own - the account's totals are the row - and it is the caller that files those
 * (`fileAccountReading` in `./accountPool`), which is what moves it.
 *
 * The rewrite happens whether or not a point was filed, and that is the point of it being a call of its own: a
 * row carries figures that are not metrics - the level, the item level the character wears, the portrait, the
 * name - and a re-read that changed only one of those moves the row while the history keeps the point it had.
 */
function refreshRowOfMember(characterId: number): void {
  const owner = useDb()
    .prepare('SELECT region, realm_slug, name_key, user_id FROM characters WHERE id = ?')
    .get(characterId) as { region: string; realm_slug: string; name_key: string; user_id: number | null } | undefined

  if (owner && owner.user_id === null) refreshGuestRow(owner.region, owner.realm_slug, owner.name_key)
}
