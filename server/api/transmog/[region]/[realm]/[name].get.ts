/**
 * The appearances an account has unlocked, counted over every gear slot, for the tray of a character page.
 *
 * It is an endpoint of its own because it is the one figure of the six added beside the collections that a
 * character page cannot afford to carry: the document behind it is 2.5 MB (`getCharacterTransmogs` in
 * `server/utils/blizzard`), and a page read that paid for it would make every lookup of every character pay for
 * a number most readers never open the tray to see. So the page carries its five cheap neighbours and this
 * answers the sixth when the tray is opened - which is also why it is cached for a day, hard: an appearance is
 * unlocked by playing the game, not by a patch, and the reading is the account's own (the wardrobe is the
 * account's, see `CountStat`), so a day of freshness is a day of the same number.
 *
 * A reading that failed answers `null` rather than zero: a wardrobe that could not be read and an empty one are
 * different answers, and only one of them is true.
 */
import { getCharacterTransmogs } from '~~/server/utils/blizzard'

export default defineCachedEventHandler(
  async (event) => {
    const region = parseRegion(getRouterParam(event, 'region'))
    const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
    const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()

    if (!realm || !name) {
      throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
    }

    const count = await getCharacterTransmogs(realm, name, region)

    return {
      /** Appearances unlocked across every gear slot, or `null` when the reading could not be taken. */
      count,
      /** The wardrobe belongs to the account, so this count is already the account's own. */
      accountWide: true
    }
  },
  {
    // A day, and no stale-while-revalidate: the figure moves by handfuls and a reader who opens the tray twice
    // in one afternoon should be answered from memory rather than with a second 2.5 MB read.
    maxAge: 24 * 60 * 60,
    swr: false
  }
)
