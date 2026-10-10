/**
 * Signs the reader out: the row goes, so the cookie that names it is worthless.
 *
 * The account itself - and the tokens its profile still needs - stays: signing out ends a browser
 * session, not the connection between the site and the Battle.net account.
 */
import type { SessionData } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const session = await getSession<SessionData>(event, sessionConfig())

  if (session.data.sid) {
    useDb().prepare('DELETE FROM sessions WHERE id = ?').run(session.data.sid)
  }

  await clearSession(event, sessionConfig())
  return sendRedirect(event, localeRedirect(event, '/'))
})
