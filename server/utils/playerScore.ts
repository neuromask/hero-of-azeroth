/**
 * The overall rating: the one place it is computed, and the one place it may be.
 *
 * The rating is the number the hall of fame ranks by and every page prints, so it has to be one number
 * rather than one number per page - and the way it stops being one is a caller assembling its inputs
 * itself. That is exactly what happened: a page computed the rating from its own list of figures, the list
 * was written by hand beside the formula, and when a category was added to the weights the list was not -
 * so the page printed a figure thousands of points below the table it was taken from, and nothing said so,
 * because a missing field in an object assembled by hand is invisible to a build that does not typecheck.
 *
 * The rule that comes out of it is this: the formula lives on the server, and no page computes a rating at
 * all - every object a page draws carries the score of the very figures beside it, computed once, where
 * those figures were assembled (`server/utils/accountPool`, `./leaderboardStorage`, `./card`). So this
 * module is deliberately not in `shared/`: the client cannot import it, and a future page that wants to
 * print a score has to be handed one.
 */
import { SCORE_WEIGHTS } from '#shared/utils/leaderboardScore'

/**
 * The weights' own version, bumped whenever a multiplier changes (see `SCORE_WEIGHTS`).
 *
 * A rating is stored with the record rather than derived on read (see the note in
 * `#shared/utils/leaderboardScore`), so a change to the table would otherwise leave every record written
 * before it carrying a number the current formula would not produce. The storage reads this stamp off the
 * file and re-derives every rating once when it does not match - which is what makes a weight a one-line
 * edit that reaches the whole table, rather than only the characters looked up afterwards.
 */
export const SCORE_VERSION = 4

/**
 * The part of a stored record the rating is computed from: the six categories it weighs.
 *
 * A profile carries more than this - the Mythic+ rating, the item level, the level itself - and none of it
 * is part of the overall score: this is a collector's rating, and a figure a character earns by playing (a
 * key rating) or simply wears (an item level) is not something it gathered. Every one of the six is
 * required, so a caller that assembles them by hand is told when it forgets one.
 */
export interface ScoreInput {
  achievements: number
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
}

/**
 * A profile's own figures, as the shapes a page draws them from: the six counts, each under the name the
 * formula knows it by.
 *
 * The structural shape rather than the server's `CharacterData`, so that the figures a profile carries can
 * be handed over as they stand - `stats` is exactly this - and read in one place rather than counted out
 * again by every caller.
 */
export interface ProfileStats {
  achievements: { count: number }
  mounts: { count: number }
  pets: { count: number }
  toys: { count: number }
  decor: { count: number }
  reputations: { count: number }
}

/**
 * The overall rating of a player: every category multiplied by its weight, added up and rounded.
 *
 * A missing or nonsensical figure counts as zero rather than poisoning the sum with `NaN`, which is what
 * keeps a record backfilled from a thinner source (the sitemap's index knows a character's mounts but not
 * its decor) a legitimate, low-scoring entry instead of a broken one. A figure that is not there at all is
 * a different matter, and is a caller's mistake rather than thin data: the six are required, and are read
 * off a profile through `scoreFigures`, or handed over as the whole six at once - which is what an
 * account's totals are, and what the merged figures of a page are.
 */
export function calculatePlayerScore(profile: ScoreInput): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  const total =
    value(profile.achievements) * SCORE_WEIGHTS.achievements +
    value(profile.mounts) * SCORE_WEIGHTS.mounts +
    value(profile.toys) * SCORE_WEIGHTS.toys +
    value(profile.decor) * SCORE_WEIGHTS.decor +
    value(profile.pets) * SCORE_WEIGHTS.pets +
    value(profile.reputations) * SCORE_WEIGHTS.reputations

  return Math.round(total)
}

/** The six figures a profile's own stats carry, named the way the formula knows them. */
export function scoreFigures(stats: ProfileStats): ScoreInput {
  return {
    achievements: stats.achievements.count,
    mounts: stats.mounts.count,
    pets: stats.pets.count,
    toys: stats.toys.count,
    decor: stats.decor.count,
    reputations: stats.reputations.count
  }
}

/**
 * How many collectables a player holds altogether, which is what the "king of collections" widget counts.
 * Kept here beside the weights so the two ways of measuring a player are read in one place: this one is a
 * plain count, the rating above is a weighted one.
 *
 * Reputations are deliberately not counted here, although they are weighed above: a faction is a standing
 * a character holds rather than an item it keeps, and this widget is about the journal.
 */
export function totalCollectables(profile: Pick<ScoreInput, 'mounts' | 'pets' | 'toys' | 'decor'>): number {
  const value = (input: number) => (Number.isFinite(input) && input > 0 ? input : 0)

  return value(profile.mounts) + value(profile.pets) + value(profile.toys) + value(profile.decor)
}
