/**
 * The overall rating the leaderboard is ordered by, and the weights it is made of.
 *
 * A leaderboard needs one number per player - otherwise the "total score" tab is a different
 * question on every read - and that number has to be written down rather than worked out from
 * whatever the table happens to be showing. So it is computed once, when a profile is stored
 * (see `server/utils/leaderboardStorage.ts`), and read back as a plain column afterwards.
 *
 * The weights are the ones the site ranks collections by, and they are multipliers rather than a
 * statement of "importance": a mount is worth twenty-five achievement points, a toy fifteen, and a
 * piece of decor or a pet five. Only what a character has *collected* is weighed - mounts, pets, toys,
 * decor and the achievement points behind them - so a Mythic+ rating or an item level, earned by
 * playing or simply worn, never decides where a collector stands. The figures in the comments are what
 * a fully collected character of the current expansion brings, which is what a later category
 * (transmog, reputations) should be weighed against.
 *
 * Adding a category is one line in the table plus one field in the profile the storage writes - and a
 * bump of `SCORE_VERSION`, which is what re-derives the ratings already on file.
 */
export const SCORE_WEIGHTS = {
  /** ~45 000 achievement points, which is why this weight is the smallest of the five. */
  achievements: 1,
  /** ~1200 mounts in the journal: the collection the site weighs most heavily. */
  mounts: 25,
  /** ~950 toys. */
  toys: 15,
  /** ~1480 decor pieces, which is why this weight sits with the pets rather than above them. */
  decor: 5,
  /** ~1500 pets, counted by species. */
  pets: 5
} as const

/**
 * The weights' own version, bumped whenever a multiplier above changes.
 *
 * A rating is stored with the record rather than derived on read (see the note at the top of this
 * file), so a change to the table above would otherwise leave every record written before it carrying
 * a number the current formula would not produce. The storage reads this stamp off the file and
 * re-derives every rating once when it does not match - which is what makes a weight a one-line edit
 * that reaches the whole table, rather than only the characters looked up afterwards.
 */
export const SCORE_VERSION = 3

/**
 * The part of a stored record the rating is computed from: the five categories it weighs.
 *
 * A profile carries more than this - the Mythic+ rating, the item level, the level itself - and none of
 * it is part of the overall score: this is a collector's rating, and a figure a character earns by
 * playing (a key rating) or simply wears (an item level) is not something it gathered.
 */
export interface ScoreInput {
  achievements: number
  mounts: number
  toys: number
  decor: number
  pets: number
}

/**
 * The overall rating of a player: every category multiplied by its weight, added up and rounded.
 *
 * A missing or nonsensical figure counts as zero rather than poisoning the sum with `NaN`, which is
 * what keeps a record backfilled from a thinner source (the sitemap's index knows a character's mounts
 * but not its decor) a legitimate, low-scoring entry instead of a broken one.
 */
export function calculatePlayerScore(profile: ScoreInput): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  const total =
    value(profile.achievements) * SCORE_WEIGHTS.achievements +
    value(profile.mounts) * SCORE_WEIGHTS.mounts +
    value(profile.toys) * SCORE_WEIGHTS.toys +
    value(profile.decor) * SCORE_WEIGHTS.decor +
    value(profile.pets) * SCORE_WEIGHTS.pets

  return Math.round(total)
}

/**
 * How many collectables a player holds altogether, which is what the "king of collections" widget
 * counts. Kept here beside the weights so the two ways of measuring a player are read in one place:
 * this one is a plain count, the rating above is a weighted one.
 */
export function totalCollectables(profile: Pick<ScoreInput, 'mounts' | 'pets' | 'toys' | 'decor'>): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  return value(profile.mounts) + value(profile.pets) + value(profile.toys) + value(profile.decor)
}