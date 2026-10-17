/**
 * The cards already rendered, keyed by the character and the language they were drawn in.
 *
 * A card is the expensive half of a request - a Blizzard lookup, two images over the network
 * and a rasteriser pass - so one that has just been drawn is handed to the next caller rather
 * than drawn again, for two hours (see `server/utils/swrCache.ts`). A `?force=true` request,
 * which the header's Refresh button sends, waits for a freshly drawn card instead.
 */
import { parseBoolFlag, readCharacterRoute } from '~~/server/utils/characterRoute'
// A card's Blizzard lookups are counted as the card's own, so the panel can tell a preview crawler's traffic from
// a reader's page view (`server/utils/blizzardSource`).
import { runWithBlizzardSource } from '~~/server/utils/blizzardSource'

const cards = createSwrCache<Buffer>(2 * 60 * 60 * 1000, 256)

export default defineEventHandler(async (event) => {
  const { region, realm, name } = readCharacterRoute(event)
  const query = getQuery(event)
  const locale = query.locale === 'ru_RU' ? 'ru_RU' : 'en_US'
  const force = parseBoolFlag(query.force)

  // A forced refresh spends Blizzard's quota on purpose, so it is charged to whoever asked for it before any
  // of the work happens (`server/utils/refreshBudget`); a refusal is a 429 with a `Retry-After`.
  if (force) requireRefreshBudget(event, region, realm, name)

  // The card is a picture with photographs in it, so it is written and served as a JPEG: a
  // chat network's crawler fetches an `og:image` on a deadline of a couple of seconds, and
  // the bytes it has to pull inside that deadline are half of whether the preview appears.
  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'public, max-age=3600, s-maxage=86400')

  return cards(
    `${region}:${locale}:${realm}:${name}`,
    async () => {
      // The reading is the card's own even when the reader pressed Refresh: a card is drawn for a preview and
      // for a shared link, and the panel answers "how much traffic is cards" with one number.
      const character = await runWithBlizzardSource('card_render', () => getCharacter(realm, name, region, locale, force))

      // The card is drawn from a profile, and reading a profile is what the site learns a character
      // from - so a card is fed into the sitemap's index, into the hall of fame's table, and, as
      // `reading: true`, into the character's own record for the day: the figures every page of the site
      // computes its numbers from (`server/utils/characterReading`). It is fed before the account's
      // figures are laid over it on purpose, so what is filed is what Blizzard said about the character
      // rather than the account's union - the same reading the background pass files, which is what keeps
      // the two writers of one day's row writing the same thing.
      //
      // It is the feed the card used to be missing: a row backfilled from the index - which keeps no
      // portrait and no faction - stayed half-empty for a character whose card had been drawn a hundred
      // times, because the only reader that filled it in was the character page itself. The writes are
      // skipped when a record already says everything this profile does, so drawing a card the table
      // knows costs no disk.
      await feedProfile({ region, realm, name, profile: character, reading: true })

      // And what the card is drawn from: the same reading, with the account's own figures laid over it by
      // the site's one rule. The overlay returns a copy (`server/utils/accountPool`), so the drawing can
      // never write a reader's view back into the reading filed above.
      return renderCharacterCard(overlayPool(character, region, realm, name), locale)
    },
    force
  )
})
