/**
 * What Battle.net sends the reader back to: the code traded for their token, and the account
 * written down.
 *
 * Deliberately quick. The callback makes exactly two Battle.net calls - the token exchange and the
 * account summary - and writes what they said before redirecting to the profile. Anything that
 * costs a call per character (item level, M+, collections) is left to the profile page and to the
 * background task (`server/tasks/sync-characters.ts`), because an account with thirty alts would
 * otherwise hold the callback open until the gateway gave up on it.
 */
import { randomUUID } from 'node:crypto'
import type { BlizzardRegion } from '~~/server/utils/params'
import type { SessionData } from '~~/server/utils/session'

/** How long the sign-in survives before it has to be repeated. */
const SESSION_SECONDS = 60 * 60 * 24 * 30

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const session = await getSession<SessionData>(event, sessionConfig())

  const code = typeof query.code === 'string' ? query.code : ''
  const state = typeof query.state === 'string' ? query.state : ''
  const region: BlizzardRegion = session.data.oauthRegion === 'us' ? 'us' : 'eu'

  // A flow that did not start here, or a reader who declined: back to the front page.
  if (!code || !state || !session.data.oauthState || state !== session.data.oauthState) {
    return sendRedirect(event, localeRedirect(event, '/'))
  }

  try {
    const tokens = await exchangeCode(event, region, code)
    const info = await getUserInfo(region, tokens.access_token)
    const now = nowSec()
    const db = useDb()

    // The account is created on the first sign-in and refreshed on every later one. The token
    // fields are re-sealed on each pass, because a fresh pair arrives on every sign-in; the
    // account's own settings (main character, privacy) are left where the reader put them.
    db.prepare(
      `INSERT INTO users
         (bnet_sub, battletag, access_token_enc, refresh_token_enc, access_token_expires_at, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(bnet_sub) DO UPDATE SET
         battletag = excluded.battletag,
         access_token_enc = excluded.access_token_enc,
         refresh_token_enc = COALESCE(excluded.refresh_token_enc, users.refresh_token_enc),
         access_token_expires_at = excluded.access_token_expires_at,
         last_login_at = excluded.last_login_at`
    ).run(
      info.sub,
      info.battletag || null,
      encryptToken(tokens.access_token),
      encryptToken(tokens.refresh_token),
      now + tokens.expires_in,
      now,
      now
    )

    const user = db.prepare('SELECT id FROM users WHERE bnet_sub = ?').get(info.sub) as { id: number }

    // The session row the cookie names: its own id, thirty days of life, the token kept beside it.
    const sid = randomUUID()
    db.prepare('INSERT INTO sessions (id, user_id, token_enc, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(sid, user.id, encryptToken(tokens.access_token), now + SESSION_SECONDS, now)

    // The light account summary: the whole point of the callback, and its only per-account cost.
    // A roster that cannot be read - a privacy setting on the Battle.net account, an API hiccup -
    // never fails the sign-in: the reader lands on their profile, where the roster's own button
    // retries it, and the log says what came back.
    try {
      const sync = await upsertAccountCharacters(user.id, region, tokens.access_token)
      console.log('[auth/callback] roster', JSON.stringify(sync))
    } catch (syncError: any) {
      console.error('[auth/callback] roster read failed:', syncError?.data || syncError?.message || syncError)
    }

    // And the account's own collections, which is what the profile's totals are read from: they are
    // the account's, not a character's, so this is the one place the true numbers come from.
    try {
      await syncAccountCollections(user.id, region, tokens.access_token)
    } catch (collectionsError: any) {
      console.error(
        '[auth/callback] collections read failed:',
        collectionsError?.data || collectionsError?.message || collectionsError
      )
    }

    // The cookie now names the sign-in, keeps the account's region for the later roster reads, and
    // forgets the OAuth handshake it carried.
    await updateSession(event, sessionConfig(), {
      sid,
      bnetSub: info.sub,
      battletag: info.battletag,
      region,
      oauthState: undefined,
      oauthRegion: undefined
    })

    return sendRedirect(event, localeRedirect(event, '/profile'))
  } catch (err: any) {
    console.error('[auth/callback] failed:', err?.data || err?.message || err)
    return sendRedirect(event, localeRedirect(event, '/?auth=error'))
  }
})
