/**
 * Builds `server/utils/achievement-meta.json`, the static half of every achievement in the game.
 *
 * The activity feed is the hundred achievements a character earned most recently, and a card is
 * drawn from what an achievement *is*: its name and its description in both of the site's languages,
 * the points it is worth, the category it sits in (which is what the card's glow is decided by) and
 * its icon. Blizzard publishes none of that in bulk - the static index lists ids and names alone, and
 * everything else is one document per achievement plus one more for its icon - so a feed that read it
 * per request would spend two hundred calls on its own cards. That is slow, and it is what Blizzard's
 * rate limiter answers with a 429: a call that failed, and a card that lost its icon.
 *
 * That half is therefore paid for here, once, for all 9,041 achievements: the feed looks an
 * achievement up in the catalogue it ships and touches Blizzard only for the character's own list.
 * Only what a card shows is stored - the name, the description, the points, the category and the
 * icon's file name - and a category's name is kept once in `categories` rather than on every
 * achievement that sits in it. The icon's address is built per request from the region being read,
 * because the file is named the same everywhere while the host that serves it is not.
 *
 * Usage: npm run refresh:achievement-meta [region] [concurrency] [--fresh]   (default: eu 8)
 *
 * Progress is cached in the OS temp directory, so an interrupted run continues where it stopped
 * instead of reading nine thousand achievements again. Pass --fresh to ignore that cache, which is
 * what a patch wants: it changes points, wording and icons, and every one of them has to be re-read.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const REGION = (args[0] || 'eu').toLowerCase()
const CONCURRENCY = Number(args[1] || 8)
const FRESH = process.argv.includes('--fresh')
const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/achievement-meta.json', ROOT)
const CACHE = path.join(os.tmpdir(), `hoa-achievement-meta-${REGION}.json`)

/**
 * Blizzard throttles bursts hard, so the reads are kept to a few at a time and are retried. Eight in
 * flight reads the whole index in a few minutes and stays inside the limiter; a whole thousand at
 * once is answered with 429s, which is the very thing this script exists to keep off the request path.
 */
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

/** One document, retried while Blizzard is throttling (429) or briefly unhappy, or null if it never came. */
async function read(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: auth })
    if (response.status === 429 || response.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) return null
      await sleep(500 * (attempt + 1))
      return read(url, attempt + 1)
    }
    return response.ok ? await response.json() : null
  } catch {
    if (attempt >= MAX_ATTEMPTS) return null
    await sleep(500 * (attempt + 1))
    return read(url, attempt + 1)
  }
}

/** An achievement's name and description in `locale`, and the category it is filed under there. */
function detail(region, locale, id) {
  return read(`https://${region}.api.blizzard.com/data/wow/achievement/${id}?namespace=static-${region}&locale=${locale}`)
}

/** The file name of an achievement's icon, which its address is built from. */
function iconName(media) {
  const icon = (media?.assets || []).find((asset) => asset?.key === 'icon')?.value || ''
  return icon.split('/').pop()?.replace(/\.jpg$/, '') || ''
}

/**
 * Reads one achievement: its two documents, in both languages, and its icon.
 *
 * The icon is asked for once - it is the same picture whichever language the page is read in, and
 * only the address it is served from carries the region - and its file name is kept rather than the
 * address Blizzard answered with, so a feed read in any region builds the one it needs.
 *
 * A detail that never came leaves `null`: the id is then retried on the next run rather than written
 * as a half-empty achievement, which the site would show as a card with no name and no icon.
 */
async function fetchAchievement(region, id) {
  const [en, ru, media] = await Promise.all([
    detail(region, 'en_US', id),
    detail(region, 'ru_RU', id),
    read(`https://${region}.api.blizzard.com/data/wow/media/achievement/${id}?namespace=static-${region}&locale=en_US`)
  ])

  if (!en) return null

  return {
    category: en.category?.id || 0,
    record: {
      en: en.name || '',
      ru: ru?.name || en.name || '',
      desc: en.description || '',
      descRu: ru?.description || en.description || '',
      points: typeof en.points === 'number' ? en.points : 0,
      category: en.category?.id || 0,
      icon: iconName(media)
    },
    categoryNames: {
      en: en.category?.name || '',
      ru: ru?.category?.name || en.category?.name || ''
    }
  }
}

/** Runs `worker` over `queue`, `CONCURRENCY` of them at a time. */
async function pool(queue, worker) {
  const waiting = [...queue]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, waiting.length) }, async () => {
      let id
      while ((id = waiting.shift()) !== undefined) await worker(id)
    })
  )
}

console.log(`Reading the ${REGION.toUpperCase()} achievement index...`)
const index = await read(`https://${REGION}.api.blizzard.com/data/wow/achievement/index?namespace=static-${REGION}&locale=en_US`)
const ids = (index?.achievements || []).map((achievement) => achievement.id)

if (!ids.length) {
  console.error('The achievement index came back empty, so there is nothing to write.')
  process.exit(1)
}

const cached = !FRESH && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {}
const queue = ids.filter((id) => !cached[id])
const pending = queue.length

console.log(`${ids.length} achievements known, ${pending} left to read`)

let fetched = 0

await pool(queue, async (id) => {
  const achievement = await fetchAchievement(REGION, id)
  if (achievement) cached[id] = achievement
  if (++fetched % 250 === 0 || fetched === pending) {
    console.log(`  ${fetched}/${pending}`)
    fs.writeFileSync(CACHE, JSON.stringify(cached))
  }
})

fs.writeFileSync(CACHE, JSON.stringify(cached))

const unresolved = ids.filter((id) => !cached[id])
const categories = {}
const items = {}

for (const id of ids) {
  const achievement = cached[id]
  if (!achievement) continue
  items[id] = achievement.record
  // The document behind an achievement is also the only place its category's own name is spelled, so
  // the map is assembled from what the achievements already carry rather than read again per category.
  if (achievement.category && !categories[achievement.category]) {
    categories[achievement.category] = achievement.categoryNames
  }
}

const data = {
  region: REGION,
  patch: (index._links?.self?.href?.match(/namespace=static-(.+)$/) || [])[1] || '',
  computedAt: new Date().toISOString().slice(0, 10),
  achievements: ids.length,
  categories,
  items
}

fs.writeFileSync(OUT, `${JSON.stringify(data)}\n`)

const size = Math.round(fs.statSync(OUT).size / 1024)
const written = Object.keys(items).length
console.log(`\n${written} achievements and ${Object.keys(categories).length} categories ` +
  `(patch ${data.patch}) -> server/utils/achievement-meta.json (${size} KB)`)
if (unresolved.length) {
  console.log(`Careful: ${unresolved.length} achievements could not be read and are missing from the ` +
    'catalogue. Run again to retry them.')
}

