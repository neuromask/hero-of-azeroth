/**
 * The Mythic+ season the site's stored ratings are counted in.
 *
 * Blizzard resets a character's Mythic+ rating when a season ends: the score of the season just finished belongs
 * to that season, and a character that has not played the new one stands at nothing rather than at what it scored
 * in the old one. The site keeps every reading it takes (`snapshots`, `account_snapshots`), so the figure a table
 * or a tile would print for a character nobody has re-read since is the *old* season's - and that is what this
 * stamp is for: a stored rating counts only when it was read at or after the moment below, and one read before it
 * counts as **zero**, because a season that has just begun is a count that starts from nothing.
 *
 * `0` means no season has been recorded, and every stored rating counts - which is what a site that has only ever
 * known one season wants, and what keeps this rule from quietly zeroing a table. A rating the site has never read
 * is left `null` rather than turned into a zero: "not read" and "nothing yet this season" are different answers,
 * and every page prints the first as a dash.
 *
 * The stamp is a constant rather than a query, and reading it from Blizzard instead is a task of its own. The
 * season index (`/data/wow/mythic-keystone/season/index`, the static namespace) answers with the season that is
 * running and the moment it began, and a site that read it would want a cache in front of it and a refresh that
 * never sits in front of a reader - the shape `refreshMountJournal` (`./armory`) already has. Every rule below
 * takes the moment as an argument, so that task is a matter of handing them a cached value rather than this
 * constant, and of warming the cache once at startup (`server/plugins/statisticsMigration`).
 *
 * Only the *stored* figures need this. A live Blizzard reading is always of the season being played, which is why
 * the profile a page has just fetched never passes through here.
 *
 * The one place that does *not* read a stored rating through this rule is a distribution
 * (`readSnapshotDistribution`): the scale of a histogram is cut from the population's own figures in one query
 * (`./statisticsPopulation`), and the Mythic+ rating has no panel of its own since it left the comparison board
 * for the table. A metric whose panel is drawn again would be read through here as well.
 */
export const MPLUS_SEASON_STARTED_AT = 0

/** Whether a rating read at `takenAt` was read in the season being counted. */
export function isCurrentSeason(
  takenAt: number | null | undefined,
  seasonStartedAt = MPLUS_SEASON_STARTED_AT
): boolean {
  return seasonStartedAt === 0 || (typeof takenAt === 'number' && takenAt >= seasonStartedAt)
}

/** A stored rating as the season counts it: the figure, zero for a season that has passed, `null` for none read. */
export function seasonRating(
  value: number | null,
  takenAt: number | null | undefined,
  seasonStartedAt = MPLUS_SEASON_STARTED_AT
): number | null {
  if (value === null || seasonStartedAt === 0) return value

  return isCurrentSeason(takenAt, seasonStartedAt) ? value : 0
}

/**
 * The same rule as SQL, for the reads that count a stored rating inside the database: the column, zero when its
 * point was read before the season began, and `null` when there is no figure at all. With no season recorded the
 * column stands on its own, so a query built through here is the query it always was.
 */
export function seasonRatingSql(
  valueColumn: string,
  takenAtColumn: string,
  seasonStartedAt = MPLUS_SEASON_STARTED_AT
): string {
  if (seasonStartedAt === 0) return valueColumn

  return `CASE WHEN ${valueColumn} IS NULL THEN NULL
               WHEN COALESCE(${takenAtColumn}, 0) >= ${seasonStartedAt} THEN ${valueColumn}
               ELSE 0 END`
}
