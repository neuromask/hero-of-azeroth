/**
 * Builds `server/utils/collections-data.json`, the whole of what can be collected.
 *
 * The Collections pages are drawn against every mount, pet, toy and decoration in the game, not only
 * the ones a character holds, so a shelf reads 69 of 79 rather than 69 of 69. That catalogue - and
 * every tile's icon - is SimpleArmory's. Each shelf is read from the file they keep it in
 * (`https://simplearmory.com/data/{mounts,pets,battlepets,toys,decors}.json`) and what is stored is
 * that file's own tree: the groups it names (an expansion, an event, a continent), the sources under
 * each ("Raid Drop", "Vendor", a zone), and the items under those. Running this script is the whole
 * of adding what a patch brought - a new Trading Post rotation, a new expansion's vendors - so
 * nothing here is keyed to an item or an id: the files are read afresh every run, and a group, a
 * source or an item that has appeared since the last one is simply in the atlas the next time round.
 * An item carries four things, which is what a tile and a tooltip need: its id, its name in both
 * languages, the icon NAME SimpleArmory writes down for it (`inv_dwarvenmechboss_bronze`) and the
 * Wowhead address the ids it already carries name - plus, for the few hundred items only one faction
 * can hold, the `side` the file marks them with (`'A'`, `'H'`), which is what keeps the other side's
 * items off a character's shelf. An item the file marks as not released yet is not stored - a
 * collector can neither go and get it nor plan for it - while one it marks as no longer obtainable is
 * stored: a character may still hold it, and this shelf is the only place that says so. The icon name
 * is what a ZamImg address is built from - the same name the game's own 2D sprite is filed under - and
 * a Blizzard icon URL cannot stand in for it, because ZamImg serves sprites by name and rejects the
 * numeric file id Blizzard hands out in its place.
 *
 * Blizzard is read once for a shelf, and not for an icon: its static index names every mount, pet, toy
 * and decoration in both languages (SimpleArmory carries English only), which is what a shelf falls
 * back to where a file carries one language or none. What a character holds is read per request, by
 * the server, and matched against the ids stored here.
 *
 * `--only=mounts` (a comma list) rebuilds just those shelves and keeps the rest of the atlas on disk,
 * which is enough when only one source has moved.
 *
 * Usage: npm run refresh:collections [region] [--only=<kinds>]   (default region: eu)
 */
import fs from 'node:fs'

const REGION = (process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'eu').toLowerCase()
/**
 * `--only=mounts` (a comma list) rebuilds just those shelves and keeps the rest of the atlas on
 * disk, so a change to the mounts tree does not mean reading every pet and toy again.
 */
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) || '')
  .split(',')
  .map((kind) => kind.trim())
  .filter(Boolean)
/** Whether `kind` is being built, which is everything unless `--only` names a subset. */
const builds = (kind) => !ONLY.length || ONLY.includes(kind)

/** A browser-ish user agent: SimpleArmory and Wowhead answer a plain fetch more readily with one. */
const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; heroofazeroth.com)' }

/**
 * An icon name is what a ZamImg address is built from, so only that shape is ever stored - and it is
 * lower case, because the CDN is case-sensitive: SimpleArmory files some of the older mounts under a
 * capitalised name (`Ability_Mount_Charger`) and ZamImg answers those with a 404, while the
 * lower-cased name it is filed under serves the sprite.
 */
const ICON_NAME = /^[a-z0-9_-]+$/

/** SimpleArmory's own lists: each shelf's groups, sources and items, and each item's icon. */
const SIMPLEARMORY = 'https://simplearmory.com/data'

const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/collections-data.json', ROOT)

/** The atlas already on disk, so a `--only` run keeps the shelves it is not rebuilding. */
const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { shelves: {} }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const envText = fs.readFileSync(new URL('.env', ROOT), 'utf8')
const clientId = /NUXT_BLIZZARD_CLIENT_ID=(.*)/.exec(envText)?.[1].trim()
const clientSecret = /NUXT_BLIZZARD_CLIENT_SECRET=(.*)/.exec(envText)?.[1].trim()
if (!clientId || !clientSecret) throw new Error('NUXT_BLIZZARD_CLIENT_ID / _SECRET are not set in .env')

const { access_token: TOKEN } = await (await fetch(`https://${REGION}.battle.net/oauth/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: 'grant_type=client_credentials'
})).json()

const AUTH = { Authorization: `Bearer ${TOKEN}` }
const ns = `namespace=static-${REGION}`

/** Reads one game-data URL, waiting and retrying when the API throttles or stumbles. */
async function api(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: AUTH })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`${response.status}`)
    return await response.json()
  } catch (err) {
    if (attempt >= 4) throw new Error(`Blizzard gave up on ${url}: ${err.message}`)
    await sleep(400 * 2 ** attempt)
    return api(url, attempt + 1)
  }
}

/**
 * Reads one URL as text, waiting and retrying on a stumble, and never from a cache: every run reads
 * the files as they stand, so the Trading Post rotation that moved this week - or the decoration a
 * patch added - is in the atlas the next time this script is run. A `403` is not retried: it is a
 * refusal, and pressing it again only deepens it.
 */
async function fetchText(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, cache: 'no-store' })
    if (response.status === 403 || response.status === 404) return ''
    if (!response.ok) throw new Error(`${response.status}`)
    return await response.text()
  } catch {
    if (attempt >= 3) return ''
    await sleep(600 * 2 ** attempt)
    return fetchText(url, attempt + 1)
  }
}

/** A stable id for a heading: its SimpleArmory name, lower-cased and narrowed to word characters. */
function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The icon name a row is stored with: SimpleArmory's own, lower-cased, or nothing at all. */
function iconName(value) {
  const name = String(value || '').toLowerCase()
  return ICON_NAME.test(name) ? name : ''
}

/**
 * A shelf's tree while it is being read: the groups in the order the files name them, and the maps
 * that find a heading again by its id. Naming a heading a second time finds it rather than adding it
 * twice, which is what folds the two pet files - the pets that are earned somewhere and the ones
 * caught in the world - into one tree: a group both files name ("Midnight") is one section holding
 * the sources of one and the zones of the other, and a source both name is one row of tiles.
 */
function newTree() {
  const groups = []
  const sections = new Map()
  const sources = new Map()

  return {
    /** The section `name` names, made if this shelf has not got one yet. */
    section(name) {
      const id = slug(name)
      let found = sections.get(id)
      if (!found) {
        found = { id, en: name, subs: [] }
        sections.set(id, found)
        groups.push(found)
      }
      return found
    },

    /**
     * The source `name` names inside `section`, made if that section has not got one yet. A source
     * the file leaves nameless keeps its empty name, and its id is empty with it: the grid draws such
     * a block with no heading above it, which is what the continents' catch-all sources read like.
     */
    source(section, name) {
      const key = `${section.id}\u0000${slug(name)}`
      let found = sources.get(key)
      if (!found) {
        found = { id: slug(name), en: name, items: [] }
        sources.set(key, found)
        section.subs.push(found)
      }
      return found
    },

    /**
     * The tree as it is to be stored. A source with nothing filed under it is dropped, and so is a
     * group left with no source at all - a file may name a heading it has nothing in, which is not
     * something to draw an empty row for.
     */
    finish() {
      for (const group of groups) group.subs = group.subs.filter((sub) => sub.items.length)
      return groups.filter((group) => group.subs.length)
    }
  }
}

/**
 * The Wowhead address an item is drawn as, from the ids SimpleArmory already carries for it. A mount
 * is the item that teaches it or the spell that summons it; a pet is its creature, because Wowhead
 * draws a battle pet as the NPC it is and not as the `pet=` hunter-pet family; a toy and a decoration
 * are the item itself, which is the one address of their own Wowhead answers with a page. The ids are
 * read as numbers because a file is free to write them as strings - `decors.json` does - and the
 * atlas, the endpoint and the widget all speak in numbers.
 */
const WOWHEAD_REF = {
  mounts: (item) =>
    item.itemId ? { t: 'item', id: Number(item.itemId) } : item.spellid ? { t: 'spell', id: Number(item.spellid) } : null,
  pets: (item) =>
    item.creatureId ? { t: 'npc', id: Number(item.creatureId) } : item.itemId ? { t: 'item', id: Number(item.itemId) } : null,
  toys: (item) => (item.itemId ? { t: 'item', id: Number(item.itemId) } : null),
  decors: (item) => (item.itemId ? { t: 'item', id: Number(item.itemId) } : null)
}

/**
 * The groups SimpleArmory has not finished filing, left out of a shelf. Their decor file carries one:
 * `Undiscovered`, two hundred and twenty-five decorations whose source the site has not traced yet,
 * filed under a single heading that says "somewhere, we do not know". A shelf that draws them under
 * that heading says less than one that does not draw them at all - and they join the tree, under
 * their real source, on the day SimpleArmory files them. It is matched by name, so a bucket the site
 * renames or does away with simply stops matching.
 */
const DROPPED_GROUPS = new Set(['Undiscovered'])

/**
 * What a group the file leaves nameless is called. SimpleArmory's pets file opens with the bucket
 * that holds the pets collected, bought or handed out rather than earned in one expansion, and gives
 * it no name; their mounts tree names the same bucket after the shelf it sits on ("Mounts"), so the
 * shelf's own name is what this one is drawn under.
 *
 * A *source* the file leaves nameless (the pets caught anywhere in a continent, in `battlepets.json`)
 * is left nameless here too: the grid draws a block with no heading above it, which is what those
 * tiles read like at SimpleArmory - they belong to the whole continent rather than to a zone.
 */
const NAMELESS_GROUP = { mounts: 'Mounts', pets: 'Pets', toys: 'Toys', decors: 'Decor' }

/**
 * The shelves, the files each is read from, and where Blizzard's own index names its rows.
 *
 * Pets are read from two files, because SimpleArmory keeps them apart: the pets that are earned
 * somewhere (a drop, a vendor, a promotion) are one list, and the ones caught in the world are
 * another, filed by the zone they live in. Both are battle pets once they are in a journal, and a
 * character's collection does not tell them apart either, so one shelf holds them - and a group both
 * files name is one section (see `newTree`).
 *
 * Decorations are read like the rest, though their file differs from the others in two ways: the
 * `icon` it carries is the icon's numeric file id rather than its name (ZamImg serves that address
 * just as readily - `medium/7425121.jpg` is the same sprite as any named one), and Blizzard names
 * them through the housing index (`data/wow/decor`, which their `collections/decor` answers in), so
 * a shelf whose index is missing falls back to the names the file itself carries.
 */
const SHELVES = [
  { kind: 'mounts', files: ['mounts.json'], indexPath: 'mount', indexKey: 'mounts' },
  { kind: 'pets', files: ['pets.json', 'battlepets.json'], indexPath: 'pet', indexKey: 'pets' },
  { kind: 'toys', files: ['toys.json'], indexPath: 'toy', indexKey: 'toys' },
  { kind: 'decors', files: ['decors.json'], indexPath: 'decor', indexKey: 'decor_items' }
]

/** One SimpleArmory file, as the array of groups it is. */
async function readGroups(file) {
  const text = await fetchText(`${SIMPLEARMORY}/${file}`)
  if (!text) throw new Error(`SimpleArmory's ${file} could not be read`)
  return JSON.parse(text)
}

/**
 * One shelf, in the shape its files already have: the groups in the order they name them, the
 * sources under each, and the items under those. An item is stored as a tile and a tooltip need it -
 * its id, its name in both languages, the icon name SimpleArmory writes down for it and the Wowhead
 * address its own ids name - and an item a second file lists again is kept where it first appeared.
 *
 * The names come from Blizzard's index rather than from the file, because the file carries one
 * language and the site serves two; an item Blizzard's index has not got is named by SimpleArmory.
 */
async function buildShelf({ kind, files, indexPath, indexKey }) {
  // A shelf Blizzard has no index for is not a failure: its names then come from the files, which is
  // what SimpleArmory's English list is for.
  const index = indexPath
    ? (await api(`https://${REGION}.api.blizzard.com/data/wow/${indexPath}/index?${ns}`))?.[indexKey] || []
    : []
  const names = new Map(index.map((entry) => [entry.id, { en: entry.name?.en_US || '', ru: entry.name?.ru_RU || '' }]))

  const tree = newTree()
  const filed = new Set()
  let written = 0

  for (const file of files) {
    for (const group of await readGroups(file)) {
      if (DROPPED_GROUPS.has(group.name)) continue
      const section = tree.section(group.name || NAMELESS_GROUP[kind])
      for (const cat of group.subcats || []) {
        const source = tree.source(section, cat.name)
        for (const item of cat.items || []) {
          if (filed.has(item.ID)) continue
          filed.add(item.ID)
          // An item SimpleArmory marks as not released yet is not something a collector can go and get
          // or plan for, so it is left out of the atlas - and the next run of this script brings it in
          // when the mark is lifted. It is that mark alone that keeps an item out: an item marked as
          // no longer obtainable is kept, because it may be one a character already owns, and a shelf
          // that hid it would quietly drop it from that character's own count.
          if (item.notReleased) continue
          const named = names.get(item.ID)
          const row = {
            id: item.ID,
            en: named?.en || item.name || '',
            ru: named?.ru || item.name || '',
            icon: iconName(item.icon),
            wow: WOWHEAD_REF[kind](item)
          }
          // An item only one faction can hold is marked with that faction - `'A'` for the Alliance,
          // `'H'` for the Horde - and an item both can hold carries no mark at all, so the field is
          // left off rather than written empty. Whose shelf it lands on is decided when the shelf is
          // read, not here.
          if (item.side === 'A' || item.side === 'H') row.side = item.side
          source.items.push(row)
          written++
        }
      }
    }
  }

  return { groups: tree.finish(), written }
}

const data = {
  region: REGION,
  computedAt: new Date().toISOString().slice(0, 10),
  // The shelves not being rebuilt are carried over as they are, so a `--only` run touches its own
  // shelf and nothing else.
  shelves: { ...previous.shelves }
}

for (const shelf of SHELVES) {
  if (!builds(shelf.kind)) continue

  const { groups, written } = await buildShelf(shelf)
  data.shelves[shelf.kind] = groups
  console.log(
    `${shelf.kind}: ${written} written, ${groups.length} groups ` +
      `(${groups.reduce((n, group) => n + group.subs.length, 0)} sources)`
  )
}

fs.writeFileSync(OUT, `${JSON.stringify(data)}\n`)
console.log(`-> server/utils/collections-data.json (${Math.round(fs.statSync(OUT).size / 1024)} KB)`)


