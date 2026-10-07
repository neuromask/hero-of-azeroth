/**
 * The activity feed: the achievements a character earned most recently, as one list.
 *
 * The shape lives here rather than in the endpoint that builds it, because the same
 * description is read from both sides - the endpoint fills it in, and the page draws it -
 * and one definition means the two can never disagree about what a field means.
 *
 * The accent is decided here too, from the category an achievement belongs to, so the
 * server and the page agree on which cards are worth a glow without either of them
 * re-deriving it: the page only turns a name into a class, never the decision into a guess.
 */

/** The special accent a card wears: a feat of strength, a dungeon or raid, or none. */
export type ActivityAccent = 'feat' | 'raid' | null

/**
 * One earned achievement in the feed.
 *
 * Everything but `completedAt` is static game data, so it is fetched once and kept;
 * `completedAt` is the moment the character earned it, which is what the list is sorted by.
 */
export interface ActivityItem {
  /** Blizzard's achievement id, which is what its metadata and its icon are keyed by. */
  id: number
  /** The name, in the language the feed was read in. */
  name: string
  /** What the achievement asks for, in the same language ('' when Blizzard sends none). */
  description: string
  /** The points it is worth; a feat of strength is worth none and wears no badge. */
  points: number
  /** The icon on the render CDN ('' when Blizzard serves none). */
  icon: string
  /** When it was earned, in milliseconds since the epoch. */
  completedAt: number
  /** The category it belongs to, in the feed's language. */
  category: string
  /** Blizzard's id for that category. */
  categoryId: number
  /** The glow the card earns from its category. */
  accent: ActivityAccent
}

/** A character's recent activity, ready for the timeline. */
export interface ActivityFeed {
  /** The character's total achievement points, as the profile reports them. */
  totalPoints: number
  /** How many achievements the character has earned in all. */
  totalQuantity: number
  /** The most recently earned achievements, newest first. */
  items: ActivityItem[]
  /** When this list was built, so a caller can tell a fresh copy from a revalidated one. */
  generatedAt: number
}

/**
 * Blizzard's id for the Feats of Strength category, the shelf of achievements that are
 * proofs rather than progress - the ones the game itself marks as special.
 */
export const FEATS_OF_STRENGTH_CATEGORY_ID = 81

/**
 * The accent a category earns.
 *
 * Feats of Strength is recognised by its id, which is the same in every language, and by
 * its name as a fallback for a document that named the category without an id. A dungeon
 * or a raid - and the Mythic+ keys inside them - is recognised by its name, because those
 * categories are cut per expansion (`War Within Raid`, `Рейды Midnight`) and there is no
 * single id to test against.
 */
export function activityAccent(categoryId: number, categoryName: string): ActivityAccent {
  if (categoryId === FEATS_OF_STRENGTH_CATEGORY_ID) return 'feat'

  const name = String(categoryName || '').toLowerCase()
  if (/feats of strength|великие подвиги/.test(name)) return 'feat'
  if (/dungeon|raid|mythic|подзем|рейд|эпох/.test(name)) return 'raid'

  return null
}