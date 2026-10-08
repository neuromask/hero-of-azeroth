/**
 * The overall rating the leaderboard is ordered by, and the weights it is made of.
 *
 * A leaderboard needs one number per player - otherwise the "total score" tab is a different
 * question on every read - and that number has to be written down rather than worked out from
 * whatever the table happens to be showing. So it is computed once, when a profile is stored
 * (see `server/utils/leaderboardStorage.ts`), and read back as a plain column afterwards.
 *
 * The categories are not on the same scale: a character's achievement points run to five figures
 * while its mounts run to four, and a raw sum would let achievements alone decide the whole table.
 * So a weight here is not "how important a category is" but "what one unit of it is worth", and
 * each row below is chosen so that a top-end character contributes the same order of magnitude to
 * every one of them - roughly two to four thousand points apiece. The figures in the comments are
 * the ones a fully collected character of the current expansion brings, and they are what a later
 * category (transmog, reputations) should be weighed against rather than the raw counters.
 *
 * Adding a category is one line in the table plus one field in the profile the storage writes -
 * nothing in the endpoint, the page or the components has to learn about it.
 */
export const SCORE_WEIGHTS = {
  /** ~1200 mounts in the journal. */
  mounts: 3,
  /** ~1500 pets, counted by species. */
  pets: 2,
  /** ~950 toys. */
  toys: 2,
  /** ~1480 decor pieces. */
  decor: 2,
  /** ~45 000 achievement points, which is why this weight is the small one. */
  achievements: 0.05,
  /** ~3400 Mythic+ rating, on the same bands the colour ladder reads. */
  mPlusScore: 1,
  /** ~700 average item level. */
  ilvl: 3,
  /** 90 levels. */
  level: 5
} as const

/** The part of a stored record the rating is computed from. */
export interface ScoreInput {
  mounts: number
  pets: number
  toys: number
  decor: number
  achievements: number
  mPlusScore: number
  ilvl: number
  level: number
}

/**
 * The overall rating of a player: every category multiplied by its weight, added up and rounded.
 *
 * A missing or nonsensical figure counts as zero rather than poisoning the sum with `NaN`, which
 * is what keeps a record backfilled from a thinner source (the sitemap's index knows a character's
 * mounts but not its decor) a legitimate, low-scoring entry instead of a broken one.
 */
export function calculatePlayerScore(profile: ScoreInput): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  const total =
    value(profile.mounts) * SCORE_WEIGHTS.mounts +
    value(profile.pets) * SCORE_WEIGHTS.pets +
    value(profile.toys) * SCORE_WEIGHTS.toys +
    value(profile.decor) * SCORE_WEIGHTS.decor +
    value(profile.achievements) * SCORE_WEIGHTS.achievements +
    value(profile.mPlusScore) * SCORE_WEIGHTS.mPlusScore +
    value(profile.ilvl) * SCORE_WEIGHTS.ilvl +
    value(profile.level) * SCORE_WEIGHTS.level

  return Math.round(total)
}

/**
 * How many collectables a player holds altogether, which is what the "king of collections"
 * widget counts. Kept here beside the weights so the two ways of measuring a player are read
 * in one place: this one is a plain count, the rating above is a weighted one.
 */
export function totalCollectables(profile: Pick<ScoreInput, 'mounts' | 'pets' | 'toys' | 'decor'>): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  return value(profile.mounts) + value(profile.pets) + value(profile.toys) + value(profile.decor)
}
