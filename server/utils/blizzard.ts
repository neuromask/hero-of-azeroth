import { armouryMountJournal, resolveArmoryBackground } from './armory'
import { ACHIEVEMENT_POINTS_TOTAL } from './achievements'
import { isExalted, isReputationMaxed, reputationTotal } from './reputations'
import { mountTotal } from './mounts'

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

/**
 * A realm a player can pick, told apart from the rest of Blizzard's realm index.
 *
 * The index is not only the realms: it also carries the shards behind them and the
 * realms that exist for a development build or an event. Those are named after the
 * hardware or after what they are for - `eu5b2inst`, `us1a-account-realm`, `eu7abgru`,
 * `rdb-eu`, `eu-arena-pass-csbg`, `eu-auxiliary-70` - while a playable realm is named
 * after the place it stands for. The distinction is the shard number: a region code
 * directly followed by a digit is a machine, and no playable realm is named like that
 * (`Area 52` is the only one with a digit at all, and it is not the second character).
 * The handful that are not numbered are the development host and the event realms.
 */
const REALM_SHARD = /^(eu|us|au|kr|tw|cn)\d/i
const REALM_SPECIAL = /^rdb-|arena-pass|auxiliary/i

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

  // The filter runs on the raw entries, so a shard never reaches the cache and no
  // answer built on the list - the combobox, its search - has to know about them.
  const realms: Realm[] = (data.realms || [])
    .filter(
      (r: any) =>
        r?.slug && !REALM_SHARD.test(r.slug) && !REALM_SPECIAL.test(r.slug)
    )
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

/**
 * The reputation tile is the one number that has two possible sources, so it also says
 * which one it used: the account-wide counter when Blizzard reports it, the character's
 * own factions when it does not. The page prints its note from this.
 */
export interface ReputationStat extends CharacterStat {
  accountWide: boolean
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
  /**
   * Blizzard's own square portrait of the character (`-avatar.jpg`, a few kilobytes), which the
   * leaderboard draws beside a name. Empty when the media call came back without one.
   */
  avatarUrl: string
  classId: number
  raceId: number
  gender: string
  /** Armoury class artwork used as the background ('' when unavailable). */
  backgroundUrl: string
  /**
   * Whether the figures below came from the account's own pool (`server/utils/accountPool`) rather
   * than from Blizzard's per-character reading. It is set when a profile is served, so a page can
   * say which of its numbers are the account's and which are still the character's own.
   */
  pooled?: boolean
  stats: {
    mounts: CharacterStat
    pets: CharacterStat
    toys: CharacterStat
    decor: CharacterStat
    reputations: ReputationStat
    achievements: CharacterStat
  }
}

/**
 * The total to fall back on when a static index cannot be read.
 *
 * Held for all five tiles so a Blizzard outage cannot blank the bars. The mount and
 * achievement denominators rarely come from here: `mountTotal` and
 * `ACHIEVEMENT_POINTS_TOTAL` replace them with what a character can actually reach, which
 * the indexes overstate - see `server/utils/mounts.ts` and `server/utils/achievements.ts`.
 */
const CHARACTER_DEFAULT_TOTALS = { mounts: 1676, pets: 2179, toys: 1135, decor: 2131, reputations: 284 }

/** Regions we query, in the order they are tried when none is given. */
const FALLBACK_REGIONS = ['eu', 'us']

/**
 * Blizzard reports mounts and reputations per character: measured on one account, its
 * characters come back with 1201 to 1214 mounts and 82 to 195 reputations each, while
 * toys, decor and pets are identical for all of them. The mount tile therefore reports
 * the character the way the API returns it, and the reputation tile does the same
 * whenever the counters below are out of reach.
 *
 * The account-wide equivalents (`/profile/user/wow/collections/mounts`) answer 403 to a
 * client-credentials token and need a user OAuth login, which a public page cannot have,
 * so the account's own journal cannot be read from here. The one account-wide number
 * that is reachable rides along with the character's achievements - see
 * `getAccountExaltedCount`.
 */

/**
 * Achievements are account-wide, and the "5 Exalted Reputations" ... "110 Exalted
 * Reputations" family carries the account's live number of Exalted factions in the
 * `amount` of its criterion. That is the counter the game's own achievement pane shows
 * and the one players compare against other sites, so it is the base of what the tile
 * reports. It counts every character of the account, which makes it run ahead of this
 * character's own reputation list by however many factions the account's other characters
 * brought to Exalted - 129 against 105 on the account this was measured on. Ladders that
 * have no Exalted tier at all - a renown faction, a delve companion, the brokers of
 * K'aresh - are missing from it, and `isReputationMaxed` catches those on top.
 */
const EXALTED_REPUTATIONS = /exalted reputations/i

/** The counter moves a few times per character lifetime, so a read is worth keeping. */
const EXALTED_COUNT_SECONDS = 60 * 30

const cachedExaltedCounts = new Map<string, { count: number; expires_at: number }>()

/**
 * Reads the account-wide Exalted Reputations counter, or null when the achievement list
 * does not come back - the caller then falls back to the character's own factions. The
 * list is by far the largest document a page fetches (about 2 MB), so the answer is kept
 * per character for `EXALTED_COUNT_SECONDS`.
 */
async function getAccountExaltedCount(baseUrl: string, headers: Record<string, string>, ns: string): Promise<number | null> {
  const now = Math.floor(Date.now() / 1000)
  const cached = cachedExaltedCounts.get(baseUrl)

  if (cached && cached.expires_at > now) {
    return cached.count
  }

  try {
    const data = await $fetch<any>(`${baseUrl}/achievements?${ns}`, { headers })
    const amounts: number[] = []

    // The counters sit in the criterion of each threshold achievement, and the tree nests
    // them under `achievements` in leaves and under `categories`/`child_categories` above.
    const visit = (node: any) => {
      for (const entry of node?.achievements || []) {
        const amount = entry?.criteria?.amount

        if (typeof amount === 'number' && EXALTED_REPUTATIONS.test(entry?.achievement?.name || '')) {
          amounts.push(amount)
        }
      }

      for (const child of node?.categories || []) visit(child)
      for (const child of node?.child_categories || []) visit(child)
    }

    visit(data)

    if (!amounts.length) {
      return null
    }

    // Every threshold reports the same live number, so any of them answers the question.
    const count = Math.max(...amounts)
    cachedExaltedCounts.set(baseUrl, { count, expires_at: now + EXALTED_COUNT_SECONDS })

    return count
  } catch {
    return null
  }
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

  const [summary, media, mounts, pets, toys, decor, reps, mplus, totals, accountExalted] = await Promise.allSettled([
    $fetch<any>(`${baseUrl}?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/character-media?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/mounts?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/pets?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/toys?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/collections/decor?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/reputations?${ns}`, { headers }),
    $fetch<any>(`${baseUrl}/mythic-keystone-profile?${ns}`, { headers }),
    getCollectionTotals(region, token),
    getAccountExaltedCount(baseUrl, headers, ns)
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
  const accountExaltedCount = accountExalted.status === 'fulfilled' ? accountExalted.value : null

  const rawAssets = mediaData?.assets || []
  const mainRaw = rawAssets.find((a: any) => a.key === 'main-raw')?.value
  const mainRender = rawAssets.find((a: any) => a.key === 'main')?.value || rawAssets[0]?.value
  // The square portrait, which is what a table of names can afford to load - the render above is
  // a full-body PNG of a few hundred kilobytes.
  const avatarAsset = rawAssets.find((a: any) => a.key === 'avatar')?.value

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
   * Mounts arrive per character, so that tile reports the character exactly as Blizzard
   * returns it. Reputations are counted in two parts, see the tile below.
   */
  const mountIds = new Set<number>(
    (mountsData?.mounts || []).map((mount: any) => mount.mount?.id).filter(Boolean)
  )

  /**
   * The reputations this character has driven to the top of their own ladder: the Exalted
   * ones, the renown factions at their last renown level, the delve companions at their
   * last level, the brokers of K'aresh at Mastermind. The Exalted ones are already inside
   * the account-wide counter the achievements carry, so only the rest are added to it.
   */
  const maxedReputations = (repsData?.reputations || [])
    .filter((rep: any) => isReputationMaxed(rep.faction?.id, rep.standing))
  const maxedBeyondExalted = maxedReputations.filter((rep: any) => !isExalted(rep.standing)).length

  const mPlusScore = mplusData?.current_mythic_rating?.rating
    ? Math.round(mplusData.current_mythic_rating.rating)
    : 0

  const achievementPoints = charData.achievement_points || 0

  const backgroundUrl = await resolveArmoryBackground({
    classId: charData.character_class?.id
  }).catch(() => '')

  // The journal a character's mounts are measured against is its own - it follows the faction and the
  // patch, not the index - so it is read for the character being looked at and kept for a day (see
  // `mountTotal`). A process that cannot reach the Armoury falls back on the snapshot, and a checkout
  // that has none on Blizzard's index.
  const mountJournal = await armouryMountJournal(region, realm, name)

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
    avatarUrl: avatarAsset || '',
    classId: charData.character_class?.id || 0,
    raceId: charData.race?.id || 0,
    gender: charData.gender?.type || '',
    backgroundUrl,
    stats: {
      mounts: { count: mountIds.size, total: mountTotal(mountJournal?.total, totalsData.mounts, mountIds.size) },
      pets: { count: collectedSpecies.size, total: totalsData.pets },
      toys: { count: toysData?.toys?.length || 0, total: totalsData.toys },
      decor: { count: decorData?.decor_collected?.length || 0, total: totalsData.decor },
      reputations: {
        // The account-wide Exalted counter plus the ladders of this character that have no
        // Exalted tier; without the counter, what this character has maxed on its own.
        count: accountExaltedCount === null
          ? maxedReputations.length
          : accountExaltedCount + maxedBeyondExalted,
        // What a character of this faction can reach: Blizzard's index minus the other
        // side's factions and minus the entries that only group the rest.
        total: reputationTotal(charData.faction?.type || 'NEUTRAL', totalsData.reputations, repsData?.reputations?.length || 0),
        accountWide: accountExaltedCount !== null
      },
      achievements: { count: achievementPoints, total: ACHIEVEMENT_POINTS_TOTAL }
    }
  }
}

/**
 * How long a character that has been read is served from memory, in seconds.
 *
 * A page and its `og:image` are two requests for one character, and they arrive together or one
 * after the other - a crawler reads the page, then the picture the page points at. Without this
 * the second of them pays for the whole Blizzard read again: ten profile calls, the character's
 * 2 MB achievement document among them, in sequence, on the way to a preview that a chat network
 * is already losing patience with. Ten minutes covers the pair comfortably, keeps an outdated
 * item level off the card for no longer than that, and is deliberately the same span the rendered
 * card is kept for, so the two expire together.
 */
const CHARACTER_CACHE_SECONDS = 10 * 60

/** Characters already read, and when each of them stops being served. */
const cachedCharacters = new Map<string, { data: CharacterData; expires_at: number }>()

/**
 * The reads still in flight, under the same key.
 *
 * A crawler is not obliged to read a page and its image in order - the two can be asked for at
 * once - so two requests for a character the cache does not hold yet would otherwise race two
 * full Blizzard reads of the same account. The second caller waits on the first read instead.
 */
const pendingCharacters = new Map<string, Promise<CharacterData>>()

/** The entries kept before the expired ones are swept, so the map cannot grow without end. */
const CHARACTER_CACHE_LIMIT = 500

/**
 * Loads a character, optionally from a specific region. When no region is given
 * every known region is tried in turn, so deep links such as
 * /en/tichondrius/mychar work without an explicit ?region= parameter.
 *
 * The answer is kept for `CHARACTER_CACHE_SECONDS`, which is what keeps the page and the card
 * that follows it from reading Blizzard twice, and a read already under way is shared rather than
 * repeated by whoever asks next.
 */
export async function getCharacter(realm: string, name: string, region?: string, locale = 'ru_RU'): Promise<CharacterData> {
  // The language is part of the key: Blizzard localises the names and the earned title the card
  // and the page draw, so the two addresses of one character are genuinely two documents.
  const key = `${region || 'auto'}:${realm}:${name}:${locale}`
  const now = Math.floor(Date.now() / 1000)

  const cached = cachedCharacters.get(key)
  if (cached && cached.expires_at > now) {
    return cached.data
  }

  const inFlight = pendingCharacters.get(key)
  if (inFlight) {
    return inFlight
  }

  const load = (async () => {
    const regions = region ? [region] : FALLBACK_REGIONS
    let lastError: any = null

    for (const candidate of regions) {
      try {
        const data = await fetchCharacterProfile(realm, name, candidate, locale)

        if (cachedCharacters.size >= CHARACTER_CACHE_LIMIT) {
          const cutoff = Math.floor(Date.now() / 1000)
          for (const [expiredKey, entry] of cachedCharacters) {
            if (entry.expires_at <= cutoff) cachedCharacters.delete(expiredKey)
          }
        }

        cachedCharacters.set(key, {
          data,
          expires_at: Math.floor(Date.now() / 1000) + CHARACTER_CACHE_SECONDS
        })

        return data
      } catch (err: any) {
        const status = err?.statusCode || err?.status || err?.response?.status
        // A 404 says this region does not hold the character, which is what sends the loop on to
        // the next one; anything else is the API refusing to answer, and no other region fixes it.
        if (status !== 404) throw err
        lastError = err
      }
    }

    throw lastError || createError({ statusCode: 404, statusMessage: 'Character not found' })
  })()

  pendingCharacters.set(key, load)

  try {
    return await load
  } finally {
    // Whoever asks from here on finds the answer cached, or starts a fresh read.
    pendingCharacters.delete(key)
  }
}

/**
 * The factions a character has driven to the top of their own ladder, as ids.
 *
 * Reputations are the one account-wide figure the game does not expose per account: the pane is a
 * character's own log, and a faction finished on any character is a faction the account has
 * finished. So the ids of the ones this character has maxed are read here - Exalted, or the last
 * renown level of a faction that has one - to be folded into the account's pool
 * (`server/utils/accountPool`). Nothing else uses them, and a character Blizzard will not answer
 * for simply contributes nothing.
 */
export async function getMaxedReputationIds(
  realm: string,
  name: string,
  region: string,
  locale = 'en_US'
): Promise<number[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await $fetch<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/reputations`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale }
      }
    )

    return (data?.reputations || [])
      .filter((entry: any) => isReputationMaxed(entry.faction?.id, entry.standing))
      .map((entry: any) => entry.faction?.id)
      .filter((id: any) => typeof id === 'number')
  } catch {
    return []
  }
}

/**
 * The mounts a character's own journal holds, as ids.
 *
 * The account's own collection endpoint answers the account-wide journal, but a mount can belong to
 * a side or a race - one a Horde character can ride, one an Alliance character can, a class mount -
 * and those only ever appear in the journal of a character who can use them. So each character's
 * own list is read as the character is read and folded into the account's pool, which is what makes
 * the account's mount figure a union across the whole roster rather than one endpoint's answer
 * (`server/utils/accountPool`).
 */
export async function getCharacterMountIds(
  realm: string,
  name: string,
  region: string,
  locale = 'en_US'
): Promise<number[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await $fetch<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/collections/mounts`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale }
      }
    )

    return (data?.mounts || [])
      .map((entry: any) => entry?.mount?.id ?? entry?.id)
      .filter((id: any) => typeof id === 'number')
  } catch {
    return []
  }
}

/**
 * The primary professions a character has taken up, as the game names them.
 *
 * The profile summary does not carry them - a character's professions are a document of their own -
 * so this is one more call per character, made only where a character is read in full
 * (`server/utils/accountSync`). A character may hold two primaries, and a tile has room for two
 * pills, so the list is cut to two; the names arrive in the language the read was asked for.
 */
export async function getCharacterProfessions(
  realm: string,
  name: string,
  region: string,
  locale = 'en_US'
): Promise<string[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await $fetch<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/professions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale }
      }
    )

    return (data?.primaries || [])
      .map((entry: any) => entry?.profession?.name)
      .filter((profession: any) => typeof profession === 'string' && profession)
      .slice(0, 2)
  } catch {
    return []
  }
}