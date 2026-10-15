/**
 * The shapes the history and distribution endpoints serve, and the metrics they cover.
 *
 * A character's history is one point per real update, read from `snapshots` (`server/utils/characterReading`),
 * and its distribution is where that character stands inside the canonical leaderboard
 * (`server/utils/leaderboardStorage`). Both ends of the wire need the same list of metrics, so the list lives
 * here - the only thing the frontend is told about the data, exactly as the leaderboard's own shapes live in
 * `leaderboardSchema`.
 */

/**
 * The fifteen metrics a snapshot holds, in the order the wire names them.
 *
 * The names are camelCase - the same spelling the leaderboard's row and the profile use - while the snapshot's
 * own columns are the snake_case the database keeps (`mplus_score`, `honorable_kills`, `honor_level`). The
 * mapping between the two is one place (`server/utils/characterReading`).
 */
export const METRIC_KEYS = [
  'score',
  'ilvl',
  'mPlusScore',
  'achievements',
  'mounts',
  'pets',
  'toys',
  'decor',
  'reputations',
  'titles',
  'quests',
  'recipes',
  'transmogs',
  'honorableKills',
  'honorLevel'
] as const

export type MetricKey = (typeof METRIC_KEYS)[number]

/**
 * The metrics that really exist in the canonical leaderboard, so a distribution can be drawn for them.
 *
 * The other five (`titles`, `quests`, `recipes`, `transmogs`, `honorLevel`) are stored and graphed as history,
 * but they have no population to stand in - the leaderboard never carried them, and a distribution mixed out of
 * a separate account population would be a different table wearing the same name (decision B). The UI shows
 * their history and, instead of a histogram, a plain "distribution unavailable" state.
 */
export const DISTRIBUTION_METRICS = [
  'score',
  'mounts',
  'decor',
  'mPlusScore',
  'honorableKills',
  'achievements',
  'pets',
  'toys',
  'reputations',
  'ilvl'
] as const satisfies readonly MetricKey[]

/** The metric keys a distribution can be drawn of, which is `DISTRIBUTION_METRICS` as a union. */
export type DistributionMetricKey = (typeof DISTRIBUTION_METRICS)[number]

/** One point of one metric's history: the moment it was read, and the figure - `null` where the read had none. */
export interface HistorySeriesPoint {
  takenAt: number
  value: number | null
}

/** One metric's history for one character, oldest point first. */
export interface HistorySeries {
  character: {
    region: string
    realm: string
    name: string
    displayName: string | null
  }
  metric: MetricKey
  points: HistorySeriesPoint[]
}

/** One histogram bucket: the range a figure falls in, and how many players hold a figure inside it. */
export interface DistributionBin {
  from: number
  to: number
  count: number
}

/** Where one player stands in a metric's distribution, keyed the way the table keys a row. */
export interface DistributionPosition {
  /** `region:realm:name`, lowercased: the string the leaderboard keys a row by. */
  key: string
  /** The player's own figure for this metric, or `null` when the table has none. */
  value: number | null
  /** The player's place, one-based with the highest figure first, or `null` when there is none to place. */
  rank: number | null
  /** The place as a whole percent from the top (`1` = in the top 1%), or `null`. */
  percentile: number | null
}

/**
 * One metric's distribution over the canonical leaderboard, shared by every player a caller named.
 *
 * The histogram is the population's, so it is the same for all of them and one answer serves a whole
 * comparison (`players` below); the positions are the players' own, one per key the caller asked about.
 */
export interface DistributionResponse {
  metric: MetricKey
  bins: DistributionBin[]
  /** How many players hold a figure for this metric at all. */
  population: number
  positions: DistributionPosition[]
  /** When the data behind the answer was last written, so a reader can judge how fresh it is. */
  updatedAt: string
}
