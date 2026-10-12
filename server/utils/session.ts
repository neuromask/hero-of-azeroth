/**
 * Who a request is signed in as.
 *
 * The cookie carries only a session id and the two Battle.net facts a header prints; the tokens
 * themselves live in the database (see `./db`), so a session can be revoked by deleting one row
 * rather than by waiting for an encrypted blob to expire. h3 seals the cookie with
 * `NUXT_SESSION_PASSWORD` through iron, which is what makes it tamper-proof.
 *
 * The tokens themselves are stored twice on purpose: on the account (the durable copy the site
 * reads to refresh a page visit) and on the session (the copy that dies with the sign-out).
 */
import type { H3Event } from 'h3'
// A plain import rather than Nitro's auto-import: the environment in front of the frozen runtime config is a
// rule of `server/utils/runtimeEnv`, and importing it keeps this module working under the unit tests.
import { privateSetting } from './runtimeEnv'
// The one thing this module needs to know about a failed renewal, kept beside the call that fails.
import { isAuthRefused } from './bnetOAuth'
import type { BlizzardRegion } from './params'
import { nowSec } from './db'

/** The half of the session that is safe to keep in the cookie. */
export interface SessionData {
  sid?: string
  bnetSub?: string
  battletag?: string
  /** The OAuth `state` a login started with, kept until the callback returns. */
  oauthState?: string
  oauthRegion?: BlizzardRegion
  /** The region the account's token belongs to, which a later roster read has to name again. */
  region?: BlizzardRegion
}

/** Who a request belongs to, read back from the database. */
export interface SessionUser {
  id: number
  bnetSub: string
  battletag: string | null
  mainCharacterId: number | null
  /** Whether the account asked to be left out of the public table entirely. */
  hideFromFame: boolean
  /**
   * Whether the account's Battle.net sign-in stopped working.
   *
   * True once a renewal was refused (`isAuthRefused`), which is the state a page has to say out loud: the site
   * still holds everything it ever read, so nothing *looks* broken while the roster and the account's
   * collections stop moving. A sign-in clears it.
   */
  authExpired: boolean
  accessToken: string | null
  refreshToken: string | null
  /** When the stored access token stops being usable, as seconds since the epoch. */
  expiresAt: number | null
}

/** One row of the join the sign-in reads, as SQLite hands it back. */
interface UserRow {
  id: number
  bnet_sub: string
  battletag: string | null
  main_character_id: number | null
  hide_from_fame: number
  auth_expired: number
  access_token_enc: string | null
  refresh_token_enc: string | null
  access_token_expires_at: number | null
}

/** The sealed cookie's own settings: thirty days, httpOnly, secure, same-site lax. */
export function sessionConfig() {
  const config = useRuntimeConfig()
  return {
    name: 'hoa_session',
    // The environment first: the `.env` beside the server is read into it as the process starts, after Nitro
    // froze the copy this function is handed (`server/utils/runtimeEnv`). An empty key here is not a smaller
    // session, it is a sign-in that throws.
    password: privateSetting('NUXT_SESSION_PASSWORD', config.sessionPassword),
    maxAge: 60 * 60 * 24 * 30,
    cookie: { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' }
  }
}

/** A database row as the shape the rest of the server reads. */
function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    bnetSub: row.bnet_sub,
    battletag: row.battletag,
    mainCharacterId: row.main_character_id,
    hideFromFame: row.hide_from_fame === 1,
    authExpired: row.auth_expired === 1,
    accessToken: decryptToken(row.access_token_enc),
    refreshToken: decryptToken(row.refresh_token_enc),
    expiresAt: row.access_token_expires_at
  }
}

/**
 * The signed-in account for this request, or `null`.
 *
 * A cookie whose row is gone - a logout elsewhere, a cleared table - reads as nobody, and the
 * cookie is cleared so the next request does not ask again. The row's own expiry is the only
 * authority: a stolen cookie past it is worthless.
 */
export async function getCurrentUser(event: H3Event): Promise<SessionUser | null> {
  const session = await getSession<SessionData>(event, sessionConfig())
  if (!session.data.sid) return null

  const row = useDb()
    .prepare(
      `SELECT u.id, u.bnet_sub, u.battletag, u.main_character_id, u.hide_from_fame, u.auth_expired,
              u.access_token_enc, u.refresh_token_enc, u.access_token_expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ? AND s.expires_at > ?`
    )
    .get(session.data.sid, nowSec()) as UserRow | undefined

  if (!row) {
    await clearSession(event, sessionConfig())
    return null
  }

  return toSessionUser(row)
}

/** The same, refusing the request when nobody is signed in. */
export async function requireUser(event: H3Event): Promise<SessionUser> {
  const user = await getCurrentUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Sign in with Battle.net first' })
  return user
}

/**
 * The region the account's token was issued for.
 *
 * A user token only answers the region it came from, and the roster read has to name that region
 * long after the sign-in handshake - so the callback keeps it in the cookie rather than forgetting
 * it with the `state`.
 */
export async function getSessionRegion(event: H3Event): Promise<BlizzardRegion> {
  const session = await getSession<SessionData>(event, sessionConfig())
  return session.data.region === 'us' ? 'us' : 'eu'
}

/** Where a sign-in has to be repeated, which is what an unusable token turns into. */
export function signInPath(region: BlizzardRegion = 'eu'): string {
  return `/api/auth/login?region=${region}`
}

/**
 * Writes a freshly issued token pair onto the account.
 *
 * Shared by the callback and the (rare) refresh path so the two cannot store the pair differently.
 * The session copy is left alone: it names the sign-in, not the token, and the account is what a
 * later request reads through it.
 */
export function storeTokens(userId: number, tokens: { access_token: string; expires_in: number; refresh_token?: string }): void {
  useDb()
    .prepare(
      `UPDATE users
          SET access_token_enc = ?,
              refresh_token_enc = COALESCE(?, refresh_token_enc),
              access_token_expires_at = ?
        WHERE id = ?`
    )
    .run(encryptToken(tokens.access_token), encryptToken(tokens.refresh_token), nowSec() + tokens.expires_in, userId)
}

/**
 * Marks the account's sign-in as dead, or clears the mark.
 *
 * Written by the one place that can learn it (`ensureAccessToken`, when the token endpoint refuses a renewal)
 * and cleared by the one place that proves otherwise - a fresh sign-in, where a new pair of tokens is the proof
 * (`server/api/auth/callback.get.ts`). It lives on the account rather than in the session cookie on purpose: a
 * dead grant is a fact about the account, not about one browser, and the reader may well open the site
 * somewhere else and deserves the same answer there.
 */
export function markAuthExpired(userId: number, expired = true): void {
  useDb().prepare('UPDATE users SET auth_expired = ? WHERE id = ?').run(expired ? 1 : 0, userId)
}

/**
 * A usable access token for the account, or `null` when the reader has to sign in again.
 *
 * Battle.net does not hand out refresh tokens, so the usual path when the day is up is a fresh
 * sign-in - which its own SSO cookie (about thirty days) answers without asking for a password
 * again. A token endpoint that did answer a refresh token is honoured first, so the fallback is
 * only paid for where it is actually needed.
 *
 * A renewal the endpoint *refuses* is a different matter from a renewal that failed, and the two are told
 * apart by `isAuthRefused`: a refusal means the grant is dead and the account is marked as such
 * (`markAuthExpired`), so every page can say so instead of quietly serving a roster that stopped moving. A
 * deadline that timed out, a DNS hiccup, a 5xx - none of those say anything about the grant, and the account is
 * left exactly as it was for whoever asks next.
 *
 * An account already marked is answered without a call at all: nothing about it can have changed since the
 * refusal except a new sign-in, which is the reader's to make.
 */
export async function ensureAccessToken(user: SessionUser, region: BlizzardRegion): Promise<string | null> {
  if (user.authExpired) return null

  const now = nowSec()
  if (user.accessToken && user.expiresAt && user.expiresAt - now > 60) return user.accessToken

  if (user.refreshToken) {
    try {
      const tokens = await refreshAccessToken(region, user.refreshToken)
      storeTokens(user.id, tokens)
      return tokens.access_token
    } catch (error) {
      // A refusal is the reader's to fix and the site's to announce; anything else is nobody's fault and is
      // simply retried the next time a page asks.
      if (isAuthRefused(error)) markAuthExpired(user.id)
    }
  }

  return null
}
