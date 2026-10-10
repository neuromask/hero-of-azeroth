/**
 * The Achievements schema: what an achievement shelf is made of, and how SimpleArmory's own
 * `achievements.json` is folded into the sections a visitor reads.
 *
 * The shape mirrors the Collections one on purpose. A collection is a group (an expansion, an event)
 * holding sources ("Raid Drop", "Vendor") holding items; an achievement shelf is a *category* - the
 * subject a group of achievements is about, which is what a supercat of the file is - holding its
 * `cats` (an expansion, a battleground, a profession) holding its `subcats` (a dungeon, a zone, a
 * ladder step). The same walk therefore draws both: sections at the top, subgroups under them, and a
 * tile per item.
 *
 * The categories are the slugs the site's addresses use (`/…/achievements/character`), and their own
 * names are read through `ACHIEVEMENT_LABEL_KEYS` - a message key, because the menu and a summary
 * card need the category's name before any shelf has been read.
 *
 * A heading inside a shelf is the atlas's own string, already resolved to the page's language by the
 * server (`entry.ru` where Blizzard's category index named it, `ACHIEVEMENT_LABELS_RU` where it did
 * not, English otherwise), so the grid draws it like any other string and a new expansion needs no
 * message key of its own.
 */
import { SIMPLEARMORY_LABELS_RU } from './collectionsSchema'

/** The shelves an achievement page is shown on, which is also how the site spells them. */
export type AchievementCategory =
  | 'character'
  | 'quests'
  | 'exploration'
  | 'housing'
  | 'delves'
  | 'pvp'
  | 'dungeons'
  | 'professions'
  | 'reputation'
  | 'events'
  | 'pets'
  | 'collections'
  | 'expansions'
  | 'legacy'
  | 'feats'

/** The categories, in the order the achievements menu lists them. */
export const ACHIEVEMENT_CATEGORIES = [
  'character',
  'quests',
  'exploration',
  'housing',
  'delves',
  'pvp',
  'dungeons',
  'professions',
  'reputation',
  'events',
  'pets',
  'collections',
  'expansions',
  'legacy',
  'feats'
] as const

/** The message key a category's own name is read under, for the menu and a summary card. */
export const ACHIEVEMENT_LABEL_KEYS: Record<AchievementCategory, string> = {
  character: 'achCharacter',
  quests: 'achQuests',
  exploration: 'achExploration',
  housing: 'achHousing',
  delves: 'achDelves',
  pvp: 'achPvp',
  dungeons: 'achDungeons',
  professions: 'achProfessions',
  reputation: 'achReputation',
  events: 'achEvents',
  pets: 'achPets',
  collections: 'achCollections',
  expansions: 'achExpansions',
  legacy: 'achLegacy',
  feats: 'achFeats'
}

/** Whether `value` names a shelf the site serves. */
export function isAchievementCategory(value: unknown): value is AchievementCategory {
  return typeof value === 'string' && (ACHIEVEMENT_CATEGORIES as readonly string[]).includes(value)
}

/**
 * The Russian names of the headings Blizzard's category index does not name - the file's own
 * vocabulary and the vocabulary the collections shelves already share with it. It is the same
 * fallback the shelves use: a heading this map does not carry is left in English rather than dropped.
 *
 * The category index already spells every `cat` heading in Russian (the atlas is built with it), so
 * this is only read where a heading slipped past it - most `subcats`, which are bosses, zones and
 * ladders the index has not got. The proper nouns among them ("Ulduar", "Blackrock Depths") read the
 * same in both languages and are deliberately left out.
 */
export const ACHIEVEMENT_LABELS_RU: Record<string, string> = {
  ...SIMPLEARMORY_LABELS_RU,
  // The shelves themselves, which the menu draws under these names.
  Characters: 'Персонажи',
  'Player vs. Player': 'PvP',
  'Dungeons & Raids': 'Подземелья и рейды',
  'World Events': 'События',
  'Pet Battles': 'Битвы питомцев',
  'Expansion Features': 'Особенности дополнений',
  'Feats of Strength': 'Великие подвиги',
  Legacy: 'Снятое с игры',
  // The words the subcategories are cut into.
  Battle: 'Битвы',
  Level: 'Уровень',
  Appearances: 'Облики',
  'Toy Box': 'Хранилище игрушек',
  Mounts: 'Маунты',
  Character: 'Персонаж',
  Currencies: 'Валюты',
  Raids: 'Рейды',
  World: 'Мир',
  Counts: 'Подсчёты',
  'Daily Counts': 'Ежедневные подсчёты',
  'Dungeon Counts': 'Подземелья: подсчёты',
  Wins: 'Победы',
  Skill: 'Навык',
  'Allied Races: Level': 'Союзные расы: уровень',
  'Allied Races: Unlock': 'Союзные расы: открытие',
  Skyriding: 'Небесные полёты',
  'Dragon Isles': 'Драконьи острова',
  Expansion: 'Дополнение'
}

/**
 * One item on a shelf: what it is, how it looks, and whether this character has earned it. The shape
 * is the collections one with the two marks the game keeps for achievements added - the points it is
 * worth, and the tooltip that names it.
 */
export interface AchievementItem {
  /** Blizzard's id for the achievement. */
  id: number
  /** The name, in the language the page is being read in. */
  name: string
  /** The square's address on ZamImg, built from the icon name SimpleArmory stores for it. */
  icon: string
  /** Blizzard's own copy of the same icon, which the grid falls back on when ZamImg has not got it. */
  fallback: string
  /** The points the achievement is worth, which a heading counts. A feat of strength is worth none. */
  points: number
  /** Whether the character being read has earned it. */
  collected: boolean
  /** The `type`/`id` a Wowhead tooltip answers to. An achievement always names one. */
  wow: { type: 'achievement'; id: number } | null
}

/** One subcategory inside a category: a dungeon, a zone, a ladder step, and the items under it. */
export interface AchievementSubgroup {
  id: string
  label: string
  collected: number
  total: number
  items: AchievementItem[]
}

/** One section of a shelf: the `cat` a supercat is cut into and the count the heading reads. */
export interface AchievementSection {
  id: string
  /** The heading, already read in the page's language. */
  label: string
  collected: number
  total: number
  /** The share of the section the character holds, rounded to a whole percent. */
  percent: number
  /** The subcategory rows drawn under the heading, one block of tiles each. */
  subgroups: AchievementSubgroup[]
}

/** A whole shelf of one category, ready to draw: the sections and the running total they add up to. */
export interface AchievementPage {
  category: AchievementCategory
  collected: number
  total: number
  percent: number
  sections: AchievementSection[]
  /** When the shelf was assembled, so a caller can tell a fresh copy from a revalidated one. */
  generatedAt: number
}

/** One category on the summary page: its own count and the share of it the character holds. */
export interface AchievementCategorySummary {
  category: AchievementCategory
  collected: number
  total: number
  percent: number
}

/** The whole achievement log of a character, summarised: the total and a row per category. */
export interface AchievementSummary {
  /** How many achievements the character has earned, across every category. */
  collected: number
  /** How many it could earn, across every category, under the same filtering as a shelf. */
  total: number
  percent: number
  /** The categories, in the order the menu lists them. */
  categories: AchievementCategorySummary[]
  /** When the summary was assembled, so a caller can tell a fresh copy from a revalidated one. */
  generatedAt: number
}


