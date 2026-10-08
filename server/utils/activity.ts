/**
 * The activity feed behind a character page: the achievements it earned most recently,
 * read from Blizzard's own profile endpoint.
 *
 * `/profile/wow/character/{realm}/{name}/achievements` answers with every achievement the
 * character holds and the moment each was completed, so the feed is the tail of that list -
 * sorted by `completed_timestamp`, newest first. The endpoint carries a name and a timestamp
 * per achievement but none of the rest, so each of the picked achievements is looked up once
 * more for what a card shows: its description, its points, its category (which decides the
 * glow) and its icon.
 *
 * That second half is static game data that only moves with a patch, so it is not read here at
 * all where it can be helped: the catalogue shipped beside this file holds it for every
 * achievement in the game, and the feed is built from it without a single call (`see
 * `achievement-meta.json` and `scripts/refresh-achievement-meta.mjs`). What is left for Blizzard
 * per request is the character's own list. The feed is a hundred cards, and a hundred cards read
 * one id at a time would be two hundred calls - which is both the waiting and the 429 that costs
 * a card its icon - so a read the catalogue cannot answer is bounded and retried. The feed itself
 * is what changes person to person, and it is the endpoint that keeps it (see the route).
 */
import { getBlizzardToken } from './blizzard'
import { activityAccent, activityType } from '#shared/utils/activity'
import type { ActivityFeed, ActivityItem } from '#shared/utils/activity'
import catalog from './achievement-meta.json'

/**
 * How many of the newest achievements the feed shows.
 *
 * A hundred is the length of a timeline worth scrolling rather than a limit Blizzard imposes: the
 * profile read carries every achievement the character holds in any case, so the number only decides
 * how many cards are drawn from it, and the hundredth is as cheap as the first (see the catalogue).
 */
const FEED_SIZE = 100

/**
 * How long an achievement's static half is kept, in milliseconds.
 *
 * A name, a description, a point value, a category and an icon URL change when a patch ships
 * and at no other time, so a day is both generous and safe: the worst a stale entry can do is
 * show yesterday's wording until the cache rolls over. Only the achievements the catalogue
 * could not answer are kept here - the ones a patch shipped after the last refresh.
 */
const META_TTL_MS = 24 * 60 * 60 * 1000

/** How many achievements' metadata are kept before the oldest is dropped. */
const META_LIMIT = 4000

/**
 * How many achievements are read from Blizzard at once, and how often a throttled read is retried.
 *
 * A feed is a burst by nature: on the first read of a patch, every card is an id the catalogue does
 * not know. Firing all of them at once is answered with 429s - which arrive on the icon rather than
 * on the detail, so a card comes back half-dressed - while a handful at a time comes back clean and
 * sooner. The same reason Blizzard is throttled at all is the reason this is not a `Promise.all`.
 */
const META_CONCURRENCY = 8
const META_ATTEMPTS = 4

/** The static half of an achievement: everything about it that a patch could not change today. */
interface AchievementMeta {
  name: string
  description: string
  points: number
  category: string
  categoryId: number
  icon: string
}

/** One achievement as the catalogue stores it: the static half, in both of the site's languages. */
interface CatalogAchievement {
  en: string
  ru: string
  desc: string
  descRu: string
  points: number
  category: number
  icon: string
}

/** The catalogue as it is shipped: the achievements, and the name of each category they sit in. */
const CATALOG = catalog as unknown as {
  categories?: Record<string, { en: string; ru: string }>
  items?: Record<string, CatalogAchievement>
}

/** Blizzard's own 2D icon CDN, which serves a sprite by the file name the catalogue stores. */
const BLIZZARD_ICONS = 'https://render.worldofwarcraft.com'

/**
 * The size of the sprite an achievement's icon is asked for.
 *
 * Blizzard's media endpoint answers with the 56px copy, which is the one the card's frame draws and
 * the one collections are drawn from too, so an address built from a file name is the address that
 * endpoint would have handed over - without the call.
 */
const BLIZZARD_ICON_SIZE = 56

/** The address of an achievement's icon, built from its file name and the region being read. */
function achievementIcon(region: string, name: string): string {
  return name ? `${BLIZZARD_ICONS}/${region}/icons/${BLIZZARD_ICON_SIZE}/${name}.jpg` : ''
}

/**
 * The static half of an achievement as the catalogue has it, or null when it does not carry it.
 *
 * A miss is expected rather than a failure: a patch ships achievements the last refresh never saw, and
 * those are read from Blizzard instead. The category travels as an id alone, so its name comes from
 * the catalogue's own map - the same name the card prints, in the language being read.
 */
function catalogAchievement(region: string, locale: string, id: number): AchievementMeta | null {
  const entry = CATALOG.items?.[id]
  if (!entry) return null

  const russian = locale.startsWith('ru')
  const categoryNames = CATALOG.categories?.[entry.category]

  return {
    name: russian ? entry.ru || entry.en : entry.en || entry.ru,
    description: russian ? entry.descRu || entry.desc : entry.desc || entry.descRu,
    points: entry.points || 0,
    category: categoryNames
      ? russian
        ? categoryNames.ru || categoryNames.en
        : categoryNames.en || categoryNames.ru
      : '',
    categoryId: entry.category || 0,
    icon: achievementIcon(region, entry.icon)
  }
}

const metaCache = new Map<string, { value: AchievementMeta; at: number }>()
const metaInflight = new Map<string, Promise<AchievementMeta>>()

/** A pause that lengthens with each attempt, so a retry backs off rather than hammers a limiter. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One static document, retried while Blizzard is throttling (429) or briefly unhappy, or null when it
 * never came.
 *
 * A read that has run out of attempts is `null` rather than a failure: the card it belongs to is then
 * drawn from what the profile list already knew - the name and the moment, without an icon - instead
 * of the whole feed failing over one lookup.
 */
async function fetchStatic(url: string, headers: Record<string, string>, attempt = 0): Promise<any> {
  const response = await $fetch.raw<any>(url, { headers, ignoreResponseError: true }).catch(() => null)
  // A status of 0 is a call that never landed at all; 429 and 5xx are Blizzard asking for a moment.
  const status = response?.status || 0

  if ((status === 0 || status === 429 || status >= 500) && attempt < META_ATTEMPTS) {
    await sleep(250 * (attempt + 1))
    return fetchStatic(url, headers, attempt + 1)
  }

  return status === 200 ? response?._data ?? null : null
}

/**
 * Reads one achievement's static half - its detail and its icon - and keeps it for a day.
 *
 * Three answers are tried in the order of what they cost: what this process has already read, the
 * catalogue the build shipped, and Blizzard. The first two are map lookups, which is what makes a
 * hundred cards as cheap to describe as one; only an achievement the catalogue does not carry - one a
 * patch shipped after the last refresh - reaches the third. Two callers that ask for the same
 * achievement at once share the one read there, and the entry is written and the in-flight marker
 * dropped on the promise the callers await, so by the time a value is handed back the marker is
 * already gone (the same rule `swrCache.ts` follows).
 */
async function fetchAchievementMeta(
  region: string,
  locale: string,
  id: number,
  headers: Record<string, string>
): Promise<AchievementMeta> {
  const key = `${region}:${locale}:${id}`
  const cached = metaCache.get(key)
  if (cached && Date.now() - cached.at < META_TTL_MS) return cached.value

  const shipped = catalogAchievement(region, locale, id)
  if (shipped) return shipped

  const running = metaInflight.get(key)
  if (running) return running

  const load = (async () => {
    const ns = `namespace=static-${region}&locale=${locale}`
    const [d, m] = await Promise.all([
      fetchStatic(`https://${region}.api.blizzard.com/data/wow/achievement/${id}?${ns}`, headers),
      fetchStatic(`https://${region}.api.blizzard.com/data/wow/media/achievement/${id}?${ns}`, headers)
    ])

    const value: AchievementMeta = {
      name: d?.name || '',
      description: d?.description || '',
      points: typeof d?.points === 'number' ? d.points : 0,
      category: d?.category?.name || '',
      categoryId: d?.category?.id || 0,
      icon: (m?.assets || []).find((asset: any) => asset?.key === 'icon')?.value || ''
    }

    // Re-setting a key moves it to the end of the map, so the front is the oldest entry and
    // the one the cap drops.
    metaCache.delete(key)
    metaCache.set(key, { value, at: Date.now() })
    if (metaCache.size > META_LIMIT) {
      const oldest = metaCache.keys().next().value
      if (oldest !== undefined) metaCache.delete(oldest)
    }

    return value
  })().finally(() => {
    metaInflight.delete(key)
  })

  metaInflight.set(key, load)
  return load
}

/**
 * Runs `worker` over `items`, a few at a time, keeping the answers in their own order.
 *
 * The feed is newest first and that order is the whole point of it, so each answer is put back at the
 * index it came from rather than collected as it lands (the catalogue is looked up synchronously, so
 * the queue is only ever filled with the reads Blizzard has to answer).
 */
async function pool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      let index = next++
      while (index < items.length) {
        results[index] = await worker(items[index]!)
        index = next++
      }
    })
  )

  return results
}

/**
 * Builds the activity feed of a character: the achievements it earned most recently, each
 * with what a card needs to show it.
 */
export async function getAchievementFeed(
  realm: string,
  name: string,
  region: string,
  locale = 'en_US'
): Promise<ActivityFeed> {
  const token = await getBlizzardToken(region)
  const headers = { Authorization: `Bearer ${token}` }
  const baseUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}`
  const ns = `namespace=profile-${region}&locale=${locale}`

  const data = await $fetch<any>(`${baseUrl}/achievements?${ns}`, { headers })

  // Newest first, and only the ones that carry a moment: an achievement without a
  // `completed_timestamp` has not been earned, and there is nothing to place on the timeline.
  const recent = (data?.achievements || [])
    .filter((entry: any) => entry?.completed_timestamp)
    .sort((a: any, b: any) => b.completed_timestamp - a.completed_timestamp)
    .slice(0, FEED_SIZE)

  const items: ActivityItem[] = await pool(
    recent,
    META_CONCURRENCY,
    async (entry: any): Promise<ActivityItem> => {
      const id = entry.id
      // A single missing lookup must not empty the feed, so it degrades to what the profile
      // list already knew: the name and the moment, with no icon or points to show.
      const meta = await fetchAchievementMeta(region, locale, id, headers).catch(() => null)

      return {
        id,
        name: meta?.name || entry?.achievement?.name || '',
        description: meta?.description || '',
        points: meta?.points || 0,
        icon: meta?.icon || '',
        completedAt: entry.completed_timestamp,
        category: meta?.category || '',
        categoryId: meta?.categoryId || 0,
        type: activityType(meta?.category || '', meta?.name || ''),
        accent: activityAccent(meta?.categoryId || 0, meta?.category || '')
      }
    }
  )

  return {
    totalPoints: data?.total_points || 0,
    totalQuantity: data?.total_quantity || 0,
    items,
    generatedAt: Date.now()
  }
}