/**
 * The day a moment belongs to, in the one reckoning the site uses: seconds since the epoch, cut into days of
 * 86400, so a day begins at midnight UTC.
 *
 * It is the smallest thing a history holds. A reading is filed for the *moment* it was taken - which is what a
 * page weighs a live Blizzard answer against (`characters.stats_read_at`) - but the point it is filed as belongs
 * to its day: a second reading inside that day rewrites the day's point rather than filing another one beside it
 * (`fileDailyReading` in `server/utils/characterReading`), which is what keeps a history a history of days rather
 * than a log of presses, and what keeps one press from costing a row. The same cut decides which day a reading
 * belongs to on the profile page, which prints that day beside each character (`app/pages/profile.vue`), and on
 * the server, which files the point - so the rule is written here rather than on either side of the wire.
 */
export const SECONDS_PER_DAY = 86_400

/**
 * The first second of the day `seconds` belongs to.
 *
 * The day's own start, rather than its number, because both of its readers work in the same seconds everything
 * else does: the writer asks which points of a day are already on file between `dayStartOf(moment)` and
 * `dayStartOf(moment) + SECONDS_PER_DAY`, and the profile page stamps the day a reading belongs to with it.
 */
export function dayStartOf(seconds: number): number {
  return Math.floor(seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY
}
