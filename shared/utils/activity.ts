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
 * The kind of event a card is, which is what the sidebar scales the feed by.
 *
 * The feed is read from the achievement log, so in the narrow sense every event is an
 * achievement; these are the subjects those achievements are about - the collections they count,
 * the dungeons and raids they clear, the fields they fight on. A card that is only an achievement
 * is `achievement`, the catch-all the rest fall back to.
 */
export type ActivityType = 'achievement' | 'mount' | 'pet' | 'toy' | 'mythic' | 'raid' | 'pvp'

/** A filter of the feed; `all` is the whole timeline. */
export type ActivityCategory = 'all' | 'achievements' | 'pve' | 'collections' | 'pvp'

/** The filters, in the order they are shown. `all` is the default and leads. */
export const ACTIVITY_CATEGORIES = ['all', 'achievements', 'pve', 'collections', 'pvp'] as const

/** Which event types each filter gathers. `all` is handled separately, with no list of its own. */
const CATEGORY_TYPES: Record<Exclude<ActivityCategory, 'all'>, readonly ActivityType[]> = {
  achievements: ['achievement'],
  pve: ['mythic', 'raid'],
  collections: ['mount', 'pet', 'toy'],
  pvp: ['pvp']
}

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
  /** The kind of event it is, which the sidebar files it under. */
  type: ActivityType
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

/**
 * What an achievement is about, read from the category it sits in and its own wording.
 *
 * Blizzard cuts those categories per expansion and spells them in the reader's language, so there
 * is no single id to test against - the wording is what is left, in the two languages the site
 * serves. A raid, a dungeon and a Mythic+ key all read as the dungeons-and-raids side of the
 * feed; a collection counts mounts, pets or toys; a battleground or an arena is PvP; everything
 * else stays a plain achievement. `detail` is the achievement's own name, which catches a
 * collection the category did not name (`Collect 300 mounts` filed under a plain heading).
 */
export function activityType(categoryName: string, detail = ''): ActivityType {
  const text = `${categoryName} ${detail}`.toLowerCase()
  if (/pvp|player vs|battleground|arena|арена|поле боя/.test(text)) return 'pvp'
  if (/raid|рейд/.test(text)) return 'raid'
  if (/mythic|dungeon|подзем|эпох|ключ/.test(text)) return 'mythic'
  if (/mount|маунт/.test(text)) return 'mount'
  if (/pet|питом/.test(text)) return 'pet'
  if (/toy|игрушк/.test(text)) return 'toy'
  return 'achievement'
}

/** Whether an item belongs to the filter `category`. `all` keeps every item. */
export function activityInCategory(item: Pick<ActivityItem, 'type'>, category: ActivityCategory): boolean {
  if (category === 'all') return true
  return CATEGORY_TYPES[category].includes(item.type)
}

/**
 * How many items each filter holds, which is the count printed beside it.
 *
 * A count is the number of cards a filter would show, so it is taken over whatever list is at
 * hand - the whole feed - and a category nothing falls into reads as a plain `0` rather than an
 * absent row, which is what keeps the sidebar the same shape whatever the character did lately.
 */
export function activityCategoryCounts(
  items: readonly Pick<ActivityItem, 'type'>[]
): Record<ActivityCategory, number> {
  const counts: Record<ActivityCategory, number> = {
    all: items.length,
    achievements: 0,
    pve: 0,
    collections: 0,
    pvp: 0
  }
  for (const item of items) {
    for (const category of ACTIVITY_CATEGORIES) {
      if (category !== 'all' && activityInCategory(item, category)) counts[category] += 1
    }
  }
  return counts
}