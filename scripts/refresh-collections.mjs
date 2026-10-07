/**
 * Builds `server/utils/collections-data.json`, the whole of what can be collected.
 *
 * The Collections pages are drawn against every mount, pet and toy in the game, not only the ones a
 * character holds, so a shelf reads 69 of 79 rather than 69 of 69. That catalogue - and every tile's
 * icon - is SimpleArmory's. Each shelf is read from the file they keep it in
 * (`https://simplearmory.com/data/{mounts,pets,battlepets,toys}.json`) and what is stored is that
 * file's own tree: the groups it names (an expansion, an event, a continent), the sources under each
 * ("Raid Drop", "Vendor", a zone), and the items under those. An item carries four things, which is
 * what a tile and a tooltip need: its id, its name in both languages, the icon NAME SimpleArmory
 * writes down for it (`inv_dwarvenmechboss_bronze`) and the Wowhead address the ids it already
 * carries name. The icon name is what a ZamImg address is built from - the same name the game's own
 * 2D sprite is filed under - and a Blizzard icon URL cannot stand in for it, because ZamImg serves
 * sprites by name and rejects the numeric file id Blizzard hands out in its place.
 *
 * Blizzard is read once for a shelf, and not for an icon: its static index names every mount, pet and
 * toy in both languages (SimpleArmory carries English only), and the difference between that index
 * and SimpleArmory's files - a mount shipped before a fan site filed it - is put in the tree's last
 * group rather than lost. What a character holds is read per request, by the server, and matched
 * against the ids stored here.
 *
 * `--only=mounts` (a comma list) rebuilds just those shelves and keeps the rest of the atlas on disk,
 * which is enough when only one source has moved.
 *
 * Usage: npm run refresh:collections [region] [concurrency] [--only=<kinds>]   (default region: eu)
 */
import fs from 'node:fs'

const REGION = (process.argv.slice(2).find((a) => !a.startsWith('--') && !/^\d+$/.test(a)) || 'eu').toLowerCase()
const CONCURRENCY = Number(process.argv.find((a) => /^\d+$/.test(a)) || 8)
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

/** Runs `worker` over `items`, `CONCURRENCY` at a time, keeping the answers in order. */
async function pool(items, worker) {
  const out = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run))
  return out
}

/**
 * Reads one URL as text, waiting and retrying on a stumble. A `403` is not retried: it is a refusal,
 * and pressing it again only deepens it.
 */
async function fetchText(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS })
    if (response.status === 403 || response.status === 404) return ''
    if (!response.ok) throw new Error(`${response.status}`)
    return await response.text()
  } catch {
    if (attempt >= 3) return ''
    await sleep(600 * 2 ** attempt)
    return fetchText(url, attempt + 1)
  }
}

/** The JSON of a Wowhead tooltip, or `null` when Wowhead does not carry it. */
async function wowheadJson(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS })
    if (response.status === 403 || response.status === 404) return null
    if (!response.ok) throw new Error(`${response.status}`)
    return await response.json()
  } catch {
    if (attempt >= 3) return null
    await sleep(600 * 2 ** attempt)
    return wowheadJson(url, attempt + 1)
  }
}

/**
 * What Wowhead answers for a mount: the item that teaches it, or - for the mounts taught by a spell
 * rather than an item - that spell. Wowhead has no mount tooltip, so `/mount/{id}` is a redirect,
 * and the page it lands on is what its widget draws. Only a mount SimpleArmory has not filed is
 * asked this: every mount the files carry names its own item or spell already.
 */
async function wowheadMountRef(id, attempt = 0) {
  try {
    const response = await fetch(`https://www.wowhead.com/mount/${id}`, { redirect: 'manual', headers: FETCH_HEADERS })
    if (response.status === 403) return null
    const location = response.headers.get('location') || ''
    const item = /\/item=(\d+)/.exec(location)?.[1]
    if (item) return { t: 'item', id: Number(item) }
    const spell = /\/spell=(\d+)/.exec(location)?.[1]
    if (spell) return { t: 'spell', id: Number(spell) }
    return null
  } catch {
    if (attempt >= 3) return null
    await sleep(400 * (attempt + 1))
    return wowheadMountRef(id, attempt + 1)
  }
}

/** The icon name Wowhead draws for one of its entities - the item behind a mount, or a spell. */
async function wowheadIcon(type, id) {
  const tooltip = await wowheadJson(`https://nether.wowhead.com/tooltip/${type}/${id}`)
  const name = String(tooltip?.icon || '').toLowerCase()
  return ICON_NAME.test(name) ? name : ''
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
        found = { id, en: name, subs: [], items: [] }
        sections.set(id, found)
        groups.push(found)
      }
      return found
    },

    /**
     * The source `name` names inside `section`, made if that section has not got one yet. A source
     * the file leaves nameless keeps its empty name, and its id is empty with it: the grid draws such
     * a block with no heading, which is what a group's own tiles read like.
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
     * group left with neither a source nor an item of its own - a file may name a heading it has
     * nothing in, which is not something to draw an empty row for. `items` is only written where a
     * group has items of its own, which the unfiled tail does.
     */
    finish() {
      for (const group of groups) {
        group.subs = group.subs.filter((sub) => sub.items.length)
        if (!group.items.length) delete group.items
      }
      return groups.filter((group) => group.subs.length || group.items)
    }
  }
}

/**
 * The Wowhead address an item is drawn as, from the ids SimpleArmory already carries for it. A mount
 * is the item that teaches it or the spell that summons it; a pet is its creature, because Wowhead
 * draws a battle pet as the NPC it is and not as the `pet=` hunter-pet family; a toy is the item it
 * is, which is the one address of its own Wowhead answers with a page.
 */
const WOWHEAD_REF = {
  mounts: (item) =>
    item.itemId ? { t: 'item', id: item.itemId } : item.spellid ? { t: 'spell', id: item.spellid } : null,
  pets: (item) =>
    item.creatureId ? { t: 'npc', id: item.creatureId } : item.itemId ? { t: 'item', id: item.itemId } : null,
  toys: (item) => (item.itemId ? { t: 'item', id: item.itemId } : null)
}

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
const NAMELESS_GROUP = { mounts: 'Mounts', pets: 'Pets', toys: 'Toys' }

/**
 * The three shelves, the files each is read from, and where Blizzard's own index names its rows.
 *
 * Pets are read from two files, because SimpleArmory keeps them apart: the pets that are earned
 * somewhere (a drop, a vendor, a promotion) are one list, and the ones caught in the world are
 * another, filed by the zone they live in. Both are battle pets once they are in a journal, and a
 * character's collection does not tell them apart either, so one shelf holds them - and a group both
 * files name is one section (see `newTree`).
 */
const SHELVES = [
  { kind: 'mounts', files: ['mounts.json'], indexPath: 'mount', indexKey: 'mounts' },
  { kind: 'pets', files: ['pets.json', 'battlepets.json'], indexPath: 'pet', indexKey: 'pets' },
  { kind: 'toys', files: ['toys.json'], indexPath: 'toy', indexKey: 'toys' }
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
  const index = (await api(`https://${REGION}.api.blizzard.com/data/wow/${indexPath}/index?${ns}`))?.[indexKey] || []
  const names = new Map(index.map((entry) => [entry.id, { en: entry.name?.en_US || '', ru: entry.name?.ru_RU || '' }]))

  const tree = newTree()
  const filed = new Set()
  let written = 0

  for (const file of files) {
    for (const group of await readGroups(file)) {
      const section = tree.section(group.name || NAMELESS_GROUP[kind])
      for (const cat of group.subcats || []) {
        const source = tree.source(section, cat.name)
        for (const item of cat.items || []) {
          if (filed.has(item.ID)) continue
          filed.add(item.ID)
          const named = names.get(item.ID)
          source.items.push({
            id: item.ID,
            en: named?.en || item.name || '',
            ru: named?.ru || item.name || '',
            icon: iconName(item.icon),
            wow: WOWHEAD_REF[kind](item)
          })
          written++
        }
      }
    }
  }

  return { groups: tree.finish(), filed, written, index }
}

/**
 * The tail group: what Blizzard publishes and SimpleArmory has not filed yet, which is what a patch
 * looks like before the fan sites catch up. Its names are Blizzard's, and a mount is asked of
 * Wowhead as well, because its id is the one address Wowhead answers a page for - so a mount nobody
 * has filed still gets a tile and a tooltip. A pet or a toy has no such address in Blizzard's index
 * alone, so its square waits for SimpleArmory as a question mark.
 */
async function unfiledTail(kind, index, filed) {
  const rows = index.filter((entry) => !filed.has(entry.id) && (entry.name?.en_US || entry.name?.ru_RU))
  if (!rows.length) return null

  const items = await pool(rows, async (entry) => {
    const wow = kind === 'mounts' ? await wowheadMountRef(entry.id) : null
    const icon = wow ? await wowheadIcon(wow.t, wow.id) : ''
    return {
      id: entry.id,
      en: entry.name?.en_US || '',
      ru: entry.name?.ru_RU || '',
      icon,
      wow
    }
  })
  items.sort((a, b) => a.id - b.id)
  return { id: 'uncategorized', en: 'New / Uncategorized', subs: [], items }
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

  const { groups, filed, written, index } = await buildShelf(shelf)
  const tail = await unfiledTail(shelf.kind, index, filed)
  if (tail) {
    groups.push(tail)
    console.log(`${shelf.kind}: ${tail.items.length} not filed at SimpleArmory, under ${tail.en}`)
  }
  data.shelves[shelf.kind] = groups
  console.log(
    `${shelf.kind}: ${written + (tail ? tail.items.length : 0)} written, ${groups.length} groups ` +
      `(${groups.reduce((n, group) => n + group.subs.length, 0)} sources, ` +
      `${groups.filter((group) => !group.subs.length).length} drawn flat)`
  )
}

fs.writeFileSync(OUT, `${JSON.stringify(data)}\n`)
console.log(`-> server/utils/collections-data.json (${Math.round(fs.statSync(OUT).size / 1024)} KB)`)


