/**
 * Total number of achievement points that exist in the game, used as the
 * denominator of the achievement bar next to the character's own score.
 *
 * Blizzard does not publish this number: the static achievement index has no
 * `points` field and the profile achievements summary only reports what the
 * character earned. Summing the individual achievements costs ~9000 API calls,
 * so the result is kept as data next to this file and refreshed after a patch
 * with `npm run refresh:achievements`.
 *
 * Note that a single character can never reach it: achievements locked to the
 * other faction, to events that are over or to removed content are all counted,
 * which makes this an upper bound.
 */
import points from './achievement-points.json'

export const ACHIEVEMENT_POINTS_TOTAL = points.total
