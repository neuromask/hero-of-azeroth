/**
 * The profiles already fetched, keyed by the character and the language it was read in.
 *
 * A profile is a Blizzard lookup, which is the whole cost of answering a character page, so
 * an answer stays on hand for two hours and is revalidated behind the request that finds it
 * stale (see `server/utils/swrCache.ts`).
 */
// The reading this endpoint serves, named rather than left to the DOM's own `CharacterData`: the global is
// what this file used to be typed against, which is a document node rather than a character.
import type { CharacterData } from '~~/server/utils/blizzard'
import { apiLocale, mapBlizzardError, parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'
import { bumpProfileRevision } from '~~/server/utils/profileRevision'
// The tag every Blizzard call of this request carries - a page view, or the reader's own Refresh
// (`server/utils/blizzardSource`), which is what the panel cuts its API counters by.
import { characterReadSource, runWithBlizzardSource } from '~~/server/utils/blizzardSource'
import type { H3Event } from 'h3'

const profiles = createSwrCache<CharacterData>(2 * 60 * 60 * 1000)

export default defineEventHandler((event) =>
  runWithBlizzardSource(characterReadSource(parseBoolFlag(getQuery(event).force)), () => readCharacter(event))
)

/**
 * The read itself, under the tag its caller earned.
 *
 * `?force=true` is the Refresh button and is counted apart from an ordinary page view: it is the one public act
 * that spends the site's quota on purpose, and an operator reading the panel should be able to see how much of
 * the traffic was a person pressing a button rather than a crawler opening a page.
 */
async function readCharacter(event: H3Event) {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = apiLocale(query)
  // `?force=true` is the Refresh button: it skips the two hours of cache, waits for a fresh
  // Blizzard lookup and stores it, so the plain URL is answered from the new copy afterwards.
  const force = parseBoolFlag(query.force)

  // The one request that spends Blizzard's quota on purpose, charged to whoever asked for it before any of
  // the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)

  // The key this character's profile is cached under, kept so that the moment it was fetched can be read
  // back out of the cache afterwards (`fetchedAt`): the site's own record of the character is weighed
  // against that moment on the way out (`overlayPool`), and only the cache knows it.
  const key = `${region}:${locale}:${realm}:${name}`

  try {
    const character = await profiles(
      key,
      async () => {
        const profile = await getCharacter(realm, name, region, locale, force)

        // A lookup that came back with a character is the one moment the site learns a page exists, so it
        // is written down for the sitemap as the fresh copy is fetched - and what the profile says about
        // the character is written into the hall of fame at the same time, in one place and by the same
        // rule (`server/utils/profileFeed.ts`). `reading: true` is what also files this copy as the
        // character's own for the day: the record every other page's figures are computed from. Only a
        // lookup that really asked Blizzard files it, which is why the call out of the cache below does
        // not.
        await feedProfile({ region, realm, name, profile, reading: true })

        return profile
      },
      force
    )

    // A forced read is the one moment every shelf cached against the old profile stops being the answer: the
    // stamp below is folded into each shelf's own cache key, so a reader who refreshes and then opens a shelf
    // is served the shelf built from this fresh reading, not from the one up to two hours old.
    if (force) bumpProfileRevision(region, realm, name)

    // And the same feed stands here as well, on *every* request rather than only on a fresh lookup, which
    // is the whole point of it standing outside the cache above: a profile lives there for two hours, so a
    // character opened twice in an afternoon is one Blizzard lookup and two table updates - and that second
    // update is what fills in a record the sitemap's thinner index could only write half of. Both writes
    // are skipped when the record already says everything this profile does, so a reader who opens a page
    // the table already knows costs the disk nothing.
    //
    // What is fed is the reading, not what the reader is shown: what the site stores of a character is what
    // Blizzard said about them, and the account's own figures are laid over it on the way *out* instead
    // (`server/utils/accountPool`), by the same rule every page of the site answers with. Feeding the copy
    // would write a reader's view into the record the next reader's view is computed from.
    //
    // When Blizzard was actually asked for this profile: now, for a lookup just made, and up to two hours
    // ago for an answer handed out of the cache. The site's own record of the character is weighed against
    // it (`server/utils/accountPool`), so a page can never print an item level or a rating older than the
    // figures the rest of the site already holds - and a refreshed page prints what it just fetched.
    const readAt = profiles.fetchedAt(key) ?? nowSec()

    await feedProfile({ region, realm, name, profile: character })

    // The moment Blizzard was asked for this reading rides out with it (`fetchedAt`): a profile is answered
    // from a two-hour cache, so it is the only honest answer to "how old are these figures", which the
    // comparison board prints under each character's Refresh button.
    return { ...overlayPool(character, region, realm, name, readAt), fetchedAt: readAt }
  } catch (err) {
    mapBlizzardError(err, 'character')
  }
}
