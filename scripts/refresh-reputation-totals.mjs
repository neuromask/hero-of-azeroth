/**
 * Refreshes `server/utils/reputation-totals.json`: how many reputation factions a
 * character can actually work on, and the top of each faction's ladder.
 *
 * Blizzard's reputation-faction index lists 284 entries, but they are not 284
 * reputations a player can raise. 77 of them belong to one of the two player factions
 * and a character is only ever on one side; the rest of the slack is made of the
 * entries that only organize the reputation pane - the expansions, the two faction
 * groups, `Guild` - which carry an `is_header` flag of their own. The index carries
 * neither a side nor that flag, so every faction is read once here and the answer is
 * written down, which keeps the character page from paying for 284 calls.
 *
 * The same read yields the top of each faction's ladder: the last entry of the tier
 * table the faction points at - Exalted for the classic table, Level 100 for a delve
 * companion, Mastermind for the brokers of K'aresh - or the highest renown level of a
 * renown faction. That is what tells a reputation the character has finished from one
 * they merely have a record with.
 *
 * Usage: npm run refresh:reputations [region] [--fresh]   (default region: eu)
 *
 * Progress is cached in the OS temp directory, so an interrupted run continues where it
 * stopped instead of starting over. Pass --fresh to ignore that cache, which is the safe
 * choice after a patch that adds factions.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const REGION = (args[0] || 'eu').toLowerCase()
const FRESH = process.argv.includes('--fresh')
const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/reputation-totals.json', ROOT)
const CACHE = path.join(os.tmpdir(), `hoa-reputation-totals-${REGION}.json`)

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
    patch ||= data._links?.self?.href?.match(/namespace=static-([^?]+)/)?.[1] || ''
    return data
  } catch {
    if (attempt >= MAX_ATTEMPTS) return null
    await sleep(500 * (attempt + 1))
    return readJson(url, attempt + 1)
  }
}

console.log(`Reading the ${REGION.toUpperCase()} reputation index...`)
const index = await readJson(`https://${REGION}.api.blizzard.com/data/wow/reputation-faction/index?${staticNs}`)

if (!index) {
  console.error('The reputation index could not be read')
  process.exit(1)
}

const ids = (index.factions || []).map((faction) => faction.id)
const cache = !FRESH && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
const queue = ids.filter((id) => cache[id] === undefined)
const pending = queue.length

console.log(`${ids.length} factions known, ${pending} left to read`)

let fetched = 0

async function worker() {
  while (queue.length) {
    const id = queue.pop()
    const detail = await readJson(`https://${REGION}.api.blizzard.com/data/wow/reputation-faction/${id}?${staticNs}`)

    if (detail) {
      const name = detail.name?.en_US || ''

      cache[id] = {
        name,
        side: detail.player_faction?.type || 'NEUTRAL',
        // A heading that shows no bar of its own only groups other factions: the
        // expansions, the two faction groups, `Guild`. A heading that does show one is a
        // reputation in its own right (Alliance Vanguard, The Tillers, a renown faction).
        // `[PH]` entries are Blizzard's placeholders and reachable by nobody.
        skipped: (detail.is_header === true && detail.header_shows_bar !== true) || /^\[PH\]/i.test(name),
        renown: detail.is_renown === true ? (detail.renown_tiers || []).at(-1)?.level ?? 0 : 0,
        tiers: detail.reputation_tiers?.id ?? null
      }
    }

    if (++fetched % 50 === 0 || fetched === pending) {
      console.log(`  ${fetched}/${pending}`)
      fs.writeFileSync(CACHE, JSON.stringify(cache))
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
fs.writeFileSync(CACHE, JSON.stringify(cache))

const unresolved = ids.filter((id) => cache[id] === undefined)

/** The top tier of a tier table, read once per table and shared by every faction on it. */
const tables = new Map()
async function tableTop(tableId) {
  if (tableId === null) return null
  if (tables.has(tableId)) return tables.get(tableId)
  const table = await readJson(`https://${REGION}.api.blizzard.com/data/wow/reputation-tiers/${tableId}?${staticNs}`)
  const top = (table?.tiers || []).at(-1)?.id ?? null
  tables.set(tableId, top)
  return top
}

const reachable = { ALLIANCE: 0, HORDE: 0 }
const tops = {}
const headings = []

for (const id of ids) {
  const entry = cache[id]
  if (!entry) continue

  if (entry.skipped) {
    headings.push(`${id} ${entry.name} (${entry.side})`)
    continue
  }

  // A renown ladder is its own top; every other faction points at a tier table.
  const top = entry.renown || (await tableTop(entry.tiers))
  if (!top) continue
  tops[id] = top

  if (entry.side === 'ALLIANCE') reachable.ALLIANCE++
  else if (entry.side === 'HORDE') reachable.HORDE++
  else {
    reachable.ALLIANCE++
    reachable.HORDE++
  }
}

fs.writeFileSync(OUT, `${JSON.stringify({
  patch,
  listed: ids.length,
  reachable,
  tops,
  computedAt: new Date().toISOString().slice(0, 10)
}, null, 2)}\n`)

console.log(`\n${ids.length} listed, ${headings.length} of them only group other factions:`)
for (const heading of headings) console.log(`  ${heading}`)
console.log(`reachable: ${reachable.ALLIANCE} as an Alliance character, ${reachable.HORDE} as a Horde one (patch ${patch})`)
console.log(`${Object.keys(tops).length} ladders written -> server/utils/reputation-totals.json`)
if (unresolved.length) {
  console.log(`Careful: ${unresolved.length} factions could not be read, so the totals are too low. Run again to retry them.`)
}