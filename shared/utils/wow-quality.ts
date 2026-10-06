/**
 * The colour a number is set in, on the page and on the card alike.
 *
 * Two ladders live here, both cut from the game's own item-quality ladder - the one every
 * player reads without a legend - because they answer two different questions:
 *
 *   - A collection's count (see `collectionPercent`) is coloured by the share of that
 *     collection that is complete. Its rungs are packed into the top half on purpose: a
 *     collector past the halfway mark is into the part where every last percent is the hard
 *     one, and that is where a colour has something to say. Everything below 50% is Uncommon
 *     green, which keeps the tiles of a fresh character from looking like a row of warnings.
 *   - The Mythic+ rating (see `mPlusTier`) is coloured by the rating itself, on the bands the
 *     community sorts keys by rather than on a percentage, because a rating has no denominator
 *     to be a share of.
 *
 * A tier is the same shape either way, and each one carries its colour twice: the page needs a
 * Tailwind class for a `<span>`, while the card draws its own SVG, reads no stylesheet, and has
 * to be handed a hex. That is why this file is shared rather than duplicated - one table, so a
 * page and its card can never drift apart by editing one of them.
 */

export type QualityName = 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface QualityTier {
  /** The tier's name in the game's own ladder. */
  name: QualityName
  /** The lowest value that reaches this tier: a whole percent for a collection, the rating itself for Mythic+. */
  min: number
  /** The tier as a Tailwind class, which is what the page's numbers are set in. */
  textClass: string
  /** The same colour as a hex, which is what the card's SVG numbers are filled with. */
  hex: string
}

/**
 * The collection ladder, from the lowest tier up, each rung naming the floor of its band.
 *
 * In both tables the class and the hex are the same colour written twice -
 * `text-emerald-400` is `#34d399`, `text-blue-400` is `#60a5fa`, `text-purple-400` is
 * `#c084fc` and `text-amber-500` is `#f59e0b` - so the page and the card can never drift
 * apart by editing one of them.
 */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'uncommon', min: 0, textClass: 'text-emerald-400', hex: '#34d399' },
  { name: 'rare', min: 50, textClass: 'text-blue-400', hex: '#60a5fa' },
  { name: 'epic', min: 70, textClass: 'text-purple-400', hex: '#c084fc' },
  { name: 'legendary', min: 85, textClass: 'text-amber-500', hex: '#f59e0b' }
]

/**
 * The Mythic+ ladder, which is read off the rating itself rather than off a percentage.
 *
 * The bands are the ones a key runner already knows: 2000 is a rating that has cleared the
 * heroic dungeon pool, 3000 is the mark of a full set of timed keys at the top end, and 3400
 * is past what a season asks for - the bands the game itself hands out its own rewards on.
 * A character with no rating to speak of (0, or a score the API never sent) lands on the
 * bottom rung, which is why the first floor is 0.
 */
export const MPLUS_TIERS: readonly QualityTier[] = [
  { name: 'uncommon', min: 0, textClass: 'text-emerald-400', hex: '#34d399' },
  { name: 'rare', min: 2000, textClass: 'text-blue-400', hex: '#60a5fa' },
  { name: 'epic', min: 3000, textClass: 'text-purple-400', hex: '#c084fc' },
  { name: 'legendary', min: 3400, textClass: 'text-amber-500', hex: '#f59e0b' }
]

/**
 * How much of a collection is complete, as the whole percent both the page and the card print.
 *
 * It is rounded to a whole number before it is ever compared with a tier, so the colour always
 * agrees with the `total / %` written beside it: a collection at 49.6% reads as 50% on the page
 * and takes the Rare blue, rather than staying green on a line that says 50.
 *
 * A missing or nonsensical total answers 0, which lands on the bottom rung - a character the
 * API could not give a denominator keeps a colour instead of losing one.
 */
export function collectionPercent(current: number, total: number): number {
  if (!total || total <= 0 || !current || current <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
}

/** The rung a value stands on: the last tier whose floor it has reached. */
function tierFor(tiers: readonly QualityTier[], value: number): QualityTier {
  let tier = tiers[0]!
  for (const candidate of tiers) {
    if (value >= candidate.min) tier = candidate
  }
  return tier
}

/** The tier a whole percent of a collection falls in. */
export function qualityTier(percent: number): QualityTier {
  return tierFor(QUALITY_TIERS, percent)
}

/**
 * The tier a Mythic+ rating falls in. A score the API never sent is treated as 0 rather than
 * left to fall through every floor or land on `undefined`, so the figure keeps a colour.
 */
export function mPlusTier(score: number): QualityTier {
  return tierFor(MPLUS_TIERS, Number.isFinite(score) ? score : 0)
}

/** The Tailwind class a collection's number is set in on the page. */
export function wowQualityTextClass(current: number, total: number): string {
  return qualityTier(collectionPercent(current, total)).textClass
}

/** The hex a collection's number is filled with on the card. */
export function wowQualityHex(current: number, total: number): string {
  return qualityTier(collectionPercent(current, total)).hex
}

/** The Tailwind class a Mythic+ rating is set in on the page. */
export function mPlusQualityTextClass(score: number): string {
  return mPlusTier(score).textClass
}

/** The hex a Mythic+ rating is filled with on the card. */
export function mPlusQualityHex(score: number): string {
  return mPlusTier(score).hex
}