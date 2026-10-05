/**
 * Total number of achievement points a character is measured against, used as the
 * denominator of the achievement bar next to the character's own score.
 *
 * Blizzard publishes no such number, and every available source has to be understood
 * before it can be used:
 *
 *  - The static achievement index is the only place that lists every achievement, and
 *    summing the `points` of its 9,041 entries gives 66,680 (`achievement-points.json`,
 *    refreshed with `npm run refresh:achievements`). That is an upper bound nobody can
 *    reach: it counts the other faction's achievements, the rewards of seasons that have
 *    closed, removed content and everything a patch has not released yet. Against it the
 *    best character in the world reads 67%, which is what made the number look wrong.
 *
 *  - The reachable figure exists on Blizzard's own Armoury, as the `totalPoints` of each of
 *    its achievement categories. Those sum to 59,215 for the character the snapshot was
 *    read with, and the world's best score sits 10 points under it - 44,875 against 59,215
 *    is 75.8% instead of 66.7%. `armoury-totals.json` holds it and is refreshed after a
 *    patch with `npm run refresh:armoury-totals`.
 *
 * The Armoury reading is what the tile uses; the index sum is the fallback for a checkout
 * that has never run the Armoury refresh.
 */
import points from './achievement-points.json'
import armoury from './armoury-totals.json'

export const ACHIEVEMENT_POINTS_TOTAL = armoury.achievements || points.total
