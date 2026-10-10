/**
 * The professions a character can take up, and the names each one goes by.
 *
 * The game speaks about professions by name and by id, and the API answers in whatever language the
 * read was asked for - so a stored profession may be either spelling, and a page cannot print it as
 * it stands without printing whichever language the background task happened to use. This table is
 * what makes that a detail: a name is resolved in either language, and the display name is then the
 * one belonging to the language being read.
 *
 * The names are Blizzard's own, taken from its profession index (`/data/wow/profession/index`) in
 * both `en_US` and `ru_RU`, so a pill on the profile reads exactly as the game's own profession pane
 * does. The list is the primaries - the two a character chooses and the account's tiles have room
 * for; the secondary skills (archaeology, cooking, fishing) are not what the character API reports
 * and are left to the fallback below.
 *
 * The order is alphabetical by the English name, which is the order a reader scanning for one
 * profession would use.
 */
export interface WoWProfession {
  id: number
  /** The Armoury's own spelling of the profession, for a URL or a class name of its own. */
  slug: string
  /** The profession's name as Blizzard sends it in English (`en_US`). */
  name: string
  /** The profession's name as Blizzard sends it in Russian (`ru_RU`). */
  nameRu: string
}

export const WOW_PROFESSIONS: readonly WoWProfession[] = [
  { id: 171, slug: 'alchemy', name: 'Alchemy', nameRu: 'Алхимия' },
  { id: 164, slug: 'blacksmithing', name: 'Blacksmithing', nameRu: 'Кузнечное дело' },
  { id: 333, slug: 'enchanting', name: 'Enchanting', nameRu: 'Наложение чар' },
  { id: 202, slug: 'engineering', name: 'Engineering', nameRu: 'Инженерное дело' },
  { id: 182, slug: 'herbalism', name: 'Herbalism', nameRu: 'Травничество' },
  { id: 773, slug: 'inscription', name: 'Inscription', nameRu: 'Начертание' },
  { id: 755, slug: 'jewelcrafting', name: 'Jewelcrafting', nameRu: 'Ювелирное дело' },
  { id: 165, slug: 'leatherworking', name: 'Leatherworking', nameRu: 'Кожевничество' },
  { id: 186, slug: 'mining', name: 'Mining', nameRu: 'Горное дело' },
  { id: 393, slug: 'skinning', name: 'Skinning', nameRu: 'Снятие шкур' },
  { id: 197, slug: 'tailoring', name: 'Tailoring', nameRu: 'Портняжное дело' }
]

/**
 * A profession looked up by name, in either language, or by its slug.
 *
 * The three spellings a caller may be holding: the API's name as the read asked for it (English or
 * Russian), a slug kept somewhere of its own, or the English name a stored row was written with.
 */
export function professionByName(name?: string | null): WoWProfession | null {
  const query = typeof name === 'string' ? name.trim().toLowerCase() : ''
  if (!query) return null

  return (
    WOW_PROFESSIONS.find(
      (entry) =>
        entry.slug === query || entry.name.toLowerCase() === query || entry.nameRu.toLowerCase() === query
    ) || null
  )
}

/** The same lookup by the id Blizzard uses, which is the one answer that never changes with a patch. */
export function professionById(id?: number | null): WoWProfession | null {
  return WOW_PROFESSIONS.find((entry) => entry.id === id) || null
}

/**
 * What a profession is called in the language being read.
 *
 * A name this table does not know is handed back as it came, which is the honest answer: the API's
 * own spelling of something the site has no translation for is still more useful than nothing.
 */
export function professionLabel(name: string | null | undefined, locale: string): string | null {
  if (!name) return null

  const entry = professionByName(name)
  if (!entry) return name

  return locale === 'ru' ? entry.nameRu : entry.name
}
