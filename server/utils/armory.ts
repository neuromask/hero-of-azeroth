/**
 * Helpers for the background artwork used by the official WoW Armoury.
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
