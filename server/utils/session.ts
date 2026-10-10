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
  isPublic: boolean
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
  is_public: number
  access_token_enc: string | null
  refresh_token_enc: string | null
  access_token_expires_at: number | null
}

/** The sealed cookie's own settings: thirty days, httpOnly, secure, same-site lax. */
export function sessionConfig() {
  const config = useRuntimeConfig()
  return {
    name: 'hoa_session',
    password: String(config.sessionPassword || ''),
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
    isPublic: row.is_public === 1,
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
      `SELECT u.id, u.bnet_sub, u.battletag, u.main_character_id, u.is_public,
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
 * A usable access token for the account, or `null` when the reader has to sign in again.
 *
 * Battle.net does not hand out refresh tokens, so the usual path when the day is up is a fresh
 * sign-in - which its own SSO cookie (about thirty days) answers without asking for a password
 * again. A token endpoint that did answer a refresh token is honoured first, so the fallback is
 * only paid for where it is actually needed.
 */
export async function ensureAccessToken(user: SessionUser, region: BlizzardRegion): Promise<string | null> {
  const now = nowSec()
  if (user.accessToken && user.expiresAt && user.expiresAt - now > 60) return user.accessToken

  if (user.refreshToken) {
    try {
      const tokens = await refreshAccessToken(region, user.refreshToken)
      storeTokens(user.id, tokens)
      return tokens.access_token
    } catch {
      // A refresh the API refuses is the same as no refresh token at all: sign in again.
    }
  }

  return null
}
