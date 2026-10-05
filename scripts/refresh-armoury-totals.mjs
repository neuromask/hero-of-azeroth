/**
 * Refreshes `server/utils/armoury-totals.json`, the two "how much can actually be
 * earned" numbers the tiles are measured against.
 *
 * Both exist because the static indexes over-count:
 *
 *  - Achievements. The static index lists every achievement it knows, and summing their
 *    `points` gives 66,680 - but that includes achievements no character can earn any
 *    more (removed content, unreleased content, the other faction's, season rewards that
 *    closed). Blizzard publishes the reachable figure only on its own Armoury, as the
 *    `totalPoints` of each achievement category. For the reference character below those
 *    sum to 59,215, and the world's best score sits 10 points under it.
 *
 *  - Mounts. The static mount index holds 1,676 entries, but 289 of them are not in any
 *    character's journal: unreleased and placeholder content ("[PH] Purple Cat Mount",
 *    "Wintry Witchwick's Rider", the Trading Post's coming stock). The Armoury lists the
 *    mounts a character's journal actually holds, 1,387 for the reference character.
 *
 * A patch that adds achievements or releases mounts moves both numbers, so the script is
 * run after a patch. It needs one character to read the Armoury with - any character
 * that exists works, and its own progress does not matter: only the totals are used.
 *
 * Usage: npm run refresh:armoury-totals [region] [realm] [name]   (default region: eu)
 */
import fs from 'node:fs'

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const REGION = (args[0] || 'eu').toLowerCase()
const REALM = args[1]
const NAME = args[2]

const ROOT = new URL('..', import.meta.url)
const OUT = new URL('server/utils/armoury-totals.json', ROOT)
const LOCALE = 'en-gb'

if (!REALM || !NAME) {
  console.error('Usage: npm run refresh:armoury-totals [region] [realm] [name]')
  console.error('Example: npm run refresh:armoury-totals eu silvermoon exent')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Reads the JSON object or array that starts at `start` in `text`.
 *
 * The Armoury ships its data inside a `<script>` block, so the payload has to be cut out
 * of HTML. A regex cannot do it - the strings inside hold braces and brackets of their own
 * ("[PH] Purple Cat Mount") - so this walks the text and only counts delimiters outside
 * strings, escapes included.
 */
function sliceJson(text, start) {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') inString = true
    else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }

  throw new Error('the JSON payload never closes')
}

/** Fetches one Armoury page, retrying a few times: it is a web page, not an API. */
async function armoury(path, attempt = 0) {
  const url = `https://worldofwarcraft.blizzard.com/${LOCALE}/character/${REGION}/${REALM}/${encodeURIComponent(NAME)}/${path}`

  try {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; heroofazeroth.com)' } })
    if (!response.ok) throw new Error(`the Armoury answered ${response.status}`)
    return await response.text()
  } catch (err) {
    if (attempt >= 3) throw new Error(`${path}: ${err.message}`)
    await sleep(1000 * (attempt + 1))
    return armoury(path, attempt + 1)
  }
}

const achievementsHtml = await armoury('achievements')
const at = achievementsHtml.indexOf('"achievementIndex":')
if (at === -1) throw new Error('the achievements page carried no achievementIndex')

const index = sliceJson(achievementsHtml, achievementsHtml.indexOf('{', at))
const categories = index.categories || []
const achievements = categories.reduce((sum, category) => sum + (category.totalPoints || 0), 0)

if (!achievements) throw new Error('the achievementIndex carried no category totals')

const collectionsHtml = await armoury('collections/mounts')
const at2 = collectionsHtml.indexOf('"mountsCollected":')
if (at2 === -1) throw new Error('the collections page carried no mountsCollected')

const mountsAt = collectionsHtml.indexOf('"mounts":[', at2)
if (mountsAt === -1) throw new Error('the collections page carried no mount list')

const mountList = sliceJson(collectionsHtml, collectionsHtml.indexOf('[', mountsAt))
const mounts = mountList.length
const collected = mountList.filter((mount) => mount.collected).length

// The patch the Armoury is serving is worth recording, but its absence is not a failure:
// the read only needs the public static namespace, which the checkout's credentials unlock.
let patch = ''
try {
  const env = fs.readFileSync(new URL('.env', ROOT), 'utf8')
  const clientId = /NUXT_BLIZZARD_CLIENT_ID=(.*)/.exec(env)?.[1].trim()
  const clientSecret = /NUXT_BLIZZARD_CLIENT_SECRET=(.*)/.exec(env)?.[1].trim()

  if (clientId && clientSecret) {
    const tokenResponse = await fetch(`https://${REGION}.battle.net/oauth/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    })
    const { access_token: token } = await tokenResponse.json()
    const data = await (await fetch(`https://${REGION}.api.blizzard.com/data/wow/mount/index?namespace=static-${REGION}`, {
      headers: { Authorization: `Bearer ${token}` }
    })).json()
    patch = data?.mounts?.[0]?.key?.href?.match(/namespace=static-([^?]+)/)?.[1] || ''
  }
} catch {
  patch = ''
}

fs.writeFileSync(OUT, `${JSON.stringify({
  reference: `${REGION}/${REALM}/${NAME}`,
  patch,
  computedAt: new Date().toISOString().slice(0, 10),
  achievements,
  mounts
}, null, 2)}\n`)

console.log(`${categories.length} achievement categories, ${achievements} reachable points`)
console.log(`mounts: ${mounts} in the journal (${collected} of them collected)`)
console.log(`-> server/utils/armoury-totals.json (patch ${patch || 'unknown'})`)