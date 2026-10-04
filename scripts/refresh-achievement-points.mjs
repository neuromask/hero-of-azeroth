/**
 * Refreshes `server/utils/achievement-points.json`, the total number of
 * achievement points that exist in the game.
 *
 * The number backs the progress bar next to a character's own score, but
 * Blizzard does not expose it anywhere: the static achievement index only lists
 * ids and names, and the profile achievements summary reports just what the
 * character earned. The only source of truth is one payload per achievement, so
 * this script walks the 9000-odd achievements, adds up their `points` and writes
 * the sum.
 *
 * Usage: npm run refresh:achievements [region] [--fresh]   (default region: eu)
 *
 * Progress is cached in the OS temp directory, so an interrupted run continues
 * where it stopped instead of starting over. Pass --fresh to ignore that cache
 * and re-read every achievement, which is the safe choice after a hotfix that
 * changes points.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const REGION = (args[0] || 'eu').toLowerCase()
const FRESH = process.argv.includes('--fresh')
const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/achievement-points.json', ROOT)
const CACHE = path.join(os.tmpdir(), `hoa-achievement-points-${REGION}.json`)

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

/** Points of one achievement, or null when it could not be read (it is retried on the next run). */
async function fetchAchievementPoints(id, attempt = 0) {
  try {
    const response = await fetch(
      `https://${REGION}.api.blizzard.com/data/wow/achievement/${id}?namespace=static-${REGION}&locale=en_US`,
      { headers: auth }
    )

    if (response.status === 429) {
      if (attempt >= MAX_ATTEMPTS) return null
      await sleep(500 * (attempt + 1))
      return fetchAchievementPoints(id, attempt + 1)
    }

    if (!response.ok) return null

    const data = await response.json()
    patch ||= data._links?.self?.href?.match(/namespace=static-([^?]+)/)?.[1] || ''
    return typeof data.points === 'number' ? data.points : 0
  } catch {
    if (attempt >= MAX_ATTEMPTS) return null
    await sleep(500 * (attempt + 1))
    return fetchAchievementPoints(id, attempt + 1)
  }
}

console.log(`Reading the ${REGION.toUpperCase()} achievement index...`)
const index = await (
  await fetch(`https://${REGION}.api.blizzard.com/data/wow/achievement/index?namespace=static-${REGION}&locale=en_US`, { headers: auth })
).json()

const ids = (index.achievements || []).map((achievement) => achievement.id)
const cache = !FRESH && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
const queue = ids.filter((id) => cache[id] === undefined)
const pending = queue.length

console.log(`${ids.length} achievements known, ${pending} left to read`)

let fetched = 0

async function worker() {
  while (queue.length) {
    const id = queue.pop()
    const points = await fetchAchievementPoints(id)
    if (points !== null) cache[id] = points
    if (++fetched % 500 === 0 || fetched === pending) {
      console.log(`  ${fetched}/${pending}`)
      fs.writeFileSync(CACHE, JSON.stringify(cache))
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
fs.writeFileSync(CACHE, JSON.stringify(cache))

const unresolved = ids.filter((id) => cache[id] === undefined)
const points = ids.reduce((sum, id) => sum + Math.max(0, cache[id] || 0), 0)

fs.writeFileSync(OUT, `${JSON.stringify({ total: points, achievements: ids.length, patch, computedAt: new Date().toISOString().slice(0, 10) }, null, 2)}\n`)

console.log(`\n${points} points over ${ids.length} achievements (patch ${patch}) -> server/utils/achievement-points.json`)
if (unresolved.length) {
  console.log(`Careful: ${unresolved.length} achievements could not be read, so the total is too low. Run again to retry them.`)
}
