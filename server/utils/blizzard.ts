import { resolveArmoryBackground } from './armory'
import { ACHIEVEMENT_POINTS_TOTAL } from './achievements'

let cachedToken: { access_token: string; expires_at: number } | null = null

export async function getBlizzardToken(region = 'eu') {
  const config = useRuntimeConfig()
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expires_at > now + 60) {
    return cachedToken.access_token
  }

  const credentials = Buffer.from(`${config.blizzardClientId}:${config.blizzardClientSecret}`).toString('base64')

  const response = await $fetch<{ access_token: string; expires_in: number }>(`https://${region}.battle.net/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  })

  cachedToken = {
    access_token: response.access_token,
    expires_at: now + response.expires_in
  }

  return response.access_token
}

export interface CollectionTotals {
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
}

let cachedTotals: { data: CollectionTotals; expires_at: number } | null = null

export async function getCollectionTotals(region = 'eu', token?: string): Promise<CollectionTotals> {
  const now = Math.floor(Date.now() / 1000)

  if (cachedTotals && cachedTotals.expires_at > now) {
    return cachedTotals.data
  }

  const accessToken = token || (await getBlizzardToken(region))
  const headers = { Authorization: `Bearer ${accessToken}` }
  const namespace = `namespace=static-${region}`

  const [mounts, pets, toys, decor, reputations] = await Promise.all([
    $fetch<any>(`https://${region}.api.blizzard.com/data/wow/mount/index?${namespace}`, { headers }),
    $fetch<any>(`https://${region}.api.blizzard.com/data/wow/pet/index?${namespace}`, { headers }),
    $fetch<any>(`https://${region}.api.blizzard.com/data/wow/toy/index?${namespace}`, { headers }),
    $fetch<any>(`https://${region}.api.blizzard.com/data/wow/decor/index?${namespace}`, { headers }),
    $fetch<any>(`https://${region}.api.blizzard.com/data/wow/reputation-faction/index?${namespace}`, { headers })
  ])

  const data: CollectionTotals = {
    mounts: mounts.mounts?.length || 0,
    pets: pets.pets?.length || 0,
    toys: toys.toys?.length || 0,
    decor: decor.decor_items?.length || 0,
    reputations: reputations.factions?.length || 0
  }

  cachedTotals = { data, expires_at: now + 60 * 60 * 24 }

  return data
}

export interface Realm {
  slug: string
  name: string
}

const cachedRealms = new Map<string, { data: Realm[]; expires_at: number }>()

export async function getRealms(region = 'eu', locale = 'en_US'): Promise<Realm[]> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = `${region}:${locale}`
  const cached = cachedRealms.get(cacheKey)

  if (cached && cached.expires_at > now) {
    return cached.data
  }

  const token = await getBlizzardToken(region)
  const data = await $fetch<any>(
    `https://${region}.api.blizzard.com/data/wow/realm/index?namespace=dynamic-${region}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  const realms: Realm[] = (data.realms || [])
    .map((r: any) => ({
      slug: r.slug,
      name: typeof r.name === 'string'
        ? r.name
        : (r.name?.[locale] || r.name?.en_US || r.name?.ru_RU || r.slug)
    }))
    .sort((a: Realm, b: Realm) => a.name.localeCompare(b.name, 'en'))

  cachedRealms.set(cacheKey, { data: realms, expires_at: now + 60 * 60 * 24 })

  return realms
}

export interface CharacterStat {
  count: number
  total: number
}

export interface CharacterData {
  name: string
  title: string
  level: number
  race: string
  class: string
  spec: string
  guild: string
  realm: string
  faction: string
  ap: number
  ilvl: number
  mPlusScore: number
  renderUrl: string
  classId: number
  raceId: number
  gender: string
  /** Armoury class artwork used as the background ('' when unavailable). */
  backgroundUrl: string
  stats: {
    mounts: CharacterStat
    pets: CharacterStat
    toys: CharacterStat
    decor: CharacterStat
    reputations: CharacterStat
    achievements: CharacterStat
  }
}

const CHARACTER_DEFAULT_TOTALS = { mounts: 1676, pets: 2179, toys: 1135, decor: 2131, reputations: 284 }

/** Regions we query, in the order they are tried when none is given. */
const FALLBACK_REGIONS = ['eu', 'us']

/**
 * A character that shares the account with the one being viewed, listed in
 * `NUXT_WARBAND_CHARACTERS` as `region/realm/name`.
 */
interface WarbandMember {
  region: string
  realm: string
  name: string
}

/** Mount ids and Exalted reputation ids collected by an account. */
interface WarbandUnion {
  mounts: Set<number>
  exalted: Set<number>
}

const cachedWarband = new Map<string, { data: WarbandUnion; expires_at: number }>()

/**
 * The account's own characters, from the `NUXT_WARBAND_CHARACTERS` environment
 * variable (comma separated `region/realm/name`, e.g.
 * `eu/gordunni/neromask,eu/eversong/altmask`).
 */
function warbandMembers(): WarbandMember[] {
  const raw = String(useRuntimeConfig().warbandCharacters || '')

  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .map((entry) => entry.split('/'))
    .filter((parts) => parts.length === 3 && parts.every(Boolean))
    .map(([region, realm, name]) => ({ region, realm, name }))
}

/** Whether the character being viewed belongs to the configured warband. */
function isWarbandMember(region: string, realm: string, name: string): boolean {
  return warbandMembers().some(
    (member) => member.region === region && member.realm === realm && member.name === name
  )
}

/**
 * Mounts and reputations are the only two collections Blizzard still reports per
 * character rather than per account: measured on one account, its characters come
 * back with 1201 to 1214 mounts and 82 to 195 reputations each, while toys, decor
 * and pets are identical for all of them. The mount journal and the reputation tab
 * in the game are account-wide, so a single character under-reports the warband.
 *
 * Blizzard's account-wide equivalents (`/profile/user/wow/collections/mounts`)
 * answer 403 to a client-credentials token and need a user OAuth login, which a
 * public page cannot have. The account's characters are therefore listed in
 * `NUXT_WARBAND_CHARACTERS` and merged, which reproduces the journal exactly (the
 * same account measures 1214 mounts on its main against 1263 for the warband).
 */
const EXALTED_NAMES = new Set(['Exalted', 'Превознесение'])

/** "Exalted" is tier 7; the name is a fallback for factions that report no tier. */
function isExalted(standing: any): boolean {
  return standing?.tier === 7 || EXALTED_NAMES.has(standing?.name)
}

/** Mount ids and Exalted faction ids of one character, or empty sets on failure. */
async function getMemberCollectionIds(member: WarbandMember, token: string) {
  const headers = { Authorization: `Bearer ${token}` }
  const ns = `namespace=profile-${member.region}&locale=en_US`
  const base = `https://${member.region}.api.blizzard.com/profile/wow/character/${member.realm}/${encodeURIComponent(member.name)}`

  try {
    const [mounts, reps] = await Promise.all([
      $fetch<any>(`${base}/collections/mounts?${ns}`, { headers }),
      $fetch<any>(`${base}/reputations?${ns}`, { headers })
    ])

    return {
      mounts: (mounts?.mounts || []).map((mount: any) => mount.mount?.id).filter(Boolean) as number[],
      exalted: (reps?.reputations || [])
        .filter((rep: any) => isExalted(rep.standing))
        .map((rep: any) => rep.faction?.id)
        .filter(Boolean) as number[]
    }
  } catch {
    // A character that was deleted or moved must not take the whole warband down.
    return { mounts: [] as number[], exalted: [] as number[] }
  }
}

/**
 * Merges the warband's characters of one region. Cached, because reading a mount
 * journal of ~1300 entries per character is a lot of API calls for a page view.
 */
async function getWarbandUnion(region: string, token: string): Promise<WarbandUnion> {
  const now = Math.floor(Date.now() / 1000)
  const cached = cachedWarband.get(region)

  if (cached && cached.expires_at > now) {
    return cached.data
  }

  const members = warbandMembers().filter((member) => member.region === region)
  const collected = await Promise.all(members.map((member) => getMemberCollectionIds(member, token)))

  const data: WarbandUnion = { mounts: new Set(), exalted: new Set() }

  for (const ids of collected) {
    for (const id of ids.mounts) data.mounts.add(id)
    for (const id of ids.exalted) data.exalted.add(id)
  }

  cachedWarband.set(region, { data, expires_at: now + 6 * 60 * 60 })

  return data
}

/**
 * Loads a character from a single region. Throws a 404 when the character does
 * not exist in that region.
 */
async function fetchCharacterProfile(realm: string, name: string, region: string, locale: string): Promise<CharacterData> {
  const token = await getBlizzardToken(region)
  const headers = { Authorization: `Bearer ${token}` }
  const baseUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}`
  const ns = `namespace=profile-${region}&locale=${locale}`

  const [summary, media, mounts, pets, toys, decor, reps, mplus, totals] = await Promise.allSettled([
    $fetch<any>(`${baseUrl}?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/character-media?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/mounts?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/pets?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/toys?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/decor?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/reputations?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/mythic-keystone-profile?${ns}`, { headers }),
    getCollectionTotals(region, token)
  ])

  if (summary.status === 'rejected') {
    throw createError({ statusCode: 404, statusMessage: 'Character not found' })
  }

  const charData = summary.value
  const mediaData = media.status === 'fulfilled' ? media.value : null
  const mountsData = mounts.status === 'fulfilled' ? mounts.value : null
  const petsData = pets.status === 'fulfilled' ? pets.value : null
  const toysData = toys.status === 'fulfilled' ? toys.value : null
  const decorData = decor.status === 'fulfilled' ? decor.value : null
  const repsData = reps.status === 'fulfilled' ? reps.value : null
  const mplusData = mplus.status === 'fulfilled' ? mplus.value : null
  const totalsData = totals.status === 'fulfilled' && totals.value ? totals.value : CHARACTER_DEFAULT_TOTALS

  const rawAssets = mediaData?.assets || []
  const mainRaw = rawAssets.find((a: any) => a.key === 'main-raw')?.value
  const mainRender = rawAssets.find((a: any) => a.key === 'main')?.value || rawAssets[0]?.value

  /**
   * Pets are account-wide by definition, and toys and decor come back identical for
   * every character of the same account, so those three are reported as they
   * arrive. The pet list contains one entry per caged pet, so the same species can
   * appear several times, and the count is de-duplicated to stay comparable with
   * the journal total.
   */
  const collectedSpecies = new Set<number>(
    (petsData?.pets || []).map((pet: any) => pet.species?.id ?? pet.id).filter(Boolean)
  )

  /**
   * Mounts and reputations do arrive per character, so when the character belongs
   * to the configured warband the rest of the account is merged in (see
   * `getWarbandUnion`) and the character's own collection is always part of the
   * result. The game shows the account-wide journal and reputation tab, which is
   * what these two tiles are meant to mirror.
   */
  let mountIds = new Set<number>(
    (mountsData?.mounts || []).map((mount: any) => mount.mount?.id).filter(Boolean)
  )
  let exaltedIds = new Set<number>(
    (repsData?.reputations || [])
      .filter((rep: any) => isExalted(rep.standing))
      .map((rep: any) => rep.faction?.id)
      .filter(Boolean)
  )

  if (isWarbandMember(region, realm, name)) {
    const warband = await getWarbandUnion(region, token)

    mountIds = new Set([...warband.mounts, ...mountIds])
    exaltedIds = new Set([...warband.exalted, ...exaltedIds])
  }

  const mPlusScore = mplusData?.current_mythic_rating?.rating
    ? Math.round(mplusData.current_mythic_rating.rating)
    : 0

  const achievementPoints = charData.achievement_points || 0

  const backgroundUrl = await resolveArmoryBackground({
    classId: charData.character_class?.id
  }).catch(() => '')

  return {
    name: charData.name,
    title: charData.active_title?.display_string?.replace('{name}', charData.name) || '',
    level: charData.level,
    race: charData.race?.name || '',
    class: charData.character_class?.name || '',
    spec: charData.active_spec?.name || '',
    guild: charData.guild?.name || '',
    realm: charData.realm?.name || realm,
    faction: charData.faction?.type || 'NEUTRAL',
    ap: achievementPoints,
    ilvl: charData.average_item_level || charData.equipped_item_level || 0,
    mPlusScore,
    renderUrl: mainRaw || mainRender || '',
    classId: charData.character_class?.id || 0,
    raceId: charData.race?.id || 0,
    gender: charData.gender?.type || '',
    backgroundUrl,
    stats: {
      mounts: { count: mountIds.size, total: totalsData.mounts },
      pets: { count: collectedSpecies.size, total: totalsData.pets },
      toys: { count: toysData?.toys?.length || 0, total: totalsData.toys },
      decor: { count: decorData?.decor_collected?.length || 0, total: totalsData.decor },
      reputations: { count: exaltedIds.size, total: totalsData.reputations },
      achievements: { count: achievementPoints, total: ACHIEVEMENT_POINTS_TOTAL }
    }
  }
}

/**
 * Loads a character, optionally from a specific region. When no region is given
 * every known region is tried in turn, so deep links such as
 * /en/tichondrius/mychar work without an explicit ?region= parameter.
 */
export async function getCharacter(realm: string, name: string, region?: string, locale = 'ru_RU'): Promise<CharacterData> {
  const regions = region ? [region] : FALLBACK_REGIONS
  let lastError: any = null

  for (const candidate of regions) {
    try {
      return await fetchCharacterProfile(realm, name, candidate, locale)
    } catch (err: any) {
      const status = err?.statusCode || err?.status || err?.response?.status
      if (status !== 404) throw err
      lastError = err
    }
  }

  throw lastError || createError({ statusCode: 404, statusMessage: 'Character not found' })
}