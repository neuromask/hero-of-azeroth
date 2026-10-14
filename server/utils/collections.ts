/**
 * The Collections shelves: every mount, pet and toy in the game, folded against one character's.
 *
 * The catalogue itself is the atlas built by `scripts/refresh-collections.mjs` and shipped with the
 * build (see `collections-data.json`): SimpleArmory's own tree per shelf - a group, the sources under
 * it and the items under those - paid for offline and read here. What is paid per request is only
 * the character's own list of collected ids, three cheap calls to Blizzard's profile endpoint, which
 * is laid over the atlas to flag each item `collected`; the shelf that comes out is then cached by
 * the endpoint's SWR store, so the next visitor is answered without touching Blizzard at all.
 *
 * Which ids are laid over the atlas is the one thing this module does not decide: it is handed a set and
 * draws it. That set is a character's own journal by default, and - for a reader whose account holds the
 * character, and only then - the account's own ids out of the site's pool
 * (`server/utils/accountPool`, read through `accountCollectedIds` below), because a WoW collection is
 * shared across every character of an account. The account's shelf is also the one drawn without the
 * faction filter: an account holds characters on both sides, so nothing it holds is out of its reach.
 */
import { callBlizzard, getBlizzardToken } from './blizzard'
// The account's own ids, for the one shelf a reader is allowed to see as their account's rather than as
// this character's. The pool is keyed by its own kind names, which `POOL_KIND` below translates into this
// module's (`decors` is the shelf; `decor` is the pool's own spelling of it).
import { readAccountIds, type PoolKind } from './accountPool'
import {
  COLLECTION_KINDS,
  SIMPLEARMORY_LABELS_RU,
  type CollectionItem,
  type CollectionKind,
  type CollectionPage,
  type CollectionSection,
  type CollectionSubgroup,
  type CollectionSummary,
  type CollectionViewOptions
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
   * `notObtainable` for an item the game has done away with, `notReleased` for one it has not shipped,
   * `highlighted` for one the site draws in a spotlight of its own, `new` for one it holds back until a
   * visitor asks for it, and `dupe`/`bounty` for a row it lists twice and counts once.
   */
  notObtainable?: boolean
  notReleased?: boolean
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
const SHELVES: Partial<Record<CollectionKind, AtlasGroup[]>> =
  (atlas as unknown as { shelves?: Record<CollectionKind, AtlasGroup[]> }).shelves ?? {}

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

/** The pool's own name for each shelf, which is not always the shelf's (`decors` against `decor`). */
const POOL_KIND: Record<CollectionKind, PoolKind> = {
  mounts: 'mounts',
  pets: 'pets',
  toys: 'toys',
  decors: 'decor'
}

/**
 * The account's own ids for one shelf, or `null` when the site has never read that collection for the
 * account.
 *
 * `null` rather than an empty set is the whole point of the signature: an account whose decorations
 * Blizzard refuses to list has nothing *known* about them, and a shelf drawn from an empty set would read
 * as "0 collected" - a number wrong in the one direction a collector would notice. So a caller falls back
 * to the character's own journal and says which it answered with (`CollectionPage.account`).
 */
export function accountCollectedIds(userId: number, kind: CollectionKind): Set<number> | null {
  const ids = readAccountIds(userId, POOL_KIND[kind])
  return ids.size ? ids : null
}

/**
 * The account's own ids for every shelf the site has read them for, keyed by shelf.
 *
 * Partial on purpose, and that is the whole point of the shape. Decorations are not in it - Blizzard's
 * account collection endpoint refuses them - and neither is a collection the site has not read for this
 * account yet; a shelf missing from the map is one drawn from the character's own journal, and the summary
 * says so for that shelf (`CollectionShelfSummary.account`). This used to be all four shelves or nothing,
 * which meant the account's decorations decided whether the account's mounts could be read as the account's -
 * the one shelf Blizzard never answers for held the other three hostage, and a reader with every collection
 * read still met "the account's list has not been read yet" over their own numbers.
 */
export function accountCollectedByKind(userId: number): Partial<Record<CollectionKind, Set<number>>> {
  const sets: Partial<Record<CollectionKind, Set<number>>> = {}

  for (const kind of COLLECTION_KINDS) {
    const ids = accountCollectedIds(userId, kind)
    if (ids) sets[kind] = ids
  }

  return sets
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

  const data = await callBlizzard<Record<string, any[]>>(url, { headers: { Authorization: `Bearer ${token}` } })
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
 * Whether one atlas row is drawn for a character under `view`: the whole of a shelf's filtering in one
 * place, so a shelf and the summary can never disagree about what a number counts.
 *
 * A row the file marks for the other faction is dropped, a row the site draws in a spotlight of its
 * own is dropped, an item the game has not shipped is drawn only for a visitor who asked for the
 * upcoming stock, and a retired item only for a character who holds it - or for a visitor who asked
 * for the hidden ones, and the item is not one the game has still to ship.
 *
 * What it asks is what the character whose ids it was handed can get and use, which is the question a
 * reader standing in the game on them is asking - and it is why the account's own shelf, when a reader asks
 * for it and is allowed it, passes no side at all (`side: null`): an account plays both sides, so nothing
 * it holds is out of its reach. Either way a shelf may count fewer things than the account-wide tile beside
 * it, and the achievements shelves filter their own atlas by this same rule
 * (`server/utils/achievementCollections`).
 */
function kept(
  entry: AtlasItem,
  collected: Set<number>,
  side: 'A' | 'H' | null,
  view: CollectionViewOptions
): boolean {
  if (entry.side && side && entry.side !== side) return false
  if (entry.highlighted) return false
  if (entry.new && !view.upcoming) return false
  if (!collected.has(entry.id) && entry.notObtainable && !(view.unobtainable && !entry.notReleased)) return false
  return true
}

/**
 * Turns a run of atlas rows into tiles, dropping the ones SimpleArmory's own shelf would not draw, so
 * that a character's numbers read the same here as they do there.
 *
 * A row the file marks for the other faction is dropped, and before anything is counted, so a group of
 * the Horde's items reads 14 of 14 rather than 14 of 17 with the Alliance's three greyed out at the end
 * of it. A row the site draws in a spotlight of its own (`highlighted`) is left off its list whatever
 * the character holds.
 *
 * What an item the game has done away with reads as is the visitor's choice, and it is exactly
 * SimpleArmory's own: by default it is drawn only for a character who holds it - a rare thing to show
 * off rather than something to go and get - and a visitor who asks for the hidden ones (`unobtainable`)
 * is shown every retired item the site has. An item the game has not shipped (`notReleased`) stays out
 * of that second view as well, which is where the site keeps it; and an item it holds back until asked
 * for (`new`, its "upcoming" stock) is drawn only for a visitor who asks for those.
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
  side: 'A' | 'H' | null,
  view: CollectionViewOptions
): CollectionItem[] {
  const items: CollectionItem[] = []

  for (const entry of entries) {
    if (!kept(entry, collected, side, view)) continue

    const held = collected.has(entry.id)
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
 * a heading is measured by are the counts of what is drawn under it, less the rows the site draws twice
 * and counts once: the rows the atlas marks itself (`dupe`, `bounty`) and the ones it leaves unmarked,
 * which the shelf finds as it draws them (see `drawn` below).
 */
function buildSections(
  kind: CollectionKind,
  russian: boolean,
  region: string,
  collected: Set<number>,
  side: 'A' | 'H' | null,
  view: CollectionViewOptions
): CollectionSection[] {
  const sections: CollectionSection[] = []

  /**
   * The ids this shelf has already counted, so that an item the atlas files under two headings is counted
   * once. There are two ways the atlas files one twice:
   *
   *   - a row SimpleArmory marks itself (`dupe`, `bounty`), which `toItems` carries as it stands: whichever
   *     of the pair is drawn, one of them carries the item;
   *   - a pair it leaves unmarked, which the shelf finds here. The atlas holds two such pairs today: the toy
   *     `Corrosive Victory`, filed under both `Midnight: Season 2` and `Midnight: Achievement`, and the mount
   *     `Deathtusk Felboar`, filed once per faction under `Warlords of Draenor: Reputation`. A character never
   *     sees the second pair twice - one half is the other side's - but the account's own shelf does, because
   *     it passes no side, and an unmarked pair left to the rows reads one item more than there are: a reader
   *     saw 411 toys where the collection behind them numbered 410.
   *
   * The copy that counts is the first of the pair that is drawn, which is how the atlas's own marks read as
   * well: the count sits under the heading of the copy that stands, and where the second copy is not drawn at
   * all - the other faction's, a spotlight row the site leaves off - the drawn copy is the item's only row and
   * counts. A row the atlas already leaves out never claims an id: a pair must not take the count off both.
   */
  const drawn = new Set<number>()

  for (const group of SHELVES[kind] || []) {
    const subgroups: CollectionSubgroup[] = []
    for (const source of group.subs) {
      const items = toItems(source.items, russian, region, collected, side, view)
      if (!items.length) continue

      for (const item of items) {
        // A row the atlas already counts elsewhere does not claim the id: the copy that is counted is the one
        // that counts, and a row no count is kept of must not push its twin out of the numbers as well.
        if (item.uncounted) continue
        if (drawn.has(item.id)) item.uncounted = true
        else drawn.add(item.id)
      }

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
 * visitor reads are the totals of what they can actually collect. `null` is not a character of no
 * faction: it is the account's own shelf, where both sides' items are the account's to hold - which is the
 * whole of what "by account" means for the numbers below. `view` is what the visitor asked to be shown
 * beyond the default - the retired items and the upcoming ones (see `toItems`), which is the same pair of
 * switches SimpleArmory's own pages carry.
 */
export function buildCollectionPage(
  kind: CollectionKind,
  locale: string,
  region: string,
  collected: Set<number>,
  faction?: string | null,
  view: CollectionViewOptions = {}
): CollectionPage {
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null
  const sections = buildSections(kind, locale.startsWith('ru'), region, collected, side, view)

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

/**
 * The count of one shelf, without building its tiles: what a summary card reads. It walks the same
 * rows the shelf would and drops the same ones (`kept`), so the two numbers are always the same
 * number - an item the shelf counts once is counted once here too, by id rather than by row, exactly
 * as a built shelf counts it.
 */
function countShelf(
  kind: CollectionKind,
  collected: Set<number>,
  side: 'A' | 'H' | null,
  view: CollectionViewOptions
): { collected: number; total: number } {
  // By id, exactly as a built shelf counts (`buildSections`): the atlas may list one item in two groups, and a
  // summary that counted the rows would disagree with the shelf it summarises.
  const counted = new Set<number>()
  const held = new Set<number>()

  for (const group of SHELVES[kind] || []) {
    for (const source of group.subs) {
      for (const entry of source.items) {
        if (!kept(entry, collected, side, view)) continue
        if (entry.dupe || entry.bounty) continue
        counted.add(entry.id)
        if (collected.has(entry.id)) held.add(entry.id)
      }
    }
  }

  return { collected: held.size, total: counted.size }
}

/** The ids the character holds on every shelf, read in one pass - what a summary stands on. */
export async function getCollectedByKind(
  region: string,
  realm: string,
  name: string,
  locale: string
): Promise<Record<CollectionKind, Set<number>>> {
  const sets = await Promise.all(
    COLLECTION_KINDS.map((kind) => getCollectedIds(region, realm, name, kind, locale))
  )

  return Object.fromEntries(COLLECTION_KINDS.map((kind, index) => [kind, sets[index]])) as Record<
    CollectionKind,
    Set<number>
  >
}

/**
 * Assembles the summary page: the running total over every shelf and a row per shelf, in the order
 * the menu lists them, under the default view (the retired and upcoming items hidden, as a shelf
 * opens).
 *
 * `faction` keeps the other side's items out of the count, exactly as it does on a shelf - for the shelves
 * that are read as the character's. `accountKinds` names the ones read from the account's own pool instead,
 * and those are counted without a faction at all: an account holds characters on both sides, so nothing it
 * holds is out of its reach (`buildCollectionPage` does the same for one shelf). Each row says which of the
 * two it was read as, because one summary flag cannot speak for four shelves.
 */
export function buildCollectionSummary(
  locale: string,
  collectedByKind: Record<CollectionKind, Set<number>>,
  faction?: string | null,
  accountKinds: ReadonlySet<CollectionKind> = new Set()
): CollectionSummary {
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null

  const shelves = COLLECTION_KINDS.map((kind) => {
    const account = accountKinds.has(kind)
    const count = countShelf(kind, collectedByKind[kind], account ? null : side, {})

    return {
      kind,
      collected: count.collected,
      total: count.total,
      percent: count.total ? Math.round((count.collected / count.total) * 100) : 0,
      account
    }
  })

  const held = shelves.reduce((sum, shelf) => sum + shelf.collected, 0)
  const total = shelves.reduce((sum, shelf) => sum + shelf.total, 0)

  return {
    collected: held,
    total,
    percent: total ? Math.round((held / total) * 100) : 0,
    shelves,
    account: accountKinds.size > 0,
    generatedAt: Date.now()
  }
}

/**
 * The same shelf with the tiles of every section but the ones `keep` names left out.
 *
 * A shelf is every collectable in the game - fifteen hundred items for the mounts alone, and more for the
 * pets - and a reader opens on its first section, so the whole of it never has to travel to draw the page.
 * This is what trims it: a section's heading, its id and every count stay exactly as they were (the quick
 * anchors and the bars are read from them, so the page is complete the moment it is painted), and only its
 * tiles are dropped - which is what the reader's browser asks for again, section by section, as they are
 * scrolled to (see `selectCollectionView` and the endpoint).
 *
 * It returns a **new** page and a new array per section it empties: the shelf handed in is the one the
 * endpoint's store holds (`server/utils/swrCache`), and a trimmed answer that wrote into it would leave
 * the next caller - a full-format request, or another section - reading a shelf whose tiles had been taken
 * away. Nothing is re-counted and nothing is re-read: a trimmed response costs the same server-side work
 * as a whole one, because the shelf it trims was already assembled and cached.
 */
export function projectCollectionSections(
  page: CollectionPage,
  keep: (sectionId: string) => boolean
): CollectionPage {
  return {
    ...page,
    sections: page.sections.map((section) =>
      keep(section.id)
        ? section
        : { ...section, subgroups: section.subgroups.map((subgroup) => ({ ...subgroup, items: [] })) }
    )
  }
}

/** The slice of a shelf a request names, as the endpoint reads it off the query string. */
export interface CollectionSliceRequest {
  /** `first` answers with the shelf's first section only - what a page asks for as it is rendered. */
  sections?: string
  /** The id of the one section to answer with - what a page asks for as a section is scrolled to. */
  section?: string
}

/**
 * The shelf an endpoint answers with: the one assembled and cached, trimmed to the slice `request` names.
 *
 * The whole decision lives here rather than in the handler because it is the one rule a test can pin without
 * a server. No params - or any param this build does not understand - is the *whole* shelf, exactly as the
 * endpoint always answered, so every existing caller keeps the answer it had; `sections=first` is the first
 * section's tiles with every other section's headings; `section=<id>` is that one section's tiles. A section
 * id the shelf has not got is answered with the whole shelf rather than an error, which is what a stale page
 * or a hand-written link deserves.
 *
 * Every branch that trims returns a **new** page, so the object the store holds is never written to.
 */
export function selectCollectionView(page: CollectionPage, request: CollectionSliceRequest = {}): CollectionPage {
  const first = page.sections[0]?.id

  const wanted =
    typeof request.section === 'string' && request.section
      ? request.section
      : request.sections === 'first'
        ? first
        : undefined

  // Nothing named, or a section this shelf has not got: the whole shelf, as the endpoint always answered.
  if (!wanted || !page.sections.some((section) => section.id === wanted)) return page

  return projectCollectionSections(page, (id) => id === wanted)
}

