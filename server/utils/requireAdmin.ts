/**
 * Who may touch the panel, asked once so every one of its endpoints asks it the same way.
 *
 * The site's authorization already exists and is deliberately small: a reader signs in with Battle.net
 * (`requireUser`, `./session`) and the accounts the site lists as administrators are the ones whose BattleTag
 * `isAdmin` (`./siteSettings`) answers true for. This module adds no second system - no token, no password, no
 * roles table - it only gives the panel's endpoints one spelling of the same two questions, so a new endpoint
 * cannot forget one of them.
 *
 * The order matters and is the honest one: no session is a `401` (sign in), a session that is not an
 * administrator is a `403` (you are somebody, just not somebody who may move this site's numbers).
 *
 * `assertSameOrigin` is the other half: a state-changing request is checked against the browser's own `Origin`
 * header, which no cross-site form can forge. The site has no CSRF token - inventing one would be a second
 * mechanism beside the session cookie - so this is the guard that is compatible with what it already does:
 * the session cookie is `SameSite=Lax` and httpOnly (`./session`), and this refuses the one case Lax does not
 * cover for a POST from a sibling origin (a subdomain, or a page that got the user to open it).
 */
import type { H3Event } from 'h3'
import { recordDiagnostic } from './adminDiagnostics'
import { requireUser, type SessionUser } from './session'
import { isAdmin } from './siteSettings'

/**
 * Refuses a request that did not come from this site's own pages.
 *
 * A request with no `Origin` at all - a server-side call, a script, a `curl` - is let through and answered by
 * the session check that follows it: the header is a statement a browser makes about itself, and this guard is
 * only ever asked to catch a browser that made it and named somebody else.
 */
export function assertSameOrigin(event: H3Event): void {
  const origin = getRequestHeader(event, 'origin')
  if (!origin) return

  const host = getRequestHeader(event, 'host')

  let originHost = ''
  try {
    originHost = new URL(origin).host
  } catch {
    // An `Origin` that is not a URL is not a request any page of this site makes.
    originHost = ''
  }

  if (!originHost || !host || originHost !== host) {
    recordDiagnostic({ level: 'warn', category: 'admin', message: 'cross-origin admin request refused' })
    throw createError({ statusCode: 403, statusMessage: 'Cross-origin request refused' })
  }
}

/**
 * The signed-in administrator, or a refusal.
 *
 * A sign-in that is missing is a `401`; a sign-in that is not an administrator is a `403`, and the refusal is
 * filed in the diagnostics log - without the BattleTag, which is a name and not something a panel needs to
 * print to say "somebody was refused".
 */
export async function requireAdmin(event: H3Event): Promise<SessionUser> {
  const user = await requireUser(event)

  if (!isAdmin(user.battletag)) {
    recordDiagnostic({ level: 'warn', category: 'admin', message: 'admin access refused' })
    throw createError({ statusCode: 403, statusMessage: 'Administrators only' })
  }

  return user
}

/** The same two questions for an action that will write, with the origin check in front of them. */
export async function requireAdminAction(event: H3Event): Promise<SessionUser> {
  assertSameOrigin(event)
  return requireAdmin(event)
}
