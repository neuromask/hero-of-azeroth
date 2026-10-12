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

/**
 * How long a journal size is served before it is read again. It moves with a patch and with the
 * faction, not with a day.
 */
const JOURNAL_TTL = 24 * 60 * 60 * 1000

/**
 * How soon a read that produced no journal is tried again.
 *
 * A read that came back empty is nearly always the Armoury asking for a moment, or a page shape this
 * build cannot cut a journal out of - both of which pass. Ten minutes keeps the site from asking again
 * and again while still picking the journal up within the hour; the tile falls back on the snapshot for
 * exactly that while.
 */
const JOURNAL_RETRY_MS = 10 * 60 * 1000

/** How many mounts a character's own journal holds, and how many of them it has. */
export interface ArmouryJournal {
  total: number
  collected: number
}

/**
 * One character's journal as the cache holds it.
 *
 * `data` is the last size the Armoury published, `expires` the moment it stops being served and
 * `retryAt` the earliest moment a read may be attempted again.
 *
 * `data` is kept through a failed read on purpose. A journal that could not be refreshed is still the
 * last thing the Armoury said about *that* character - older than a day's freshness, but a number the
 * character really has, where the fallback is one character's journal used for everybody - so a read
 * that came back empty is not allowed to replace it with nothing. Only a successful read clears it.
 */
interface JournalEntry {
  data: ArmouryJournal | null
  expires: number
  retryAt: number
}

/** The journals already read, by character. */
const journalCache = new Map<string, JournalEntry>()

/** The entries kept before the expired ones are swept, so the map cannot grow without end. */
const JOURNAL_CACHE_LIMIT = 500

/** The reads in flight, so a burst of requests for one character is one read of the Armoury. */
const journalReads = new Map<string, Promise<void>>()

/** The key a character's journal is cached under: its three address segments, the name lowercased. */
function journalKey(region: string, realm: string, name: string): string {
  return `${region}:${realm}:${name.toLowerCase()}`
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
 * The character's journal as the site already holds it, or `null` when it holds none to serve.
 *
 * This is the read a profile is answered with, and it never touches the network: a character the site
 * has read inside the day is answered at once, and one it has not is answered with `null` - which leaves
 * `mountTotal` to stand the snapshot in (`server/utils/mounts`) while the read below fills the cache
 * behind the page.
 */
export function readMountJournal(region: string, realm: string, name: string): ArmouryJournal | null {
  const entry = journalCache.get(journalKey(region, realm, name))
  return entry && entry.expires > Date.now() ? entry.data : null
}

/**
 * Reads a character's journal if one is due, behind the request that asked for it.
 *
 * Nothing waits on this. The profile answers with what the site already holds - the journal on file
 * (`readMountJournal`), or the snapshot through `mountTotal` behind it - and the read started here fills
 * the cache for the requests that follow: the next visit, the card, the collections page, the background
 * pass, all of which read the one entry.
 *
 * Two reads for one character never run together: a read already in flight is the one handed back, so a
 * burst of requests is a burst of no Armoury reads at all. A character read inside its day is not asked
 * for, and one whose read came back empty is left alone until `JOURNAL_RETRY_MS` has passed. The promise
 * never rejects: a failed read is a stale number, not a broken page.
 */
export function refreshMountJournal(region: string, realm: string, name: string): Promise<void> {
  const key = journalKey(region, realm, name)

  const running = journalReads.get(key)
  if (running) return running

  const entry = journalCache.get(key)
  if (entry && entry.retryAt > Date.now()) return Promise.resolve()

  const read = readJournalFromArmoury(key, region, realm, name)
    .catch(() => {})
    .finally(() => {
      journalReads.delete(key)
    })

  journalReads.set(key, read)
  return read
}

/**
 * The one place a journal is fetched off the Armoury and filed.
 *
 * A read that came back with a journal is kept for the day; one that came back empty keeps whatever the
 * cache already held - so the last real number is not lost to a moment's bad luck - and is due again in
 * ten minutes. It cannot reject: its caller is a page that has already been answered.
 */
async function readJournalFromArmoury(key: string, region: string, realm: string, name: string): Promise<void> {
  const now = Date.now()
  const previous = journalCache.get(key)

  const file = (data: ArmouryJournal | null, ok: boolean): void => {
    if (journalCache.size >= JOURNAL_CACHE_LIMIT) {
      for (const [expiredKey, entry] of journalCache) {
        if (entry.retryAt <= now) journalCache.delete(expiredKey)
      }
    }

    const kept = ok ? data : previous?.data ?? null

    journalCache.set(key, {
      data: kept,
      // A journal that could not be refreshed keeps being served - it is the last thing the Armoury said
      // about this character - while a character the site has never heard from is left to the snapshot.
      expires: kept ? now + JOURNAL_TTL : previous?.expires ?? now,
      retryAt: now + (ok ? JOURNAL_TTL : JOURNAL_RETRY_MS)
    })
  }

  const url =
    `${ARMORY_SITE}/${ARMORY_LOCALE}/character/${region}/${realm}/${encodeURIComponent(name)}/collections/mounts`

  try {
    const page = await $fetch<string>(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; heroofazeroth.com)' },
      responseType: 'text',
      timeout: 10000
    })

    const collectedAt = page.indexOf('"mountsCollected":')
    if (collectedAt === -1) return file(null, false)

    const listAt = page.indexOf('"mounts":[', collectedAt)
    if (listAt === -1) return file(null, false)

    const list = sliceJson(page, page.indexOf('[', listAt))
    if (!Array.isArray(list)) return file(null, false)

    file({ total: list.length, collected: list.filter((entry: any) => entry?.collected).length }, true)
  } catch {
    // A character the Armoury has not got, a page it would not serve: the cache keeps what it had.
    file(null, false)
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
