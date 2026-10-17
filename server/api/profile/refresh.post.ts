/**
 * Re-reads the account's roster on demand.
 *
 * The sign-in reads it once, and a roster that came back empty - a privacy setting that was off at
 * the time, a lookup that failed while the reader was being redirected - has no other way back in
 * without signing out and in again. This is that way: it spends one Battle.net call and reports what
 * the account summary actually carried, which is what the page needs to explain an empty grid.
 *
 * Read-only against Blizzard, and idempotent against SQLite: the same upsert the callback runs.
 */
import { debugLog } from '~~/server/utils/logger'
// The account's roster and its collections are read for the account, not for a character: their Blizzard calls are
// counted under `account_refresh`, so the panel can tell a reader's own refresh from the timer's work.
import { runWithBlizzardSource } from '~~/server/utils/blizzardSource'
import type { H3Event } from 'h3'

export default defineEventHandler((event) =>
  runWithBlizzardSource('account_refresh', () => refreshRoster(event))
)

/** The roster read itself, under the tag of the account that asked for it. */
async function refreshRoster(event: H3Event) {
  const user = await requireUser(event)
  const region = await getSessionRegion(event)

  const accessToken = await ensureAccessToken(user, region)
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: 'Your Battle.net session expired. Please sign in again.' })
  }

  const locale = (getQuery(event).locale as string) || 'en_US'
  const result = await upsertAccountCharacters(user.id, region, accessToken, locale)

  // A roster that moved changes what the table draws - an account appears in it as the character it leads with,
  // and every one of its characters now shows the account's own figures - so its row is rewritten here rather than
  // when a reader's cached answer happens to expire (`server/utils/leaderboardRows`).
  refreshAccountRow(user.id)

  // The account's own collections ride along: they are what the totals block is read from, and a
  // refresh that only re-read the roster would leave those numbers on the best character.
  let collections: Record<string, number | null> | null = null
  try {
    collections = await syncAccountCollections(user.id, region, accessToken, locale)
  } catch (error: any) {
    console.error('[profile/refresh] collections read failed:', error?.data || error?.message || error)
  }

  debugLog('[profile/refresh] roster', JSON.stringify(result))
  return { ...result, collections }
}
