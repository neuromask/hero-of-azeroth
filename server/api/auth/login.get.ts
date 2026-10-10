/**
 * Sends the reader to Battle.net to approve the sign-in.
 *
 * The `state` is minted here and kept in the sealed cookie, so the callback can prove the code it
 * is handed belongs to a flow this browser started; the region is kept beside it, because an EU
 * token only answers EU endpoints.
 */
import { randomBytes } from 'node:crypto'
import type { BlizzardRegion } from '~~/server/utils/params'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const region: BlizzardRegion = query.region === 'us' ? 'us' : 'eu'
  const state = randomBytes(24).toString('base64url')

  await updateSession(event, sessionConfig(), { oauthState: state, oauthRegion: region })

  return sendRedirect(event, authorizeUrl(event, region, state))
})
