/**
 * The Collections shelves: every mount, pet and toy in the game, folded against one character's.
 *
 * The catalogue itself is the atlas built by `scripts/refresh-collections.mjs` and shipped with the
 * build (see `collections-data.json`): SimpleArmory's own tree per shelf - a group, the sources under
 * it and the items under those - paid for offline and read here. What is paid per request is only
 * the character's own list of collected ids, three cheap calls to Blizzard's profile endpoint, which
 * is laid over the atlas to flag each item `collected`; the shelf that comes out is then cached by
 * the endpoint's SWR store, so the next visitor is answered without touching Blizzard at all.
 */
import { getBlizzardToken } from './blizzard'
import {
  COLLECTION_KINDS,
  SIMPLEARMORY_LABELS_RU,
  type CollectionItem,
  type CollectionKind,
  type CollectionPage,
  type CollectionSection,
  type CollectionSubgroup
} from '#shared/data/collectionsSchema'
import atlas from './collections-data.json'

/** One item as the atlas stores it: what a tile and a tooltip are drawn from. */
interface AtlasItem {
  id: number
  en: string
  ru: string
  /** The icon name SimpleArmory stores for the item, which a sprite's address is built from. */
  icon: string
  /** The `type`/`id` Wowhead answers a tooltip for, or `null` when the item carries neither. */
  wow: { t: 'item' | 'spell' | 'npc'; id: number } | null
}

/** One source of a group - the "Raid Drop", the "Vendor", the zone - and the items filed under it. */
interface AtlasSource {
  id: string
  en: string
  items: AtlasItem[]
}

/** One group of a shelf, cut into its sources; the unfiled tail carries `items` of its own instead. */
interface AtlasGroup {
  id: string
  en: string
  subs: AtlasSource[]
  items?: AtlasItem[]
}

/** The three trees, as the builder wrote them. */
const SHELVES = (atlas as unknown as { shelves?: Record<CollectionKind, AtlasGroup[]> }).shelves || {}

/** Wowhead's icon CDN, which serves a sprite by the name the atlas stores. */
const ZAMIMG_ICONS = 'https://wow.zamimg.com/images/wow/icons'

/** Blizzard's own 2D icon CDN, which serves the same sprite for a name ZamImg has not got. */
const BLIZZARD_ICONS = 'https://render.worldofwarcraft.com'

/**
 * The size the tile's sprite is asked for. A tile is about 38px, so the 36px `medium` is the match
 * and keeps a shelf of two thousand pictures light; `large` (56px) is there for a sharper tile on a
 * high-density screen at the cost of the weight.
 */
const ICON_SIZE = 'medium'

/** The sprite an item with no icon name of its own shows: WoW's own question-mark icon. */
const COLLECTION_ICON_FALLBACK = `${ZAMIMG_ICONS}/${ICON_SIZE}/inv_misc_questionmark.jpg`

/** Blizzard's copy of the same sprite is the 56px one, which is what its CDN serves by name. */
const BLIZZARD_ICON_SIZE = 56

/**
 * The address of one row's tile: the icon name the atlas stores, which is the name the sprite is
 * filed under. The question mark stands in for a row with no name at all - an item SimpleArmory has
 * not filed yet - so every tile still shows something.
 */
function collectionIcon(entry: AtlasItem): string {
  return entry.icon ? `${ZAMIMG_ICONS}/${ICON_SIZE}/${entry.icon}.jpg` : COLLECTION_ICON_FALLBACK
}

/**
 * The second address a tile may be drawn from: Blizzard's own copy of the same icon, which the grid
 * asks for when ZamImg answers 404. The two CDNs do not carry quite the same set of names, so the
 * one that has the sprite is asked rather than the tile drawn as a hole. Empty when there is no icon
 * name to build either address from, which leaves the question mark as the only picture.
 */
function collectionIconFallback(entry: AtlasItem, region: string): string {
  return entry.icon ? `${BLIZZARD_ICONS}/${region}/icons/${BLIZZARD_ICON_SIZE}/${entry.icon}.jpg` : ''
}

/**
 * Where Blizzard keeps a character's collected ids per shelf, and the field each entry names the
 * item with. A pet is filed under its `species` where a mount and a toy carry their own id.
 */
const PROFILE: Record<CollectionKind, { path: string; key: string; field: string }> = {
  mounts: { path: 'mounts', key: 'mounts', field: 'mount' },
  pets: { path: 'pets', key: 'pets', field: 'species' },
  toys: { path: 'toys', key: 'toys', field: 'toy' }
}

/** Whether `kind` names a shelf the site serves. */
export function isCollectionKind(value: unknown): value is CollectionKind {
  return typeof value === 'string' && (COLLECTION_KINDS as readonly string[]).includes(value)
}

/** The ids the character being read holds on `kind`'s shelf. */
export async function getCollectedIds(
  region: string,
  realm: string,
  name: string,
  kind: CollectionKind,
  locale: string
): Promise<Set<number>> {
  const token = await getBlizzardToken(region)
  const { path, key, field } = PROFILE[kind]
  const url =
    `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}` +
    `/collections/${path}?namespace=profile-${region}&locale=${locale}`

  const data = await $fetch<Record<string, any[]>>(url, { headers: { Authorization: `Bearer ${token}` } })
  const list = data?.[key] || []

  return new Set(
    list.map((entry) => entry?.[field]?.id).filter((id): id is number => typeof id === 'number')
  )
}

/** The heading a group or a source reads in the page's language, English standing in for the rest. */
function shelfLabel(english: string, russian: boolean): string {
  return russian ? SIMPLEARMORY_LABELS_RU[english] || english : english
}

/** How many of `items` the character holds. */
function heldCount(items: CollectionItem[]): number {
  return items.filter((item) => item.collected).length
}

/**
 * Turns a run of atlas rows into tiles, dropping the ones with no name to show - a placeholder row
 * Blizzard is still using for something that has not shipped. The items the character holds lead,
 * and the rest keep the order SimpleArmory files them in.
 */
function toItems(
  entries: AtlasItem[],
  russian: boolean,
  region: string,
  collected: Set<number>
): CollectionItem[] {
  const items: CollectionItem[] = []

  for (const entry of entries) {
    const name = (russian ? entry.ru || entry.en : entry.en || entry.ru).trim()
    if (!name) continue
    items.push({
      id: entry.id,
      name,
      icon: collectionIcon(entry),
      fallback: collectionIconFallback(entry, region),
      collected: collected.has(entry.id),
      wow: entry.wow ? { type: entry.wow.t, id: entry.wow.id } : null
    })
  }

  return items.sort((a, b) => Number(b.collected) - Number(a.collected))
}

/**
 * The sections of one shelf, in the order SimpleArmory names them: each group with its own count and
 * bar, and the sources under it side by side, each a named block of tiles. A group with no sources -
 * the tail of what SimpleArmory has not filed - is one wall of tiles instead, and a group or a source
 * that came out empty is dropped, so a shelf shows only the rows it actually has.
 */
function buildSections(
  kind: CollectionKind,
  russian: boolean,
  region: string,
  collected: Set<number>
): CollectionSection[] {
  const sections: CollectionSection[] = []

  for (const group of SHELVES[kind] || []) {
    const subgroups: CollectionSubgroup[] = []
    for (const source of group.subs) {
      const items = toItems(source.items, russian, region, collected)
      if (!items.length) continue
      subgroups.push({
        id: source.id,
        label: shelfLabel(source.en, russian),
        collected: heldCount(items),
        total: items.length,
        items
      })
    }

    const items = subgroups.length ? [] : toItems(group.items || [], russian, region, collected)
    if (!subgroups.length && !items.length) continue

    const held = subgroups.length
      ? subgroups.reduce((sum, subgroup) => sum + subgroup.collected, 0)
      : heldCount(items)
    const total = subgroups.length
      ? subgroups.reduce((sum, subgroup) => sum + subgroup.total, 0)
      : items.length

    sections.push({
      id: group.id,
      label: shelfLabel(group.en, russian),
      collected: held,
      total,
      percent: total ? Math.round((held / total) * 100) : 0,
      items,
      subgroups: subgroups.length ? subgroups : undefined
    })
  }

  return sections
}

/**
 * Assembles one shelf: its sections, each item flagged for whether the character holds it, and the
 * counts the headings are measured by. Both shapes are counted into one running total, which is what
 * the shelf's own heading and bar read.
 */
export function buildCollectionPage(
  kind: CollectionKind,
  locale: string,
  region: string,
  collected: Set<number>
): CollectionPage {
  const sections = buildSections(kind, locale.startsWith('ru'), region, collected)

  let collectedInAll = 0
  let totalInAll = 0
  for (const section of sections) {
    collectedInAll += section.collected
    totalInAll += section.total
  }

  return {
    kind,
    collected: collectedInAll,
    total: totalInAll,
    percent: totalInAll ? Math.round((collectedInAll / totalInAll) * 100) : 0,
    sections,
    generatedAt: Date.now()
  }
}

