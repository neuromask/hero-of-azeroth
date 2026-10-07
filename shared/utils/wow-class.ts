/**
 * The signature colour of every playable class, and the names each one goes by.
 *
 * One table serves the three places a class shows up:
 *
 *   - the character page, whose meta line prints the class in its own colour,
 *   - the character card, whose SVG banner, glow and footer are tinted with the same
 *     colour (and which reads no stylesheet, so it has to be handed the value), and
 *   - the search history on the front page, whose remembered name is tinted with it.
 *
 * Each class id is Blizzard's own (`character_class.id`), so a character is coloured by the
 * id the API sent rather than by a name that changes with the language the profile was asked
 * for. The name is still here for the callers that only hold a localised string - the card
 * and the page both get `class` beside `classId` - and the slug is the Armoury's, which is
 * what the history keeps so a remembered row outlives a language switch.
 *
 * Shaped after `shared/utils/wow-quality.ts`: a table plus the lookups a page and a card can
 * both read, so the two can never drift apart by editing one of them.
 */

/** Blizzard's id for a playable class: 1 Warrior through 13 Evoker. */
export type WoWClassId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export interface WoWClass {
  /** Blizzard's class id, as the character profile API reports it. */
  id: WoWClassId
  /** The Armoury's slug, kept by the history because it is the same in either language. */
  slug: string
  /** The class name Blizzard sends in English (`en_US`). */
  name: string
  /** The class name Blizzard sends in Russian (`ru_RU`). */
  nameRu: string
  /** The colour every World of Warcraft player reads without a legend. */
  hex: string
}

/**
 * The thirteen playable classes, by id.
 *
 * The hexes are the game's own palette - the one an item tooltip, the chat and the character
 * sheet all share - so a character reads as its class before the name beside it is read.
 */
export const WOW_CLASSES: readonly WoWClass[] = [
  { id: 1, slug: 'warrior', name: 'Warrior', nameRu: 'Воин', hex: '#C69B6D' },
  { id: 2, slug: 'paladin', name: 'Paladin', nameRu: 'Паладин', hex: '#F48CBA' },
  { id: 3, slug: 'hunter', name: 'Hunter', nameRu: 'Охотник', hex: '#AAD372' },
  { id: 4, slug: 'rogue', name: 'Rogue', nameRu: 'Разбойник', hex: '#FFF468' },
  { id: 5, slug: 'priest', name: 'Priest', nameRu: 'Жрец', hex: '#FFFFFF' },
  { id: 6, slug: 'death_knight', name: 'Death Knight', nameRu: 'Рыцарь смерти', hex: '#C41E3A' },
  { id: 7, slug: 'shaman', name: 'Shaman', nameRu: 'Шаман', hex: '#0070DD' },
  { id: 8, slug: 'mage', name: 'Mage', nameRu: 'Маг', hex: '#3FC7EB' },
  { id: 9, slug: 'warlock', name: 'Warlock', nameRu: 'Чернокнижник', hex: '#8788EE' },
  { id: 10, slug: 'monk', name: 'Monk', nameRu: 'Монах', hex: '#00FF98' },
  { id: 11, slug: 'druid', name: 'Druid', nameRu: 'Друид', hex: '#FF7D0A' },
  { id: 12, slug: 'demon_hunter', name: 'Demon Hunter', nameRu: 'Охотник на демонов', hex: '#A330C9' },
  { id: 13, slug: 'evoker', name: 'Evoker', nameRu: 'Пробудитель', hex: '#33937F' }
]

/** The colour a class falls back to when none can be resolved: the brand gold. */
export const DEFAULT_CLASS_HEX = '#f8b700'

/** A class looked up by Blizzard's own id. */
export function classById(id?: number | null): WoWClass | null {
  if (!id) return null
  return WOW_CLASSES.find((entry) => entry.id === id) || null
}

/**
 * A class looked up by name, in either language, or by its Armoury slug - the three spellings
 * a caller may be holding: the API's localised `class`, a slug kept in the history, or the
 * English name the card was built with.
 */
export function classByName(name?: string | null): WoWClass | null {
  const query = typeof name === 'string' ? name.trim().toLowerCase() : ''
  if (!query) return null
  return WOW_CLASSES.find(
    (entry) =>
      entry.name.toLowerCase() === query ||
      entry.nameRu.toLowerCase() === query ||
      entry.slug === query
  ) || null
}

/**
 * A class resolved from whatever a caller has. The id is tried first because it is the same in
 * every language; the name and the slug follow for the callers that only kept one of those.
 */
export function resolveClass(look: { classId?: number | null; class?: string | null }): WoWClass | null {
  return classById(look.classId) || classByName(look.class)
}

/** The signature colour of a class as a hex, or the brand gold when none can be resolved. */
export function classColorHex(look: { classId?: number | null; class?: string | null }): string {
  return resolveClass(look)?.hex || DEFAULT_CLASS_HEX
}