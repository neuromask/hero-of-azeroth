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
 * That second read is static game data that only moves with a patch, so it is cached for a
 * day and shared between characters: the twentieth person to open an activity feed pays for
 * the icons the first one warmed up rather than for twenty more lookups. The feed itself is
 * what changes person to person, and it is the endpoint that keeps it (see the route).
 */
import { getBlizzardToken } from './blizzard'
import { activityAccent } from '#shared/utils/activity'
import type { ActivityFeed, ActivityItem } from '#shared/utils/activity'

/** How many of the newest achievements the feed shows. */
const FEED_SIZE = 20

/**
 * How long an achievement's static half is kept, in milliseconds.
 *
 * A name, a description, a point value, a category and an icon URL change when a patch ships
 * and at no other time, so a day is both generous and safe: the worst a stale entry can do is
 * show yesterday's wording until the cache rolls over.
 */
const META_TTL_MS = 24 * 60 * 60 * 1000

/** How many achievements' metadata are kept before the oldest is dropped. */
const META_LIMIT = 4000

/** The static half of an achievement: everything about it that a patch could not change today. */
interface AchievementMeta {
  name: string
  description: string
  points: number
  category: string
  categoryId: number
  icon: string
}

const metaCache = new Map<string, { value: AchievementMeta; at: number }>()
const metaInflight = new Map<string, Promise<AchievementMeta>>()

/**
 * Reads one achievement's static half - its detail and its icon - and keeps it for a day.
 *
 * Two callers that ask for the same achievement at once share the one read, and the entry is
 * written and the in-flight marker dropped on the promise the callers await, so by the time a
 * value is handed back the marker is already gone (the same rule `swrCache.ts` follows).
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

  const running = metaInflight.get(key)
  if (running) return running

  const load = (async () => {
    const ns = `namespace=static-${region}&locale=${locale}`
    const [detail, media] = await Promise.allSettled([
      $fetch<any>(`https://${region}.api.blizzard.com/data/wow/achievement/${id}?${ns}`, { headers }),
      $fetch<any>(`https://${region}.api.blizzard.com/data/wow/media/achievement/${id}?${ns}`, { headers })
    ])

    const d = detail.status === 'fulfilled' ? detail.value : null
    const m = media.status === 'fulfilled' ? media.value : null

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

  const items: ActivityItem[] = await Promise.all(
    recent.map(async (entry: any): Promise<ActivityItem> => {
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
        accent: activityAccent(meta?.categoryId || 0, meta?.category || '')
      }
    })
  )

  return {
    totalPoints: data?.total_points || 0,
    totalQuantity: data?.total_quantity || 0,
    items,
    generatedAt: Date.now()
  }
}