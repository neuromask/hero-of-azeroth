/**
 * The Battle.net half of signing a reader in.
 *
 * The site's own Blizzard client (`./blizzard`) reads public game data from a client-credentials
 * token. This module is the other flow: an authorization code the reader approves, exchanged for a
 * token that belongs to them - the only token `/profile/user/wow` answers a character list to.
 */
import type { H3Event } from 'h3'
// A plain import rather than Nitro's auto-import: the environment in front of the frozen runtime config is a
// rule of `server/utils/runtimeEnv`, and importing it keeps these modules working under the unit tests.
import { privateSetting } from './runtimeEnv'
import type { BlizzardRegion } from './params'

/** How long any call to Battle.net is given before the site stops waiting for it. */
const BNET_TIMEOUT_MS = 15_000

/**
 * The one place Battle.net is called, so that every call carries the deadline above.
 *
 * These are the OAuth hosts (`battle.net`), not the game-data API `callBlizzard` wraps, but a connection
 * Battle.net never answers would hold a sign-in or a renewal open just the same - so the same fifteen-second
 * bound is applied.
 */
function callBnet<T>(url: string, options: Record<string, unknown> = {}): Promise<T> {
  return $fetch(url, { timeout: BNET_TIMEOUT_MS, ...options }) as Promise<T>
}

/** What the token endpoint answers. `refresh_token` is optional: Battle.net does not always send one. */
export interface BnetTokens {
  access_token: string
  expires_in: number
  token_type?: string
  scope?: string
  refresh_token?: string
}

/** Who the token belongs to, as `/oauth/userinfo` spells it. */
export interface BnetUserInfo {
  /** The stable account id, and the half a record is unique on. */
  sub: string
  id?: number
  battletag?: string
}

/**
 * One character as `/profile/user/wow` spells it.
 *
 * The account summary carries a character's own fields (its name, realm, level, class, faction)
 * directly on the entry, and the `character` beside them is a link reference to the same character -
 * not a second copy of the data. The reference is still read, because an answer that nests the
 * fields there instead must parse too.
 */
export interface AccountCharacter {
  name?: string
  level?: number
  realm?: { slug?: string; name?: string }
  playable_class?: { id?: number }
  faction?: { type?: string }
  /** The link reference to the same character, which some answers nest the fields under. */
  character?: {
    name?: string
    level?: number
    realm?: { slug?: string; name?: string }
    playable_class?: { id?: number }
    faction?: { type?: string }
  }
}

/** The account summary: the light call that names every character the account holds. */
export interface AccountProfile {
  wow_accounts?: { id?: number; characters?: AccountCharacter[] }[]
}

/** A host that belongs to the machine the server runs on, which is what a development sign-in is. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

/**
 * The callback address: where Battle.net sends the reader back.
 *
 * It has to be the address the reader is actually browsing, or a development sign-in lands on
 * production - the authorize URL and the token exchange both name it, and the two must agree to the
 * character. So a local address answers with its own callback and every other address with the
 * site's public host, which is also what a staging copy wants: it never registers production's.
 * `NUXT_OAUTH_REDIRECT_URI` overrides both, for a host whose public address is rewritten by a proxy.
 */
function redirectUri(event: H3Event, siteUrl: string, override: string): string {
  if (override) return `${override.replace(/\/+$/, '')}/api/auth/callback`

  const url = getRequestURL(event)
  if (LOCAL_HOST.test(url.host)) return `${url.origin}/api/auth/callback`

  return `${siteUrl}/api/auth/callback`
}

/**
 * The Battle.net client's own credentials.
 *
 * Read here rather than inside `oauth` because the renewal path has no request to hand over
 * (`refreshAccessToken`): the client is the site's, while the redirect URI belongs to a sign-in a reader
 * started - so the pair is read on its own, and the callback is built only where there is a request. The
 * environment comes first, because the `.env` beside the server is read into it as the process starts, which
 * is later than the copy of the config these functions are handed (`server/utils/runtimeEnv`).
 */
function clientCredentials(): { clientId: string; clientSecret: string } {
  const config = useRuntimeConfig()

  return {
    clientId: privateSetting('NUXT_BLIZZARD_CLIENT_ID', config.blizzardClientId),
    clientSecret: privateSetting('NUXT_BLIZZARD_CLIENT_SECRET', config.blizzardClientSecret)
  }
}

/** The client and the callback, read off the runtime config, the environment and the request. */
function oauth(event: H3Event): { clientId: string; clientSecret: string; redirectUri: string } {
  const config = useRuntimeConfig()
  const siteUrl = String(config.public.siteUrl || '').replace(/\/+$/, '')

  return {
    ...clientCredentials(),
    redirectUri: redirectUri(event, siteUrl, privateSetting('NUXT_OAUTH_REDIRECT_URI', config.oauthRedirectUri))
  }
}

/** The Basic header every token call is authenticated with. */
function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

/** Where the reader is sent to approve the sign-in. */
export function authorizeUrl(event: H3Event, region: BlizzardRegion, state: string): string {
  const { clientId, redirectUri } = oauth(event)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'wow.profile',
    state
  })

  return `https://${region}.battle.net/oauth/authorize?${params.toString()}`
}

/** An authorization code traded for the reader's own token. */
export async function exchangeCode(event: H3Event, region: BlizzardRegion, code: string): Promise<BnetTokens> {
  const { clientId, clientSecret, redirectUri } = oauth(event)

  return await callBnet<BnetTokens>(`https://${region}.battle.net/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  })
}

/**
 * A token renewal, attempted only when the account actually holds a refresh token. Battle.net
 * historically does not issue one; the caller falls back to a fresh sign-in, which its SSO cookie
 * answers without asking for a password again.
 */
export async function refreshAccessToken(region: BlizzardRegion, refreshToken: string): Promise<BnetTokens> {
  const { clientId, clientSecret } = clientCredentials()

  return await callBnet<BnetTokens>(`https://${region}.battle.net/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  })
}

/**
 * Whether a failed renewal was *refused* rather than merely unlucky.
 *
 * The distinction is the whole point of this function, and the one thing a caller must not get wrong: a
 * refusal means the grant is dead - the client secret was rotated, Battle.net revoked the account, the reader
 * changed their password - and the only way forward is a fresh sign-in. A timeout, a DNS hiccup or a 5xx says
 * nothing about the grant at all, and a site that sent a reader to sign in again over one of those would be
 * blaming them for somebody else's outage.
 *
 * The token endpoint answers a dead grant with a 4xx carrying an OAuth error (`invalid_grant` and its
 * neighbours), so that is what is looked for: the body's own `error`, or a 401/403, which is a refusal
 * whatever the body says.
 */
export function isAuthRefused(error: unknown): boolean {
  const failure = error as
    | { response?: { status?: number }; statusCode?: number; data?: { error?: unknown } }
    | null
    | undefined

  if (!failure) return false

  const status = failure.response?.status ?? failure.statusCode ?? 0
  const said = typeof failure.data?.error === 'string' && failure.data.error.length > 0

  if (status === 401 || status === 403) return true
  return said && status >= 400 && status < 500
}

/** Who the token belongs to: the stable `sub`, the numeric `id` and the battletag. */
export async function getUserInfo(region: BlizzardRegion, accessToken: string): Promise<BnetUserInfo> {
  return await callBnet<BnetUserInfo>(`https://${region}.battle.net/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
}

/**
 * The account summary: the light call that names every character the account holds, and the one
 * Blizzard read a sign-in is allowed to wait for.
 */
export async function getAccountProfile(
  region: BlizzardRegion,
  accessToken: string,
  locale = 'en_US'
): Promise<AccountProfile> {
  return await callBnet<AccountProfile>(`https://${region}.api.blizzard.com/profile/user/wow`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    query: { namespace: `profile-${region}`, locale }
  })
}

/**
 * The collection kinds the game shares across a whole Battle.net account.
 *
 * Mounts, pets, toys and decor are the account's, not a character's - the game's own pane says so -
 * and these endpoints are the only place that answers the account's own number. They need the user
 * token, which is why a guest cannot read them and the character's own lists stand in.
 */
export const ACCOUNT_COLLECTION_KINDS = ['mounts', 'pets', 'toys', 'decor'] as const

export type AccountCollectionKind = (typeof ACCOUNT_COLLECTION_KINDS)[number]

/** One account-wide collection, as Blizzard answers it. */
export async function getAccountCollection(
  region: BlizzardRegion,
  accessToken: string,
  kind: AccountCollectionKind,
  locale = 'en_US'
): Promise<unknown> {
  return await callBnet<unknown>(`https://${region}.api.blizzard.com/profile/user/wow/collections/${kind}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    query: { namespace: `profile-${region}`, locale }
  })
}
