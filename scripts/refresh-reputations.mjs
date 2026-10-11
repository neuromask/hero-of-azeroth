/**
 * Builds `server/utils/reputations-data.json`: every reputation faction in the game, filed the way the
 * reputation pane files them, with the top of each ladder beside it.
 *
 * Blizzard's reputation-faction index lists 284 entries, but they are not 284 reputations a player can
 * raise. The index is a *tree*: `root_factions` opens it on the expansions, `Guild` and the standalone
 * entries a patch leaves beside them, and every entry that groups others carries the `factions` it
 * groups. What the index does not carry is the difference between a heading and a reputation - an
 * expansion and a faction are both entries - so every entry is read once here and the answer is written
 * down: `is_header` says whether an entry groups others at all, `header_shows_bar` whether it is a
 * reputation in its own right besides (a renown faction is both, which is why the pane shows it as a
 * heading that carries a bar), and `player_faction.type` which side may raise it (`ALLIANCE`, `HORDE`,
 * or neither, which both may). Entries Blizzard marks as placeholders - `[PH]` for a name a patch has not
 * shipped, `[DNT]` for a test entry - are dropped outright, whatever they hold being lifted into their
 * parent, so neither a heading nor a counter carries them.
 *
 * The same read yields each faction's ladder: the tier table it points at (`reputation_tiers.id`, shared
 * by whole expansions - the classic Hated … Exalted table is one document for more than a hundred
 * factions), the last step of that table, and a renown faction's own last level. The ladder's *numbers*
 * are stored as well, as the `min_value`/`max_value` pair of every step in order, because a shelf draws
 * a scale with a tick at each step and the character's place inside it (see `server/utils/reputations.ts`
 * and `app/components/ReputationTrack.vue`). The step *names* are not: the character's own payload names
 * the stage it stands on, in the language of the page, and the eight names of the classic ladder are
 * message keys of their own (`shared/data/reputationsSchema.ts`).
 *
 * The factions a character cannot reach are kept here too - a shelf drops the other side's by side when it
 * is assembled - and the two counts in `reachable` are what the tiles measure a character against, the
 * way `server/utils/mounts.ts` measures one against its own mount journal.
 *
 * Usage: npm run refresh:reputations [region] [--fresh]   (default region: eu)
 *
 * Progress is cached in the OS temp directory, so an interrupted run continues where it stopped instead
 * of reading 284 factions again. Pass `--fresh` to ignore that cache, which is the safe choice after a
 * patch that adds factions.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const REGION = (args[0] || 'eu').toLowerCase()
const FRESH = process.argv.includes('--fresh')
const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/reputations-data.json', ROOT)
const CACHE = path.join(os.tmpdir(), `hoa-reputation-atlas-${REGION}.json`)

/** Blizzard throttles bursts hard, so the calls are kept slow and are retried. */
const CONCURRENCY = 5
const MAX_ATTEMPTS = 8

const env = fs.readFileSync(new URL('.env', ROOT), 'utf8')
const clientId = /NUXT_BLIZZARD_CLIENT_ID=(.*)/.exec(env)?.[1].trim()
const clientSecret = /NUXT_BLIZZARD_CLIENT_SECRET=(.*)/.exec(env)?.[1].trim()

if (!clientId || !clientSecret) {
  console.error('NUXT_BLIZZARD_CLIENT_ID / NUXT_BLIZZARD_CLIENT_SECRET are missing from .env')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const staticNs = `namespace=static-${REGION}`

const tokenResponse = await fetch(`https://${REGION}.battle.net/oauth/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  },
  body: 'grant_type=client_credentials'
})

if (!tokenResponse.ok) {
  console.error(`Battle.net rejected the credentials (${tokenResponse.status})`)
  process.exit(1)
}

const { access_token: token } = await tokenResponse.json()
const auth = { Authorization: `Bearer ${token}` }

let patch = ''

/** One read, retried when Blizzard throttles it or the connection drops. */
async function readJson(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: auth })

    if (response.status === 429 || response.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) return null
      await sleep(500 * (attempt + 1))
      return readJson(url, attempt + 1)
    }

    if (!response.ok) return null

    const data = await response.json()
    patch = /static-([^?]+)/.exec(data._links?.self?.href || '')?.[1] || patch
    return data
  } catch {
    if (attempt >= MAX_ATTEMPTS) return null
    await sleep(500 * (attempt + 1))
    return readJson(url, attempt + 1)
  }
}

/** One document of Blizzard's static reputation data, by its path. */
const get = (what) => readJson(`https://${REGION}.api.blizzard.com/data/wow/${what}?${staticNs}`)

const index = await get('reputation-faction/index')

if (!index?.factions?.length) {
  console.error('Blizzard did not answer with the reputation-faction index')
  process.exit(1)
}

const ids = index.factions.map((faction) => faction.id)
const cache = !FRESH && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
const queue = ids.filter((id) => cache[id] === undefined)
const pending = queue.length

console.log(`${ids.length} factions listed, ${pending} left to read`)

let fetched = 0

/**
 * One faction as this atlas keeps it: the two names a heading or a row is drawn with, the side that may
 * raise it, whether it groups others, whether it is a reputation besides, the top of its renown ladder
 * and its tier table. The children are kept because the tree below is built from them rather than from a
 * second read of the same 284 documents.
 */
function toKnot(detail) {
  return {
    en: detail.name?.en_US || '',
    ru: detail.name?.ru_RU || '',
    side: detail.player_faction?.type || '',
    header: detail.is_header === true,
    bar: detail.header_shows_bar === true,
    renown: detail.is_renown === true ? ((detail.renown_tiers || []).at(-1)?.level ?? 0) : 0,
    tiers: detail.reputation_tiers?.id ?? null,
    children: (detail.factions || []).map((child) => child.id)
  }
}

async function worker() {
  while (queue.length) {
    const id = queue.pop()
    const detail = await get(`reputation-faction/${id}`)

    if (detail) cache[id] = toKnot(detail)

    if (++fetched % 50 === 0 || fetched === pending) {
      console.log(`  ${fetched}/${pending}`)
      fs.writeFileSync(CACHE, JSON.stringify(cache))
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

/** A faction named only by the heading above it - one the index does not list on its own - read alone. */
const listed = new Set(ids)
const unnamed = []

for (const id of ids) {
  for (const child of cache[id]?.children || []) {
    if (!cache[child] && !listed.has(child)) unnamed.push(child)
  }
}

if (unnamed.length) {
  console.log(`${unnamed.length} factions were named only by their headings, reading them`)
  await Promise.all(
    unnamed.map(async (id) => {
      const detail = await get(`reputation-faction/${id}`)
      if (detail) cache[id] = toKnot(detail)
    })
  )
}

fs.writeFileSync(CACHE, JSON.stringify(cache))

const unresolved = ids.filter((id) => cache[id] === undefined)

/** The ladders: the tier tables, read once each, as the span of every step plus the top step's id. */
const ladders = {}
const tableIds = [...new Set(Object.values(cache).map((knot) => knot.tiers).filter((id) => id !== null))]

for (const tableId of tableIds) {
  const table = await get(`reputation-tiers/${tableId}`)
  const tiers = table?.tiers || []
  if (!tiers.length) continue

  ladders[tableId] = {
    top: tiers.at(-1)?.id ?? null,
    spans: tiers.map((tier) => [tier.min_value ?? 0, tier.max_value ?? 0]),
    // Both names of every step: a row reads the step it stands on by them (see the schema), and the
    // classic eight become message keys rather than strings.
    names: tiers.map((tier) => ({ en: tier.name?.en_US || '', ru: tier.name?.ru_RU || '' }))
  }
}

/**
 * Blizzard's own placeholders: `[PH]` is a name a patch has not shipped yet, `[DNT]` is a test entry the
 * developers file into the tree (`[DNT] AC Major Faction Child Renown Test` sits under the Maruuk Centaur).
 * Neither is a reputation a player can raise, so neither is counted and neither is drawn: a heading the
 * two of them carry is lifted out of the tree and its children stand where it stood - see `walk`.
 */
const PLACEHOLDER = /^\[(PH|DNT)\]/i

/**
 * The tree, walked from the roots the index names, as ids alone: the structure is what a shelf is cut
 * into - a root is an expansion or a standalone group, what hangs under it is a side, a garrison, a
 * cluster of city factions - and everything a heading or a row is drawn with is in the map beside it.
 * An id already walked is not walked twice, so a faction filed under two headings appears once.
 */
const tree = []
const visited = new Set()

function walk(id, depth) {
  const knot = cache[id]
  if (!knot || visited.has(id) || depth > 8) return null

  visited.add(id)
  const children = []

  for (const child of knot.children) {
    const built = walk(child, depth + 1)
    if (!built) continue
    if (built.hoisted) children.push(...built.children)
    else children.push(built)
  }

  // A placeholder is not drawn, and whatever it holds is lifted to stand where it stood.
  if (PLACEHOLDER.test(knot.en)) return { hoisted: true, children }

  return { id, children }
}

for (const root of index.root_factions || []) {
  const built = walk(root.id, 1)
  if (!built) continue
  if (built.hoisted) tree.push(...built.children)
  else tree.push(built)
}

/**
 * A faction that only groups others - an expansion, a side, `Guild` - shows no bar of its own, and a
 * placeholder is nobody's reputation at all. Both are kept in the map, because a heading is drawn by
 * name, but neither is a reputation: neither is counted and neither goes into `tops`. A faction the walk
 * did not reach is listed as a group of its own rather than dropped, so a patch that adds one under a
 * heading Blizzard has not wired up still reaches a shelf.
 */
const orphanIds = ids.filter(
  (id) => !visited.has(id) && cache[id] && !(cache[id].header && !cache[id].bar) && !PLACEHOLDER.test(cache[id].en)
)

function isReputation(knot) {
  return Boolean(knot) && !((knot.header && !knot.bar) || PLACEHOLDER.test(knot.en))
}

const tops = {}
const reachable = { ALLIANCE: 0, HORDE: 0 }

for (const id of Object.keys(cache)) {
  const knot = cache[id]
  if (!isReputation(knot)) continue

  // A renown ladder is its own top; every other faction ends at the last step of its tier table.
  const top = knot.renown || ladders[knot.tiers]?.top
  if (!top) continue

  tops[id] = top

  if (knot.side === 'ALLIANCE') reachable.ALLIANCE++
  else if (knot.side === 'HORDE') reachable.HORDE++
  else {
    reachable.ALLIANCE++
    reachable.HORDE++
  }
}

/**
 * The factions no heading of Blizzard's tree reached - the twelve the Shattrath and Steamwheedle
 * reputations of the Burning Crusade are left under - are collected into one group of their own rather
 * than dropped or drawn as twelve headings. It is a synthetic entry: its id is `other` rather than a
 * statu id, and its name is a message key (`REPUTATION_GROUP_KEYS`, `shared/data/reputationsSchema.ts`),
 * because no document of Blizzard's names it.
 */
if (orphanIds.length) {
  tree.push({ id: 'other', children: orphanIds.map((id) => ({ id, children: [] })) })
}

const factions = {}
for (const id of Object.keys(cache)) {
  const knot = cache[id]
  // A placeholder is nobody's reputation and no heading is drawn by its name, so it is not carried.
  if (PLACEHOLDER.test(knot.en)) continue

  factions[id] = {
    en: knot.en,
    ru: knot.ru,
    side: knot.side,
    renown: knot.renown,
    top: tops[id] ?? 0,
    ladder: knot.tiers
  }
}

fs.writeFileSync(
  OUT,
  `${JSON.stringify({
    patch,
    computedAt: new Date().toISOString().slice(0, 10),
    listed: ids.length,
    reachable,
    tops,
    ladders,
    factions,
    tree
  })}\n`
)

/** What the tree came out as, so a run can be read at a glance rather than decoded from the file. */
const depths = new Map()
const carrying = []
const grouped = []

function inspect(node, depth) {
  depths.set(depth, (depths.get(depth) || 0) + 1)
  const knot = cache[node.id]

  if (node.children.length && knot?.bar) carrying.push(`${node.id} ${knot.en}`)
  if (node.children.length) {
    for (const child of node.children) {
      if (child.children.length) grouped.push(`${knot?.en} → ${cache[child.id]?.en}`)
    }
  }

  for (const child of node.children) inspect(child, depth + 1)
}

for (const root of tree) inspect(root, 1)

console.log('\nroots:')
for (const root of tree) {
  const knot = cache[root.id]
  console.log(`  ${root.id} ${knot?.en} (${knot?.side || 'both sides'}) → ${root.children.length} under it`)
}
console.log(`depths: ${[...depths].map(([depth, count]) => `${depth}:${count}`).join(' ')}`)
console.log(`both a heading and a reputation: ${carrying.length ? carrying.join(', ') : 'none'}`)
if (grouped.length) console.log(`grouped groups: ${[...new Set(grouped)].slice(0, 12).join(', ')}`)
console.log(`reachable: ${reachable.ALLIANCE} as an Alliance character, ${reachable.HORDE} as a Horde one`)
console.log(`${Object.keys(tops).length} ladders, ${Object.keys(ladders).length} tier tables, patch ${patch}`)
console.log(`-> server/utils/reputations-data.json`)

if (unresolved.length) {
  console.log(`Careful: ${unresolved.length} factions could not be read. Run again to retry them.`)
}
