import { readMountJournal, refreshMountJournal, resolveArmoryBackground } from './armory'
import { ACHIEVEMENT_POINTS_TOTAL } from './achievements'
// The process's own counters and log, written beside every call this module makes and read by the admin
// panel's diagnostics (`server/utils/adminDiagnostics`). A plain import, like the rest of this file's.
import { recordBlizzardCall, recordDiagnostic, recordToleratedAbsence } from './adminDiagnostics'
// What asked for the call being made, carried down the async chain by the entry point that knows
// (`server/utils/blizzardSource`).
import { currentBlizzardSource } from './blizzardSource'
// Imported rather than auto-imported: the environment in front of the frozen runtime config is a rule of this
// module's own (`server/utils/runtimeEnv`), and a plain import keeps it working under the unit tests, which
// have no Nitro globals to install.
import { privateSetting } from './runtimeEnv'
import { isReputationMaxed, reputationTotal } from './reputations'
import { mountTotal } from './mounts'

let cachedToken: { access_token: string; expires_at: number } | null = null

/**
 * How long any one call to Blizzard is given before the site stops waiting for it.
 *
 * Every call here is a plain `$fetch` with no deadline of its own, so a connection Blizzard never answers
 * holds the request - and the reader's page - open indefinitely. Fifteen seconds is far beyond the ~200 ms
 * these calls take and well inside a reader's patience, and a call that runs past it is a document the site
 * does not have, which is a case the profile read already knows how to answer (`carryForward`).
 */
const BLIZZARD_TIMEOUT_MS = 15_000

/**
 * The one place Blizzard is called, so that every call carries the deadline above.
 *
 * The host varies - the game data API, the OAuth token, the account profile - but the need for a bound does
 * not, and a call added here cannot forget it.
 *
 * It is also the one place the *counters* live (`server/utils/adminDiagnostics`): how many calls this process
 * made, how many failed and how, and how long each took. The instrumentation is deliberately invisible to the
 * caller - the answer is handed back untouched and a failure is re-thrown exactly as it arrived, so nothing
 * about the site's own error handling, retries or caching can be moved by a panel watching it.
 */
export function callBlizzard<T>(
  url: string,
  options: Record<string, unknown> = {},
  category: string = endpointCategory(url)
): Promise<T> {
  // Typed by the caller rather than by `$fetch`'s inference off the request: every call below names the shape
  // it expects, and this hands that answer back unchanged.
  const startedAtMs = Date.now()
  // Read once, here: the tag belongs to the call chain, and the counters below are the only place it is kept.
  const source = currentBlizzardSource()

  return ($fetch(url, { timeout: BLIZZARD_TIMEOUT_MS, ...options }) as Promise<T>).then(
    (answer) => {
      recordBlizzardCall({ ok: true, durationMs: Date.now() - startedAtMs, category, source })
      return answer
    },
    (error: unknown) => {
      const status = upstreamStatus(error)
      const timeout = isTimeout(error)
      recordBlizzardCall({ ok: false, durationMs: Date.now() - startedAtMs, status, timeout, category, source })

      // A 404 is Blizzard answering honestly about a character that is not there, so it is not a diagnostic:
      // filing one per mistyped name would bury the failures that say something is wrong with the site.
      if (status !== 404) {
        // A refusal of a *reader's* token (their sign-in, a renewal, their account endpoints) is about that reader,
        // not about the site's credentials, and must not be filed as the operator's emergency.
        const readerFlow = category === 'oauth' || category === 'account'
        const refused = !readerFlow && (status === 401 || status === 403)

        recordDiagnostic({
          level: timeout || status >= 500 || refused ? 'error' : 'warn',
          category: 'blizzard',
          // A refused credential is the one failure that belongs to whoever runs the site rather than to a
          // reader, so it says so instead of looking like an outage or a missing character.
          message: readerFlow && (status === 401 || status === 403 || (status >= 400 && status < 500))
            ? 'Battle.net refused a reader’s token'
            : refused
            ? 'Blizzard refused the site’s credentials'
            : timeout
              ? 'Blizzard call ran past its deadline'
              : 'Blizzard call failed',
          status: status || undefined
        })
      }

      throw error
    }
  )
}

/**
 * What a call was *of*, from the shape of its address - and never from the address itself.
 *
 * The panel's breakdown answers "sixty of those failures were collection documents" without the panel ever
 * holding a URL, a realm or a name: the category is a word out of a closed list, derived here and thrown away
 * with the URL (see `BLIZZARD_CATEGORIES` in `#shared/data/adminDiagnostics`).
 */
export function endpointCategory(url: string): string {
  // The site's own client-credentials token is `token`. The reader's code exchange and renewal post to the same URL
  // and say so themselves (`callBnet` in `./bnetOAuth` passes `oauth`); `userinfo` is told apart here.
  if (url.includes('/oauth/token')) return 'token'
  if (url.includes('/oauth/')) return 'oauth'
  if (url.includes('/profile/user/wow')) return 'account'
  if (url.includes('/achievements?') || url.endsWith('/achievements')) return 'achievements'
  if (url.includes('/realm/index')) return 'realms'
  if (url.includes('/data/wow/')) return 'index'
  if (url.includes('/character-media')) return 'media'
  if (url.includes('/collections/')) return 'collections'
  if (url.includes('/reputations')) return 'reputations'
  if (url.includes('/mythic-keystone-profile')) return 'mythic-keystone'
  if (url.includes('/pvp-summary')) return 'pvp'
  if (url.includes('/titles')) return 'titles'
  if (url.includes('/quests/completed')) return 'quests'
  if (url.includes('/professions')) return 'professions'
  if (url.includes('/profile/wow/character/')) return 'profile'
  return 'other'
}


/** Blizzard's own status for a call, whatever shape the failure reached us in. */
function upstreamStatus(err: unknown): number {
  const failure = err as { statusCode?: number; status?: number; response?: { status?: number } }
  return Number(failure?.statusCode || failure?.status || failure?.response?.status || 0)
}

/** Whether a call ran past the deadline `callBlizzard` set, rather than being refused. */
function isTimeout(err: unknown): boolean {
  const failure = err as { name?: string; code?: string; cause?: { name?: string } }
  const name = failure?.name || failure?.cause?.name
  return name === 'TimeoutError' || name === 'AbortError' || failure?.code === 'ETIMEDOUT' || upstreamStatus(err) === 408
}

/**
 * The one place a failed call to Blizzard becomes the site's own answer.
 *
 * The status is a statement about *this site*, and it used to be a false one: any failure of the profile
 * summary - a refusal, a rate limit, a connection that died - was answered with the 404 that means "there is
 * no such character". A reader was told the character does not exist, a crawler was invited to remember that,
 * and the site could not tell its own outages from its own 404s either.
 *
 * So each failure is answered with what it actually is:
 *
 *   404  Blizzard says the character is not there. The only place a 404 comes from.
 *   429  Blizzard is rate-limiting the site's client - the site is over its quota, not out of characters.
 *   503  Blizzard is up but refusing to answer (any 5xx of its own).
 *   504  the call ran past the deadline `callBlizzard` gave it.
 *   502  the connection never got an answer at all: DNS, a reset, TLS.
 *
 * Nothing of the failure travels with it - no upstream URL, no response body, no exception text, nothing that
 * would let a reader map the site's insides. What is carried on is a status and a sentence a page can show.
 */
function upstreamFailure(err: unknown, what = 'character'): never {
  const status = upstreamStatus(err)

  if (status === 404) {
    throw createError({ statusCode: 404, statusMessage: `There is no such ${what} on that realm` })
  }

  if (status === 429) {
    // Blizzard's own `Retry-After` is passed on when it sent one: the client that hit the limit is the one
    // that has to wait, and the site has no better idea of how long.
    const retryAfter = (err as { response?: { headers?: { get?: (name: string) => string | null } } })?.response?.headers?.get?.(
      'retry-after'
    )
    throw createError({
      statusCode: 429,
      statusMessage: 'Blizzard is rate-limiting this site right now',
      data: retryAfter ? { retryAfter } : undefined
    })
  }

  if (status === 401 || status === 403) {
    // The site's own credentials were refused. Nothing about the reader, and nothing about a character - the
    // one failure that belongs to whoever runs the site, and says so instead of looking like an outage.
    //
    // The `reason` rides along because the retry policy has to tell this apart from a timeout: a rejected token
    // is not a bad moment to try again in five minutes (see `classifySyncFailure` in `./syncRetry`). It says
    // only *which kind* of failure it was, and carries nothing of the upstream answer.
    throw createError({
      statusCode: 502,
      statusMessage: 'The site could not authenticate with the Blizzard API',
      data: { reason: 'auth' }
    })
  }

  if (status >= 500) {
    throw createError({ statusCode: 503, statusMessage: 'The Blizzard API is not answering right now' })
  }

  if (isTimeout(err)) {
    throw createError({ statusCode: 504, statusMessage: 'The Blizzard API ran past the deadline for an answer' })
  }

  throw createError({ statusCode: 502, statusMessage: 'The Blizzard API could not be reached' })
}

/**
 * How long a *transient* upstream failure is remembered before the same document is asked for again.
 *
 * Measured against a mock upstream answering 503: every server-rendered front page asked for the site's token
 * sixteen times (four realm lists in each region, each with its own token request, none of them shared) and waited
 * ~650 ms for the refusal - and the next page did exactly the same. With an upstream that does not answer at all,
 * each front page waited thirty seconds. A short memory of the failure turns that into one attempt per window,
 * while the error itself is still the answer: nothing is replaced by an empty list or an invented token.
 */
export const TRANSIENT_FAILURE_MS = 30_000

/** The ceiling for a `Retry-After` the site honours, so a hostile header cannot park a document for an hour. */
const MAX_FAILURE_MS = 5 * 60_000

/**
 * How long a failure may be remembered, or `0` when it must not be.
 *
 * Only the failures that say nothing about the request are remembered: a 5xx, a timeout, a connection that never
 * answered, and a 429 (for as long as Blizzard's own `Retry-After` asks, within the ceiling). A refused credential is
 * deliberately *not* - it is the one failure an operator has to see on every request until it is fixed - and neither
 * is a 404 or any other answer about the thing asked for.
 */
export function transientFailureMs(err: unknown): number {
  const failure = err as {
    name?: string
    cause?: unknown
    data?: { reason?: string; retryAfter?: string | number }
    response?: { headers?: { get?: (name: string) => string | null } }
  }

  if (failure?.data?.reason === 'auth') return 0

  const status = upstreamStatus(err)
  if (status === 401 || status === 403) return 0

  if (status === 429) {
    const header = failure?.data?.retryAfter ?? failure?.response?.headers?.get?.('retry-after')
    const seconds = Number(header)
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_FAILURE_MS) : TRANSIENT_FAILURE_MS
  }

  if (status >= 500 || isTimeout(err)) return TRANSIENT_FAILURE_MS

  // No status at all: a dead connection (`fetch failed`, an ofetch `FetchError` without a response) is transient;
  // anything else - a bug, a parse error - is not the upstream's and is not remembered.
  if (status === 0 && (failure?.name === 'FetchError' || (err instanceof TypeError && failure?.cause !== undefined))) {
    return TRANSIENT_FAILURE_MS
  }

  return 0
}

/** The token request in flight per region, so a burst of first requests asks Battle.net once. */
const pendingTokens = new Map<string, Promise<string>>()

/** A transient token failure, rethrown as it was until `until` (milliseconds). */
const tokenFailures = new Map<string, { error: unknown; until: number }>()

export async function getBlizzardToken(region = 'eu') {
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expires_at > now + 60) {
    return cachedToken.access_token
  }

  const failed = tokenFailures.get(region)
  if (failed && failed.until > Date.now()) throw failed.error

  const running = pendingTokens.get(region)
  if (running) return running

  const request = requestBlizzardToken(region)
    .then(
      (token) => {
        tokenFailures.delete(region)
        return token
      },
      (error: unknown) => {
        const wait = transientFailureMs(error)
        if (wait > 0) tokenFailures.set(region, { error, until: Date.now() + wait })
        else tokenFailures.delete(region)
        throw error
      }
    )
    .finally(() => {
      pendingTokens.delete(region)
    })

  pendingTokens.set(region, request)
  return request
}

/** The one request for the site's own client-credentials token, mapped like every other failure. */
async function requestBlizzardToken(region: string): Promise<string> {
  const config = useRuntimeConfig()
  // Ask the environment first, then the config Nitro froze while loading: the `.env` beside the server is
  // read into the environment as the process starts (`server/utils/runtimeEnv`), which is after that copy was
  // made - and this function has no request to hand `useRuntimeConfig`, so it would otherwise see the empty
  // defaults of the build.
  const clientId = privateSetting('NUXT_BLIZZARD_CLIENT_ID', config.blizzardClientId)
  const clientSecret = privateSetting('NUXT_BLIZZARD_CLIENT_SECRET', config.blizzardClientSecret)
  const now = Math.floor(Date.now() / 1000)

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await callBlizzard<{ access_token: string; expires_in: number }>(`https://${region}.battle.net/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
    // A token the API refused is the site's credentials or the API's own state - not a reader's character -
    // and ofetch's message would carry the upstream URL and status with it, so it is mapped like the rest.
  }).catch((err: unknown) => upstreamFailure(err))

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
    callBlizzard<any>(`https://${region}.api.blizzard.com/data/wow/mount/index?${namespace}`, { headers }),
    callBlizzard<any>(`https://${region}.api.blizzard.com/data/wow/pet/index?${namespace}`, { headers }),
    callBlizzard<any>(`https://${region}.api.blizzard.com/data/wow/toy/index?${namespace}`, { headers }),
    callBlizzard<any>(`https://${region}.api.blizzard.com/data/wow/decor/index?${namespace}`, { headers }),
    callBlizzard<any>(`https://${region}.api.blizzard.com/data/wow/reputation-faction/index?${namespace}`, { headers })
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

/**
 * The realm lists being read, and the transient failures of the last read, per region and language.
 *
 * Every server-rendered page that draws the search box or a realm name asks for the list, and the front page asks
 * for it twice over (`realm-list` and `hoa-realm-names`), each in two languages and two regions - eight reads of four
 * documents on a cold process. They now share one read per document, and a list that could not be read is not asked
 * for again by every page inside `TRANSIENT_FAILURE_MS`. A failure is never stored as an empty list: the caller gets
 * the error, as before, and the page draws what it draws without a list.
 */
const pendingRealms = new Map<string, Promise<Realm[]>>()
const realmFailures = new Map<string, { error: unknown; until: number }>()

export async function getRealms(region = 'eu', locale = 'en_US'): Promise<Realm[]> {
  const now = Math.floor(Date.now() / 1000)
  const cacheKey = `${region}:${locale}`
  const cached = cachedRealms.get(cacheKey)

  if (cached && cached.expires_at > now) {
    return cached.data
  }

  const failed = realmFailures.get(cacheKey)
  if (failed && failed.until > Date.now()) throw failed.error

  const running = pendingRealms.get(cacheKey)
  if (running) return running

  const read = readRealms(region, locale, cacheKey)
    .then(
      (realms) => {
        realmFailures.delete(cacheKey)
        return realms
      },
      (error: unknown) => {
        const wait = transientFailureMs(error)
        if (wait > 0) realmFailures.set(cacheKey, { error, until: Date.now() + wait })
        else realmFailures.delete(cacheKey)
        throw error
      }
    )
    .finally(() => {
      pendingRealms.delete(cacheKey)
    })

  pendingRealms.set(cacheKey, read)
  return read
}

/** One read of a region's realm index, filtered and cached for the day. */
async function readRealms(region: string, locale: string, cacheKey: string): Promise<Realm[]> {
  const now = Math.floor(Date.now() / 1000)
  const token = await getBlizzardToken(region)
  const data = await callBlizzard<any>(
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

/**
 * A figure that has no denominator the site can read: the count alone.
 *
 * The six collection tiles are measured against a total (`CharacterStat`), because a collection has a size -
 * the mount journal, the achievement points a patch ships. The figures added beside them do not: how many
 * quests a character has run, how many titles it has earned, how many recipes it knows, how many appearance
 * sources its account has unlocked, how many honorable kills it has and what its honor level stands at are
 * counts with no reachable ceiling the API states, and a bar measured against an invented one would be a lie
 * drawn in gold. So the count is the whole figure, and a tile prints it alone.
 *
 * `accountWide` is the reputations rule read the other way round: it marks a figure whose count on one
 * character is already the account's own - the appearances, which the game keeps for the account, and the
 * honor level, which is a property of the account rather than of the hero - so a tile can say so.
 */
export interface CountStat {
  count: number
  accountWide?: boolean
}

/**
 * The ids of a Blizzard list that names its entries by id, or by the id at the end of an href alone.
 *
 * The titles and the quests arrive as `{ id, name, key: { href } }` on one endpoint and as `{ name, key:
 * { href } }` on another, so both spellings are read here. A list that carries neither is an empty set rather
 * than a count of rows that cannot be told apart - which is what makes the figure a count of *unique* things.
 */
function idsIn(list: any[] | undefined): Set<number> {
  const ids = new Set<number>()

  for (const entry of list || []) {
    const fromHref = String(entry?.key?.href || '').match(/\/\d+(?:[/?]|$)/)?.[0]
    const id = entry?.id ?? (fromHref ? Number(fromHref.replace(/\D/g, '')) : undefined)

    if (typeof id === 'number' && Number.isFinite(id) && id > 0) ids.add(id)
  }

  return ids
}

/** Every recipe id a character's professions document names, primaries and secondaries together. */
function recipeIdsOf(professions: any): Set<number> {
  const ids = new Set<number>()

  for (const group of ['primaries', 'secondaries']) {
    for (const entry of professions?.[group] || []) {
      for (const tier of entry?.tiers || []) idsIn(tier?.known_recipes).forEach((id) => ids.add(id))
    }
  }

  return ids
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
  /**
   * The overall rating of the figures above (`server/utils/playerScore`), set where those figures are put
   * together - which is one place, and on the server (`overlayPool` in `server/utils/accountPool`).
   *
   * A page prints this number; no page works one out. It used to, from its own list of the figures, and a
   * list written by hand beside a formula is a list that loses a figure when the formula gains one - the
   * score at the bottom of a character page read thousands of points below the very table it was taken
   * from. Absent from the reading Blizzard itself was read into: the rating is the site's own idea of a
   * player and is attached by the overlay, which every page and the card are served through.
   */
  score?: number
  /**
   * When Blizzard was asked for this reading, in unix seconds, set by the endpoint that serves the page.
   *
   * A profile is answered from a two-hour cache (`server/api/character`), so this moment - not the moment the
   * page was opened - is the only honest answer to "how old are these figures". A page that prints it is
   * saying when the character was read rather than when it was looked at (`app/components/CharacterVersus.vue`).
   * Absent from a reading that never came through the endpoint.
   */
  fetchedAt?: number
  stats: {
    mounts: CharacterStat
    pets: CharacterStat
    toys: CharacterStat
    decor: CharacterStat
    reputations: ReputationStat
    achievements: CharacterStat
    /**
     * The four figures that are not collections of items, read from the same character profile: the titles and
     * quests it has earned, the recipes its professions know, and the two figures of its player versus player
     * side. Each is a count of unique ids where ids exist - the account's union over the roster is taken from
     * those very ids (`server/utils/accountPool`) - and a plain number where they do not: honorable kills add
     * up over a roster, an honor level is taken from its highest character.
     */
    titles: CountStat
    quests: CountStat
    recipes: CountStat
    honorableKills: CountStat
    honorLevel: CountStat
    /**
     * The appearance sources unlocked for every gear slot, which is the one figure of the six that is *not*
     * read with the profile: the document behind it is 2.5 MB, so it is read by the tray that shows it
     * (`server/api/transmog`). Absent from a reading that never asked for it.
     */
    transmogs?: CountStat
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
 * toys, decor and pets are identical for all of them. The mount tile therefore reports the
 * character the way the API returns it, and the reputation tile does the same: the
 * character's own factions, counted exactly as the journal beside it counts them
 * (`isReputationMaxed`, `server/utils/reputations`).
 *
 * The account's figures are the site's own, not Blizzard's: they are the union of unique
 * ids in `server/utils/accountPool`, laid over this reading before a page prints it
 * (`overlayPool`). Blizzard's account-wide counter - the `amount` of the "N Exalted
 * Reputations" achievement family, the only account-wide number a public page can reach,
 * seen in the character's achievements - is deliberately not used as the account's figure:
 * it counts entries the site's atlas has no row for (measured on one account: 185 against
 * the 174 unique factions that account's characters had actually finished), so a tile read
 * from it could never agree with the journal below it, and reading it costs the character's
 * whole achievement document - about 2 MB - on every page.
 */

/**
 * Loads a character from a single region. Throws a 404 when the character does
 * not exist in that region.
 *
 * `force` is a refresh: the site reads Blizzard again rather than serving what it already holds, and it
 * waits for the one figure it cannot read for itself - the mount journal the Armoury publishes
 * (`refreshMountJournal`). A page is never made to wait for that page, which is why the plain read starts
 * the same journal read and answers without it (`server/utils/armory`).
 */
async function fetchCharacterProfile(
  realm: string,
  name: string,
  region: string,
  locale: string,
  force = false
): Promise<CharacterData> {
  const token = await getBlizzardToken(region)
  const headers = { Authorization: `Bearer ${token}` }
  const baseUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}`
  const ns = `namespace=profile-${region}&locale=${locale}`

  const [summary, media, mounts, pets, toys, decor, reps, mplus, totals, titles, quests, professions, pvp] =
    await Promise.allSettled([
      callBlizzard<any>(`${baseUrl}?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/character-media?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/collections/mounts?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/collections/pets?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/collections/toys?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/collections/decor?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/reputations?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/mythic-keystone-profile?${ns}`, { headers }),
      getCollectionTotals(region, token),
      // The four figures that are not collections of items: the titles, the quests and the recipes a character
      // has earned (ids, so the account's union can be taken over the roster) and the two figures of the player
      // versus player side (`/pvp-summary`, a kilobyte, which carries both the honorable kills and the honor
      // level). The transmogs are deliberately not read here: that document is 2.5 MB and belongs to the tray
      // that asks for it (`server/api/transmog`).
      callBlizzard<any>(`${baseUrl}/titles?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/quests/completed?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/professions?${ns}`, { headers }),
      callBlizzard<any>(`${baseUrl}/pvp-summary?${ns}`, { headers })
    ])

  if (summary.status === 'rejected') {
    // Thrown exactly as it arrived, and *not* turned into a status here: `getCharacter` is the one place a
    // failure becomes the site's answer, because it is the one place that also knows whether a 404 should send
    // the loop on to the next region. Mapping it here as well would map it twice - a 504 and a 502 would come
    // out of the second pass as a 503, which is how a timeout came to look like an outage.
    throw summary.reason
  }

  /**
   * Every document beside the summary is *optional*, and its absence is expected rather than exceptional.
   *
   * Blizzard answers `404` for a character's Mythic+ history when they have never run a key, and a collection
   * document can be refused on its own without the character being wrong. The read tolerates all twelve of them
   * (`status === 'fulfilled'` below, and a figure that cannot be read is carried forward rather than zeroed), and
   * until now the panel could not tell that wave of expected 404s apart from a character that does not exist: one
   * missing character is *twelve* failed requests - the profile read fans out over a dozen documents and Blizzard
   * refuses every one of them - and the reported incident showed a hundred and thirty-two failures of which most
   * were exactly this. They are filed here, once per read, as what they are - tolerated - while remaining counted
   * as the failed requests they also were.
   */
  const optional = [media, mounts, pets, toys, decor, reps, mplus, totals, titles, quests, professions, pvp]
  for (const result of optional) if (result.status === 'rejected') recordToleratedAbsence()

  const charData = summary.value
  const mediaData = media.status === 'fulfilled' ? media.value : null
  const mountsData = mounts.status === 'fulfilled' ? mounts.value : null
  const petsData = pets.status === 'fulfilled' ? pets.value : null
  const toysData = toys.status === 'fulfilled' ? toys.value : null
  const decorData = decor.status === 'fulfilled' ? decor.value : null
  const repsData = reps.status === 'fulfilled' ? reps.value : null
  const mplusData = mplus.status === 'fulfilled' ? mplus.value : null
  const totalsData = totals.status === 'fulfilled' && totals.value ? totals.value : CHARACTER_DEFAULT_TOTALS
  const titlesData = titles.status === 'fulfilled' ? titles.value : null
  const questsData = quests.status === 'fulfilled' ? quests.value : null
  const professionsData = professions.status === 'fulfilled' ? professions.value : null
  const pvpData = pvp.status === 'fulfilled' ? pvp.value : null

  // The documents the tiles were counted from are filed so a shelf or the journal that follows this page can
  // reuse them instead of reading Blizzard again (`rememberCharacterDocs`).
  rememberCharacterDocs(region, realm, name, locale, {
    mounts: mountsData,
    pets: petsData,
    toys: toysData,
    decor: decorData,
    reputations: repsData
  })

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
   * last level, the brokers of K'aresh at Mastermind - the count the journal below the tile
   * reads as this character's own, and the lower bound the account's union is measured
   * against (`overlayPool`).
   */
  const maxedReputations = (repsData?.reputations || [])
    .filter((rep: any) => isReputationMaxed(rep.faction?.id, rep.standing))

  const mPlusScore = mplusData?.current_mythic_rating?.rating
    ? Math.round(mplusData.current_mythic_rating.rating)
    : 0

  const achievementPoints = charData.achievement_points || 0

  const backgroundUrl = await resolveArmoryBackground({
    classId: charData.character_class?.id
  }).catch(() => '')

  // The journal a character's mounts are measured against is its own - it follows the faction and the
  // patch, not the index - and the Armoury publishes it as a *web page*, which is the slowest thing this
  // read touches by an order of magnitude: seconds against the tens of milliseconds every Blizzard call
  // here takes. So the page is never waited on. A character the site has read inside the day is answered
  // from the journal already on file; any other is answered with `null`, which leaves `mountTotal` to
  // stand the snapshot in (`server/utils/mounts`) - and the read below files the journal behind the page,
  // for the next visit, the card and everything else that reads the same entry.
  //
  // A refresh is the one caller that does wait for it, and only for the read the site has not got: the
  // reader asked for everything about this character, and the denominator is one of the figures they are
  // looking at. A journal already read inside its day is not read again - the number moves with a patch, not
  // with a press - so the wait costs a refresh nothing until the copy on file is a day old, and a burst of
  // presses, with the card and the feed that follow one, all share the one read (`refreshMountJournal`).
  if (force) await refreshMountJournal(region, realm, name)
  else void refreshMountJournal(region, realm, name)

  const mountJournal = readMountJournal(region, realm, name)

  /**
   * The four figures read beside the collections, as sets of unique ids where Blizzard names them by id.
   *
   * They are sets rather than lengths because the ids are what the account's own figures are taken from: a
   * title or a quest earned on one character is part of the account's union (`server/utils/accountPool`), and a
   * count taken here would be a count of one character's rows. `honorableKills` and `honorLevel` are numbers
   * instead - the first adds up over a roster, the second is an account's own standing.
   */
  const titleIds = idsIn(titlesData?.titles)
  const questIds = idsIn(questsData?.quests)
  const recipeIds = recipeIdsOf(professionsData)

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
        // What this character alone has taken to the top of its ladder. The account's own
        // figure is the union of finished factions across the roster and is laid over this
        // one where the site holds such a pool (`server/utils/accountPool`).
        count: maxedReputations.length,
        // What a character of this faction can reach: Blizzard's index minus the other
        // side's factions and minus the entries that only group the rest.
        total: reputationTotal(charData.faction?.type || 'NEUTRAL', totalsData.reputations, repsData?.reputations?.length || 0),
        // Set by the pool: on its own the reading is this character's, and says so.
        accountWide: false
      },
      achievements: { count: achievementPoints, total: ACHIEVEMENT_POINTS_TOTAL },
      // The four figures that are counts of what a character has *done* rather than of what it keeps. Each is
      // the character's own reading here; the account's own union is laid over them where the site holds a pool
      // (`overlayPool` in `server/utils/accountPool`), exactly as it is for the reputations above.
      titles: { count: titleIds.size },
      quests: { count: questIds.size },
      recipes: { count: recipeIds.size },
      honorableKills: { count: Number(pvpData?.honorable_kills) || 0 },
      honorLevel: { count: Number(pvpData?.honor_level) || 0 }
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

/**
 * How soon a refresh may spend another read of the same character, in seconds.
 *
 * The button that sends one rests for a minute of its own (`app/pages/[region]/[realm]/[name].vue`), but the
 * endpoint it calls is public and a script has no such manners - and one read of a character is ten Blizzard
 * calls. Fifteen seconds is shorter than a person pressing a button can notice and long enough that a burst
 * of presses, together with the card and the feed that follow one, is one read rather than three.
 */
const FORCE_COOLDOWN_SECONDS = 15

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
 * The raw collection and reputation documents a profile read fetched, kept so a shelf or the journal that
 * follows the page does not read them again.
 *
 * `fetchCharacterProfile` reads four collections and the reputations to compute the overview tiles, and a
 * reader who then opens a shelf or the journal is asking for the very documents those tiles were counted from.
 * Without this the second ask is a second Blizzard read - four collections and the reputations fetched again
 * a moment after they were fetched - so the documents are filed here as the profile is read, under the
 * character's own address and locale, and answered for as long as the profile itself is served
 * (`CHARACTER_CACHE_SECONDS`). A shelf still reads the document itself: what is shared is the bytes, not the
 * view, so a shelf and a tile can never disagree about a number.
 */
const characterDocs = new Map<string, { at: number; data: Partial<Record<CharacterDocKind, unknown>> }>()

/** The documents a profile read carries, by the endpoint path that produces each. */
export type CharacterDocKind = 'mounts' | 'pets' | 'toys' | 'decor' | 'reputations'

/** The entries kept before the expired ones are swept, so the map cannot grow without end. */
const CHARACTER_DOCS_LIMIT = 500

/** The raw document of one kind, or `undefined` when none is on file or it has expired. */
export function recallCharacterDoc(
  region: string,
  realm: string,
  name: string,
  locale: string,
  kind: CharacterDocKind
): unknown {
  const entry = characterDocs.get(`${region}:${realm}:${name}:${locale}`.toLowerCase())
  if (!entry || entry.at + CHARACTER_CACHE_SECONDS < Math.floor(Date.now() / 1000)) return undefined
  return entry.data[kind]
}

/** Files the documents a profile read fetched, so a shelf or the journal can reuse them. */
export function rememberCharacterDocs(
  region: string,
  realm: string,
  name: string,
  locale: string,
  data: Partial<Record<CharacterDocKind, unknown>>
): void {
  const key = `${region}:${realm}:${name}:${locale}`.toLowerCase()
  const now = Math.floor(Date.now() / 1000)

  if (characterDocs.size >= CHARACTER_DOCS_LIMIT && !characterDocs.has(key)) {
    for (const [heldKey, entry] of characterDocs) {
      if (entry.at + CHARACTER_CACHE_SECONDS < now) characterDocs.delete(heldKey)
    }
  }

  const entry = characterDocs.get(key) ?? { at: now, data: {} }
  let filed = false
  for (const kind of ['mounts', 'pets', 'toys', 'decor', 'reputations'] as const) {
    if (data[kind] != null) {
      entry.data[kind] = data[kind]
      filed = true
    }
  }

  if (filed) {
    entry.at = now
    characterDocs.set(key, entry)
  }
}

/** Drops every document, for a test that has to start from a clean map. */
export function clearCharacterDocs(): void {
  characterDocs.clear()
}

/**
 * The reading, with any collection figure it could not read taken from the last reading instead.
 *
 * A profile is eight Blizzard documents read at once (`fetchCharacterProfile`) and any of them can come back
 * missing for a reason that is not "none" - a call that ran past its deadline, a document Blizzard refused -
 * while `CharacterData` has no way to say "unknown". A zero written in its place is not a thin reading but a
 * wrong one: it is what a page prints as an empty collection, what the account's pool is filled from and what
 * the day's own row is filed with (`server/utils/profileFeed`), so a moment's bad luck would take the last
 * real number with it.
 *
 * Only the figures that are never really zero are carried - a character with no mounts, pets, toys, decor,
 * reputations or achievement points does not exist - and only upwards: a figure this read did get is this
 * read's, whatever it says. The item level and the rating are deliberately not among them, because zero is a
 * reading a fresh character really gives, and `overlayPool` already weighs those two against the site's own
 * record of the character.
 */
function carryForward(previous: CharacterData | undefined, read: CharacterData): CharacterData {
  if (!previous) return read

  const held = (kind: keyof CharacterData['stats']) => previous.stats[kind]?.count ?? 0
  const kept = (kind: keyof CharacterData['stats'], value: number) => (value > 0 ? value : held(kind))

  return {
    ...read,
    ap: kept('achievements', read.ap),
    stats: {
      ...read.stats,
      achievements: { ...read.stats.achievements, count: kept('achievements', read.stats.achievements.count) },
      mounts: { ...read.stats.mounts, count: kept('mounts', read.stats.mounts.count) },
      pets: { ...read.stats.pets, count: kept('pets', read.stats.pets.count) },
      toys: { ...read.stats.toys, count: kept('toys', read.stats.toys.count) },
      decor: { ...read.stats.decor, count: kept('decor', read.stats.decor.count) },
      reputations: { ...read.stats.reputations, count: kept('reputations', read.stats.reputations.count) },
      titles: { ...read.stats.titles, count: kept('titles', read.stats.titles.count) },
      quests: { ...read.stats.quests, count: kept('quests', read.stats.quests.count) },
      recipes: { ...read.stats.recipes, count: kept('recipes', read.stats.recipes.count) },
      // The two player versus player figures are deliberately not carried: an honor level and a tally of
      // honorable kills are figures a fresh character really gives as zero, exactly as the item level and the
      // rating above are.
      honorableKills: read.stats.honorableKills,
      honorLevel: read.stats.honorLevel
    }
  }
}

/**
 * Loads a character, optionally from a specific region. When no region is given
 * every known region is tried in turn, so deep links such as
 * /en/tichondrius/mychar work without an explicit ?region= parameter.
 *
 * The answer is kept for `CHARACTER_CACHE_SECONDS`, which is what keeps the page and the card
 * that follows it from reading Blizzard twice, and a read already under way is shared rather than
 * repeated by whoever asks next.
 *
 * `force` is the Refresh button, and it is the one request that does not take the cache's word for it: the
 * character is read again whatever the age of the copy on file, so the answer carries what Blizzard says now
 * rather than what it said up to ten minutes ago. What a refresh does *not* do is read twice for one press -
 * a read already under way is joined, and a copy taken inside `FORCE_COOLDOWN_SECONDS` is the answer - because
 * a burst of presses, the card drawn beside them and the feed that follows them all ask for the same character
 * at the same moment (`server/api`). A refresh that fails changes nothing here: the copy on file is left
 * standing, the error is the caller's, and the next plain request is answered exactly as it was before.
 */
export async function getCharacter(
  realm: string,
  name: string,
  region?: string,
  locale = 'ru_RU',
  force = false
): Promise<CharacterData> {
  // The language is part of the key: Blizzard localises the names and the earned title the card
  // and the page draw, so the two addresses of one character are genuinely two documents.
  const key = `${region || 'auto'}:${realm}:${name}:${locale}`
  const now = Math.floor(Date.now() / 1000)

  const cached = cachedCharacters.get(key)
  if (cached && cached.expires_at > now) {
    // A refresh inside the cooldown is answered from the copy taken moments ago rather than by reading
    // again: the reader asked for the newest figures, and the newest figures are the ones just read.
    const readAt = cached.expires_at - CHARACTER_CACHE_SECONDS
    if (!force || readAt > now - FORCE_COOLDOWN_SECONDS) {
      return cached.data
    }
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
        const read = await fetchCharacterProfile(realm, name, candidate, locale, force)
        // A document this read could not get leaves its figure standing at the last one the site saw, rather
        // than at the zero the tile would otherwise print (`carryForward`).
        const data = carryForward(cached?.data, read)

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
        // A 404 says this region does not hold the character, which is what sends the loop on to the next
        // one; anything else is Blizzard refusing to answer, and no other region fixes that - so it is
        // answered with the status that says which refusal it was, rather than passed on as whatever the
        // fetch happened to throw (`upstreamFailure`).
        if (upstreamStatus(err) === 404) {
          lastError = err
          continue
        }
        upstreamFailure(err)
      }
    }

    // Every region that was tried said the same thing: there is no such character.
    upstreamFailure(lastError || createError({ statusCode: 404, statusMessage: 'Character not found' }))
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
    const data = await callBlizzard<any>(
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
    const data = await callBlizzard<any>(
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
 * The two primary professions a character has taken up, in the canonical English spelling.
 *
 * The profile summary does not carry them - a character's professions are a document of their own -
 * so this is one more call per character, made only where a character is read in full
 * (`server/utils/accountSync`). It is always asked for in `en_US`, whatever language the page is
 * read in: the row keeps one spelling, and the page translates it with the site's own table
 * (`#shared/utils/wow-professions`) - which is what stops the same profession from being stored in
 * two languages and printed in whichever one the background task happened to use.
 */
export async function getCharacterProfessions(realm: string, name: string, region: string): Promise<string[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await callBlizzard<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/professions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale: 'en_US' }
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

/**
 * The ids one character's own list names, as the account's pool is filled from them.
 *
 * Read here rather than carried on a profile, and for the reason the mount ids are (`getCharacterMountIds`): a
 * page prints counts, the pool counts *unique ids*, and the two are read by different callers - the page by
 * whoever opens a character, the pool by the account sync, which reads a character it is due for anyway. A list
 * the site could not read is an empty one, so a failed call leaves the pool as it was rather than emptying it.
 */
async function characterListIds(
  realm: string,
  name: string,
  region: string,
  path: string,
  pick: (data: any) => any[] | undefined
): Promise<number[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await callBlizzard<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/${path}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale: 'en_US' }
      }
    )

    return [...idsIn(pick(data))]
  } catch {
    return []
  }
}

/** The titles one character wears, which the account's own figure is the union of. */
export function getCharacterTitleIds(realm: string, name: string, region: string): Promise<number[]> {
  return characterListIds(realm, name, region, 'titles', (data) => data?.titles)
}

/** The quests one character has completed, which the account's own figure is the union of. */
export function getCharacterQuestIds(realm: string, name: string, region: string): Promise<number[]> {
  return characterListIds(realm, name, region, 'quests/completed', (data) => data?.quests)
}

/** The recipes one character's professions know, primaries and secondaries together. */
export async function getCharacterRecipeIds(realm: string, name: string, region: string): Promise<number[]> {
  try {
    const token = await getBlizzardToken(region)
    const data = await callBlizzard<any>(
      `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/professions`,
      {
        headers: { Authorization: `Bearer ${token}` },
        query: { namespace: `profile-${region}`, locale: 'en_US' }
      }
    )

    return [...recipeIdsOf(data)]
  } catch {
    return []
  }
}

/** The appearance sources read per character, and when that reading stops being served. */
const cachedTransmogs = new Map<string, { count: number; expires_at: number }>()

/** The reads still in flight, under the same key, so a tray opened twice waits once. */
const pendingTransmogs = new Map<string, Promise<number | null>>()

/**
 * How many appearances a character's account has unlocked, counted over every gear slot.
 *
 * The one figure of the six added beside the collections that is *not* read with the profile, because the
 * document behind it is 2.5 MB - measured on a collector's account: 22 slots, 19 016 appearance ids, the same
 * order as the character's whole achievement document, which the site deliberately stopped reading for a single
 * counter. It is read here instead, by the tray that shows it (`server/api/transmog`) and by the account sync.
 *
 * Once per account is exact rather than an approximation: the wardrobe belongs to the account, so two
 * characters of one account answer the same 22 slots with the same ids in the same order.
 *
 * What the number counts is the *sum* over those slots, which is how the game's own collection pane counts
 * them: an appearance that fits more than one slot is listed under each of them, so the figure stands a few
 * handfuls above the number of distinct appearances behind it (measured against one collector's account:
 * 24 511 entries over the slots, 24 358 distinct ids). It is the appearances that are counted, not the
 * *sources* a third-party tracker reports - a source is one item that teaches an appearance, and one
 * appearance may be taught by several, which is why a figure like a tracker's "appearance sources" is the
 * larger number, and why the two are not the same measurement. The document's own `appearance_sets` are not
 * counted at all: a set is a way of wearing what is already there rather than another appearance.
 *
 * A reading is kept for a day, and shared while it is being taken: an appearance is unlocked by playing, not by
 * a patch, so the figure moves by handfuls and a tray opened twice must not cost 2.5 MB twice.
 */
export async function getCharacterTransmogs(realm: string, name: string, region: string): Promise<number | null> {
  const key = `${region}:${realm}:${name}`.toLowerCase()
  const now = Math.floor(Date.now() / 1000)

  const held = cachedTransmogs.get(key)
  if (held && held.expires_at > now) return held.count

  const running = pendingTransmogs.get(key)
  if (running) return running

  const reading = (async (): Promise<number | null> => {
    try {
      const token = await getBlizzardToken(region)
      const data = await callBlizzard<any>(
        `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}/collections/transmogs`,
        {
          headers: { Authorization: `Bearer ${token}` },
          query: { namespace: `profile-${region}`, locale: 'en_US' }
        }
      )

      const count = (data?.slots || []).reduce(
        (total: number, slot: any) => total + (slot?.appearances || []).length,
        0
      )

      if (count > 0) {
        if (cachedTransmogs.size > 500) cachedTransmogs.clear()
        cachedTransmogs.set(key, { count, expires_at: now + 24 * 60 * 60 })
      }

      return count
    } catch {
      // A reading the site could not take is not a zero: a tray prints a dash for a character whose appearances
      // could not be read rather than an empty wardrobe.
      return null
    } finally {
      pendingTransmogs.delete(key)
    }
  })()

  pendingTransmogs.set(key, reading)
  return reading
}
