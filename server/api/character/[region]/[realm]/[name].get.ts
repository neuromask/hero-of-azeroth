/**
 * The profiles already fetched, keyed by the character and the language it was read in.
 *
 * A profile is a Blizzard lookup, which is the whole cost of answering a character page, so
 * an answer stays on hand for two hours and is revalidated behind the request that finds it
 * stale (see `server/utils/swrCache.ts`).
 */
const profiles = createSwrCache<CharacterData>(2 * 60 * 60 * 1000)

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  // `?force=true` is the Refresh button: it skips the two hours of cache, waits for a fresh
  // Blizzard lookup and stores it, so the plain URL is answered from the new copy afterwards.
  const force = query.force === 'true' || query.force === '1'

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  try {
    const character = await profiles(
      `${region}:${locale}:${realm}:${name}`,
      async () => {
        const profile = await getCharacter(realm, name, region, locale)

        // A lookup that came back with a character is the one moment the site learns a page
        // exists, so it is written down for the sitemap as the fresh copy is fetched (see
        // `server/utils/characterIndex.ts`). What the profile says about the character rides along:
        // the map a browser paints is a page about who has been looked up, and what they were.
        await rememberCharacter({
          region,
          realm,
          name,
          displayName: profile.name,
          level: profile.level,
          classId: profile.classId,
          ilvl: profile.ilvl,
          mPlusScore: profile.mPlusScore,
          mounts: profile.stats.mounts.count
        })

        return profile
      },
      force
    )

    // The leaderboard is fed on *every* request, not only on a fresh lookup, and that is the whole
    // point of this call standing outside the cache above. A profile lives there for two hours, so a
    // character opened twice in an afternoon is one Blizzard lookup and two table updates - and that
    // second update is what fills in a record the sitemap's thinner index could only write half of
    // (`server/utils/leaderboardStorage.ts`). The write is skipped when the record already says
    // everything this profile does, so a reader who opens a page the table already knows costs the
    // disk nothing at all.
    await upsertPlayer({
      region,
      realm,
      realmName: character.realm,
      name,
      displayName: character.name,
      avatar: character.avatarUrl,
      classId: character.classId,
      faction: character.faction,
      level: character.level,
      ilvl: character.ilvl,
      mPlusScore: character.mPlusScore,
      mounts: character.stats.mounts.count,
      pets: character.stats.pets.count,
      toys: character.stats.toys.count,
      decor: character.stats.decor.count,
      achievements: character.ap
    })

    return character
  } catch (err: any) {
    if (err.statusCode) throw err
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to fetch character from Blizzard API'
    })
  }
})
