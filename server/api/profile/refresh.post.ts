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
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const region = await getSessionRegion(event)

  const accessToken = await ensureAccessToken(user, region)
  if (!accessToken) {
    throw createError({ statusCode: 401, statusMessage: 'Your Battle.net session expired. Please sign in again.' })
  }

  const locale = (getQuery(event).locale as string) || 'en_US'
  const result = await upsertAccountCharacters(user.id, region, accessToken, locale)

  // The account's own collections ride along: they are what the totals block is read from, and a
  // refresh that only re-read the roster would leave those numbers on the best character.
  let collections: Record<string, number | null> | null = null
  try {
    collections = await syncAccountCollections(user.id, region, accessToken, locale)
  } catch (error: any) {
    console.error('[profile/refresh] collections read failed:', error?.data || error?.message || error)
  }

  console.log('[profile/refresh] roster', JSON.stringify(result))
  return { ...result, collections }
})
