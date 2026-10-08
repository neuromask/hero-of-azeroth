/**
 * Helpers for what the official WoW Armoury publishes: the class artwork behind a character, and the
 * journal a character's collection is measured against.
 *
 * Blizzard serves it from the public render CDN (no auth needed); it is not part
 * of the game data API. The Armoury builds a character page out of two images:
 *
 *   <div background = profile-backgrounds/v2/armory_bg_class_{class}.jpg>
 *     <img character = ...-main-raw.png>
 *   </div>
 *
 * The class artwork is a character-free 2400x1860 scene, so it can be dropped
 * straight behind the render. The race artwork under `shadow/profile-background/`
 * is the same scene with a black silhouette of the race model baked into it,
 * which is why it is not used: the silhouette would be visible next to the
 * render instead of hidden behind it.
 */
export const ARMORY_CDN = 'https://render.worldofwarcraft.com'

/**
 * Playable class id (from the character profile API) -> CDN slug.
 *
 * Mind the spelling: these background files use underscores for multi-word
 * classes (`armory_bg_class_demon_hunter.jpg`), unlike the rest of the CDN.
 */
const CLASS_SLUGS: Record<number, string> = {
  1: 'warrior',
  2: 'paladin',
  3: 'hunter',
  4: 'rogue',
  5: 'priest',
  6: 'death_knight',
  7: 'shaman',
  8: 'mage',
  9: 'warlock',
  10: 'monk',
  11: 'druid',
  12: 'demon_hunter',
  13: 'evoker'
}

export function armoryClassSlug(classId?: number | null): string | null {
  return (classId && CLASS_SLUGS[classId]) || null
}

export interface ArmoryLook {
  classId?: number | null
}

/** Background candidates for a character, most specific first. */
export function armoryBackgroundCandidates(look: ArmoryLook): string[] {
  const classSlug = armoryClassSlug(look.classId)
  return classSlug ? [`${ARMORY_CDN}/profile-backgrounds/v2/armory_bg_class_${classSlug}.jpg`] : []
}

/** The Armoury itself, which is a web page rather than an API. */
const ARMORY_SITE = 'https://worldofwarcraft.blizzard.com'

/**
 * The language the journal is read in. It changes the page, not the numbers, so one is picked for every
 * read and the cache below is keyed without it.
 */
const ARMORY_LOCALE = 'en-gb'

/** How long a journal size is kept. It moves with a patch and with the faction, not with a day. */
const JOURNAL_TTL = 24 * 60 * 60 * 1000

/** The journals already read, and when each stops being served. */
const journalCache = new Map<string, { data: ArmouryJournal | null; expires: number }>()

/** The entries kept before the expired ones are swept, so the map cannot grow without end. */
const JOURNAL_CACHE_LIMIT = 500

/** How many mounts a character's own journal holds, and how many of them it has. */
export interface ArmouryJournal {
  total: number
  collected: number
}

/**
 * Reads the JSON object or array that starts at `start` in `text`.
 *
 * The Armoury ships its data inside a `<script>` block, so the payload has to be cut out of HTML - and
 * a regex cannot do it, because the strings inside hold braces and brackets of their own ("[PH] Purple
 * Cat Mount"). This walks the text and counts delimiters only outside strings, escapes included.
 */
function sliceJson(text: string, start: number): unknown {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const character = text[i]

    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }

    if (character === '"') inString = true
    else if (character === '{' || character === '[') depth++
    else if (character === '}' || character === ']') {
      depth--
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }

  return null
}

/**
 * How many mounts the journal of this character holds - the number the mount tile is measured against.
 *
 * The Armoury publishes the journal of a character as a list of every mount it could hold, each one
 * marked `collected` or not, so the length of that list is the size of the journal and the marked ones
 * are what the character has. It is a character's own number rather than a constant (it follows the
 * faction and the latest patch), which is why it is read here instead of taken from the snapshot the
 * refresh script writes - so a lookup that can reach the Armoury is measured against the journal that
 * character actually reads. The read is cached for a day and `null` when the Armoury cannot be reached,
 * which leaves the snapshot and the index to stand in.
 */
export async function armouryMountJournal(region: string, realm: string, name: string): Promise<ArmouryJournal | null> {
  const key = `${region}:${realm}:${name.toLowerCase()}`
  const now = Date.now()

  const cached = journalCache.get(key)
  if (cached && cached.expires > now) return cached.data

  const url =
    `${ARMORY_SITE}/${ARMORY_LOCALE}/character/${region}/${realm}/${encodeURIComponent(name)}/collections/mounts`

  const remember = (data: ArmouryJournal | null) => {
    if (journalCache.size >= JOURNAL_CACHE_LIMIT) {
      for (const [expiredKey, entry] of journalCache) {
        if (entry.expires <= now) journalCache.delete(expiredKey)
      }
    }
    journalCache.set(key, { data, expires: now + JOURNAL_TTL })
    return data
  }

  try {
    const page = await $fetch<string>(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; heroofazeroth.com)' },
      responseType: 'text',
      timeout: 10000
    })

    const collectedAt = page.indexOf('"mountsCollected":')
    if (collectedAt === -1) return remember(null)

    const listAt = page.indexOf('"mounts":[', collectedAt)
    if (listAt === -1) return remember(null)

    const list = sliceJson(page, page.indexOf('[', listAt))
    if (!Array.isArray(list)) return remember(null)

    return remember({
      total: list.length,
      collected: list.filter((entry: any) => entry?.collected).length
    })
  } catch {
    // A character the Armoury has not got, a page it would not serve: the caller falls back.
    return remember(null)
  }
}

const backgroundCache = new Map<string, string>()

/**
 * Resolves the class background of a character. The outcome (including "none
 * available") is cached for the lifetime of the process because the asset set
 * only changes with a new patch.
 */
export async function resolveArmoryBackground(look: ArmoryLook): Promise<string> {
  const candidates = armoryBackgroundCandidates(look)
  if (!candidates.length) return ''

  const key = candidates.join('|')
  const cached = backgroundCache.get(key)
  if (cached !== undefined) return cached

  for (const url of candidates) {
    try {
      const image = await $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' })
      if (image && image.byteLength > 0) {
        backgroundCache.set(key, url)
        return url
      }
    } catch {
      // 403/404 – try the next candidate
    }
  }

  backgroundCache.set(key, '')
  return ''
}
