/**
 * The Achievement shelves: every achievement in the game, folded against one character's log.
 *
 * The catalogue is the atlas built by `scripts/refresh-collections.mjs` and shipped with the build
 * (see `achievements-data.json`): SimpleArmory's own tree per category - a supercat, the `cats` under
 * it and the `subcats` under those - paid for offline and read here. What is paid per request is only
 * the character's own list of earned ids, one call to Blizzard's profile endpoint, which is laid over
 * the atlas to flag each achievement `earned`; the shelf that comes out is then cached by the
 * endpoint's SWR store, so the next visitor is answered without touching Blizzard at all.
 *
 * The filtering is the collections one, applied to achievements:
 *
 *   - an achievement SimpleArmory marks for the other faction (`side`) is dropped before anything is
 *     counted, so a character's numbers read over what it can actually earn;
 *   - an achievement the game has retired (`notObtainable`) is dropped unless the character has
 *     already earned it - a rare thing to show off rather than a goal to chase - which is exactly how
 *     the collections shelves treat a retired mount;
 *   - a `subcat` or a `cat` left with nothing is dropped with it, so the grid shows only rows that
 *     genuinely hold something.
 */
import { getBlizzardToken } from './blizzard'
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_LABELS_RU,
  type AchievementCategory,
  type AchievementItem,
  type AchievementPage,
  type AchievementSection,
  type AchievementSubgroup,
  type AchievementSummary
} from '#shared/data/achievementsSchema'
import atlas from './achievements-data.json'

/** One achievement as the atlas stores it: what a tile and a tooltip are drawn from. */
interface AtlasItem {
  id: number
  en: string
  ru: string
  /** The icon name SimpleArmory stores for it, which a sprite's address is built from. */
  icon: string
  /** The points the achievement is worth, which a heading counts. */
  points: number
  /** The `type`/`id` Wowhead answers a tooltip for. An achievement always names one. */
  wow: { t: 'achievement'; id: number } | null
  /** The faction the achievement is for, where SimpleArmory marks one, and absent otherwise. */
  side?: 'A' | 'H'
  /** Set on an achievement the game has done away with, which a shelf hides unless it is held. */
  notObtainable?: boolean
}

/** One subcategory of a category - the dungeon, the zone, the ladder step - and its achievements. */
interface AtlasSub {
  id: string
  en: string
  ru: string
  items: AtlasItem[]
}

/** One `cat` of a supercat: the expansion, the battleground, the profession, and the subs under it. */
interface AtlasSection {
  id: string
  en: string
  ru: string
  subs: AtlasSub[]
}

/** The fifteen trees, as the builder wrote them, keyed by the slug the addresses use. */
const SHELVES = (atlas as unknown as { categories?: Record<string, AtlasSection[]> }).categories || {}

/** Wowhead's icon CDN, which serves a sprite by the name the atlas stores. */
const ZAMIMG_ICONS = 'https://wow.zamimg.com/images/wow/icons'

/** Blizzard's own 2D icon CDN, which serves the same sprite for a name ZamImg has not got. */
const BLIZZARD_ICONS = 'https://render.worldofwarcraft.com'

/** The size the tile's sprite is asked for, matching the collections grid's own square. */
const ICON_SIZE = 'medium'

/** Blizzard's copy of the same sprite is the 56px one, which is what its CDN serves by name. */
const BLIZZARD_ICON_SIZE = 56

/** The sprite an achievement with no icon name of its own shows: WoW's own question-mark icon. */
const ACHIEVEMENT_ICON_FALLBACK = `${ZAMIMG_ICONS}/${ICON_SIZE}/inv_misc_questionmark.jpg`

/** The address of one row's tile, from the icon name the atlas stores. */
function achievementIcon(entry: AtlasItem): string {
  return entry.icon ? `${ZAMIMG_ICONS}/${ICON_SIZE}/${entry.icon}.jpg` : ACHIEVEMENT_ICON_FALLBACK
}

/** Blizzard's own copy of the same icon, which the grid asks for when ZamImg answers 404. */
function achievementIconFallback(entry: AtlasItem, region: string): string {
  return entry.icon ? `${BLIZZARD_ICONS}/${region}/icons/${BLIZZARD_ICON_SIZE}/${entry.icon}.jpg` : ''
}

/** The heading a `cat` or a `subcat` reads in the page's language, English standing in for the rest. */
function achievementLabel(entry: { en: string; ru?: string }, russian: boolean): string {
  if (!russian) return entry.en
  return entry.ru || ACHIEVEMENT_LABELS_RU[entry.en] || entry.en
}

/**
 * The side an achievement is filed under, read off the faction Blizzard names the character with: the
 * two say the same thing in different words (`ALLIANCE` and `'A'`), and a character whose faction is
 * neither - one Blizzard answers `NEUTRAL` for - reads a shelf with nothing taken out of it.
 */
const FACTION_SIDE: Record<string, 'A' | 'H'> = { ALLIANCE: 'A', HORDE: 'H' }

/**
 * The ids the character being read has earned.
 *
 * Blizzard's profile endpoint answers with every achievement the character holds and the moment each
 * was completed, so the whole log is one call. The ids are the numbers the atlas and the profile both
 * speak in, and the set is what every shelf is laid over.
 */
export async function getEarnedAchievementIds(
  region: string,
  realm: string,
  name: string,
  locale: string
): Promise<Set<number>> {
  const token = await getBlizzardToken(region)
  const url =
    `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}` +
    `/achievements?namespace=profile-${region}&locale=${locale}`

  const data = await $fetch<{ achievements?: Array<{ id?: number }> }>(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  return new Set(
    (data?.achievements || [])
      .map((entry) => entry?.id)
      .filter((id): id is number => typeof id === 'number')
  )
}

/**
 * Whether one atlas row is drawn for a character: the whole of the filtering, in one place so the
 * shelf and the summary can never disagree.
 *
 * A row the file marks for the other faction is dropped; a row the game has retired is dropped unless
 * the character already holds it. Everything else is drawn, held or not.
 */
function keeps(entry: AtlasItem, collected: Set<number>, side: 'A' | 'H' | null): boolean {
  if (entry.side && side && entry.side !== side) return false
  if (!collected.has(entry.id) && entry.notObtainable) return false
  return true
}

/**
 * Turns a run of atlas rows into tiles, dropping the ones the filtering above leaves out, so that a
 * character's numbers read over what it can actually earn. The order is the atlas's, which is
 * SimpleArmory's: every achievement has its slot in the grid whether the character has it or not, so
 * a shelf reads the same for everyone and a tile does not move the moment it is earned. `collected` is
 * only what the tile is drawn as - bright, in gold, or grey.
 */
function toItems(
  entries: AtlasItem[],
  russian: boolean,
  region: string,
  collected: Set<number>,
  side: 'A' | 'H' | null
): AchievementItem[] {
  const items: AchievementItem[] = []

  for (const entry of entries) {
    if (!keeps(entry, collected, side)) continue

    const name = (russian ? entry.ru || entry.en : entry.en || entry.ru).trim()
    if (!name) continue

    items.push({
      id: entry.id,
      name,
      icon: achievementIcon(entry),
      fallback: achievementIconFallback(entry, region),
      points: entry.points,
      collected: collected.has(entry.id),
      wow: entry.wow ? { type: 'achievement', id: entry.wow.id } : null
    })
  }

  return items
}

/** How many of `items` the character holds. */
function heldCount(items: AchievementItem[]): number {
  return items.filter((item) => item.collected).length
}

/**
 * The sections of one shelf, in the order the file names them: each `cat` with its own count and bar,
 * and the `subcats` under it side by side, each a named block of tiles. A `subcat` or a `cat` that
 * came out empty is dropped - the other faction's battleground, a category a patch emptied - so a
 * shelf shows only the rows it actually has.
 */
function buildSections(
  category: AchievementCategory,
  russian: boolean,
  region: string,
  collected: Set<number>,
  side: 'A' | 'H' | null
): AchievementSection[] {
  const sections: AchievementSection[] = []

  for (const group of SHELVES[category] || []) {
    const subgroups: AchievementSubgroup[] = []

    for (const sub of group.subs) {
      const items = toItems(sub.items, russian, region, collected, side)
      if (!items.length) continue
      subgroups.push({
        id: sub.id,
        label: achievementLabel(sub, russian),
        collected: heldCount(items),
        total: items.length,
        items
      })
    }

    if (!subgroups.length) continue

    const held = subgroups.reduce((sum, subgroup) => sum + subgroup.collected, 0)
    const total = subgroups.reduce((sum, subgroup) => sum + subgroup.total, 0)

    sections.push({
      id: group.id,
      label: achievementLabel(group, russian),
      collected: held,
      total,
      percent: total ? Math.round((held / total) * 100) : 0,
      subgroups
    })
  }

  return sections
}

/** The count of one shelf, without building its tiles: what a summary card reads. */
function countShelf(
  category: AchievementCategory,
  collected: Set<number>,
  side: 'A' | 'H' | null
): { collected: number; total: number } {
  let held = 0
  let total = 0

  for (const group of SHELVES[category] || []) {
    for (const sub of group.subs) {
      for (const entry of sub.items) {
        if (!keeps(entry, collected, side)) continue
        total++
        if (collected.has(entry.id)) held++
      }
    }
  }

  return { collected: held, total }
}

/**
 * Assembles one shelf of a category: its sections, each achievement flagged for whether the character
 * has earned it, and the counts the headings are measured by.
 *
 * `faction` is the one Blizzard names the character with (`HORDE`, `ALLIANCE`), and it is what keeps
 * the other side's achievements off the shelf.
 */
export function buildAchievementPage(
  category: AchievementCategory,
  locale: string,
  region: string,
  collected: Set<number>,
  faction?: string | null
): AchievementPage {
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null
  const sections = buildSections(category, locale.startsWith('ru'), region, collected, side)

  let held = 0
  let total = 0
  for (const section of sections) {
    held += section.collected
    total += section.total
  }

  return {
    category,
    collected: held,
    total,
    percent: total ? Math.round((held / total) * 100) : 0,
    sections,
    generatedAt: Date.now()
  }
}

/**
 * Assembles the summary page: the running total over every category and a row per category, in the
 * order the menu lists them, under the same filtering a shelf is read with.
 */
export function buildAchievementSummary(
  locale: string,
  collected: Set<number>,
  faction?: string | null
): AchievementSummary {
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null

  const categories = ACHIEVEMENT_CATEGORIES.map((category) => {
    const count = countShelf(category, collected, side)
    return {
      category,
      collected: count.collected,
      total: count.total,
      percent: count.total ? Math.round((count.collected / count.total) * 100) : 0
    }
  })

  const held = categories.reduce((sum, row) => sum + row.collected, 0)
  const total = categories.reduce((sum, row) => sum + row.total, 0)

  return {
    collected: held,
    total,
    percent: total ? Math.round((held / total) * 100) : 0,
    categories,
    generatedAt: Date.now()
  }
}

