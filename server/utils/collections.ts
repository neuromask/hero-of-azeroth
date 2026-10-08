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
  /**
   * The faction the item is for, where SimpleArmory marks one - `'A'` for the Alliance, `'H'` for the
   * Horde - and absent for an item both sides can hold, which is most of them.
   */
  side?: 'A' | 'H'
  /**
   * The rest of the marks SimpleArmory makes a row with, written down only where its file makes one.
   * Its own pages draw and count by these, so they are read the same way here (see `toItems`):
   * `notObtainable` for an item the game has done away with, `highlighted` for one the site spotlights
   * elsewhere, `new` for one it has not shipped, and `dupe`/`bounty` for a row it lists twice and
   * counts once.
   */
  notObtainable?: boolean
  highlighted?: boolean
  new?: boolean
  dupe?: boolean
  bounty?: boolean
}

/** One source of a group - the "Raid Drop", the "Vendor", the zone - and the items filed under it. */
interface AtlasSource {
  id: string
  en: string
  items: AtlasItem[]
}

/** One group of a shelf: the expansion, the event, the continent, and the sources filed under it. */
interface AtlasGroup {
  id: string
  en: string
  subs: AtlasSource[]
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
 * filed under. The question mark stands in for a row with no icon name of its own, so every tile
 * still shows something.
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
 * Where Blizzard keeps a character's collected ids per shelf, and the field each entry names the item
 * with. A pet is filed under its `species` and a decoration under the decoration itself, where a
 * mount and a toy carry their own id.
 */
const PROFILE: Record<CollectionKind, { path: string; key: string; field: string }> = {
  mounts: { path: 'mounts', key: 'mounts', field: 'mount' },
  pets: { path: 'pets', key: 'pets', field: 'species' },
  toys: { path: 'toys', key: 'toys', field: 'toy' },
  // Decorations come from the housing side of the profile, and their ids are the ids the decor index
  // and SimpleArmory's file both speak in.
  decors: { path: 'decor', key: 'decor_collected', field: 'decor' }
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

/**
 * The side an item is filed under, read off the faction Blizzard names the character with: the two
 * say the same thing in different words (`ALLIANCE` and `'A'`), and a character whose faction is
 * neither - one Blizzard answers `NEUTRAL` for - reads a shelf with nothing taken out of it.
 */
const FACTION_SIDE: Record<string, 'A' | 'H'> = { ALLIANCE: 'A', HORDE: 'H' }

/**
 * Turns a run of atlas rows into tiles, dropping the ones SimpleArmory's own shelf would not draw, so
 * that a character's numbers read the same here as they do there.
 *
 * A row the file marks for the other faction is dropped, and before anything is counted, so a group of
 * the Horde's items reads 14 of 14 rather than 14 of 17 with the Alliance's three greyed out at the end
 * of it. A row the site draws elsewhere in a spotlight of its own (`highlighted`), and one the game has
 * not shipped yet (`new`), are left off its list whatever the character holds - its own shelf hides
 * them, and a shelf that drew them would count them too. An item that can no longer be obtained is
 * drawn only for a character who holds it: it is a rare thing to show off rather than something to go
 * and get, and counting the rest is what made this shelf read 1404 where SimpleArmory reads 1302.
 *
 * The order is the atlas's, which is SimpleArmory's: every item has its slot in the grid whether the
 * character holds it or not, so a shelf reads the same for everyone and a tile does not move the
 * moment it is collected. `collected` is only what the tile is drawn as - bright, in gold, or grey.
 */
function toItems(
  entries: AtlasItem[],
  russian: boolean,
  region: string,
  collected: Set<number>,
  side: 'A' | 'H' | null
): CollectionItem[] {
  const items: CollectionItem[] = []

  for (const entry of entries) {
    if (entry.side && side && entry.side !== side) continue
    if (entry.highlighted || entry.new) continue

    const held = collected.has(entry.id)
    if (!held && entry.notObtainable) continue

    const name = (russian ? entry.ru || entry.en : entry.en || entry.ru).trim()
    if (!name) continue

    const item: CollectionItem = {
      id: entry.id,
      name,
      icon: collectionIcon(entry),
      fallback: collectionIconFallback(entry, region),
      collected: held,
      wow: entry.wow ? { type: entry.wow.t, id: entry.wow.id } : null
    }

    // A row SimpleArmory lists twice is drawn twice - it is genuinely filed under both headings - and
    // counted once, which is what its own `dupe`/`bounty` mark says. The heading above it is measured
    // without the row; the count it is drawn under is the one its twin stands in.
    if (entry.dupe || entry.bounty) item.uncounted = true

    items.push(item)
  }

  return items
}

/** How many of `items` the character holds, leaving out a row no count is kept of. */
function heldCount(items: CollectionItem[]): number {
  return items.filter((item) => item.collected && !item.uncounted).length
}

/** How many of `items` the heading above them is measured by. */
function countedTotal(items: CollectionItem[]): number {
  return items.filter((item) => !item.uncounted).length
}

/**
 * The sections of one shelf, in the order SimpleArmory names them: each group with its own count and
 * bar, and the sources under it side by side, each a named block of tiles.
 *
 * A source or a group that came out empty is dropped - a group whose every item belongs to the other
 * faction, a source a patch emptied - so a shelf shows only the rows it actually has, and the counts
 * a heading is measured by are the counts of what is drawn under it, less the few rows the site draws
 * twice and counts once.
 */
function buildSections(
  kind: CollectionKind,
  russian: boolean,
  region: string,
  collected: Set<number>,
  side: 'A' | 'H' | null
): CollectionSection[] {
  const sections: CollectionSection[] = []

  for (const group of SHELVES[kind] || []) {
    const subgroups: CollectionSubgroup[] = []
    for (const source of group.subs) {
      const items = toItems(source.items, russian, region, collected, side)
      if (!items.length) continue
      subgroups.push({
        id: source.id,
        label: shelfLabel(source.en, russian),
        collected: heldCount(items),
        total: countedTotal(items),
        items
      })
    }

    if (!subgroups.length) continue

    const held = subgroups.reduce((sum, subgroup) => sum + subgroup.collected, 0)
    const total = subgroups.reduce((sum, subgroup) => sum + subgroup.total, 0)

    sections.push({
      id: group.id,
      label: shelfLabel(group.en, russian),
      collected: held,
      total,
      percent: total ? Math.round((held / total) * 100) : 0,
      subgroups
    })
  }

  return sections
}

/**
 * Assembles one shelf: its sections, each item flagged for whether the character holds it, and the
 * counts the headings are measured by. Every section is counted into one running total, which is what
 * the shelf's own heading and bar read.
 *
 * `faction` is the one Blizzard names the character with (`HORDE`, `ALLIANCE`), and it is what keeps
 * the other side's items off the shelf: they are dropped before anything is counted, so the totals a
 * visitor reads are the totals of what they can actually collect.
 */
export function buildCollectionPage(
  kind: CollectionKind,
  locale: string,
  region: string,
  collected: Set<number>,
  faction?: string | null
): CollectionPage {
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null
  const sections = buildSections(kind, locale.startsWith('ru'), region, collected, side)

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

