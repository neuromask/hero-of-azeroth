/**
 * The appearances an account has unlocked, counted over every gear slot, for the tray of a character page.
 *
 * It is an endpoint of its own because it is the one figure of the six added beside the collections that a
 * character page cannot afford to carry: the document behind it is 2.5 MB (`getCharacterTransmogs` in
 * `server/utils/blizzard`), and a page read that paid for it would make every lookup of every character pay for
 * a number most readers never open the tray to see. So the page carries its five cheap neighbours and this
 * answers the sixth when the tray is opened - and the 2.5 MB is read at most once a day per character, kept in
 * the process's own memory by that reader (`cachedTransmogs`), because an appearance is unlocked by playing the
 * game rather than by a patch and a reader who opens the tray twice in one afternoon should be answered without
 * a second document.
 *
 * The answer itself is deliberately *not* cached by Nitro, although it is cheap: the handler is what files the
 * reading (`fileTransmogReading` below), and a cached answer is a handler that never runs - a character whose
 * wardrobe was read from a cache would hold a number in the row and no figure in the site's record, which is the
 * one thing this endpoint exists to prevent.
 *
 * A reading that failed answers `null` rather than zero: a wardrobe that could not be read and an empty one are
 * different answers, and only one of them is true.
 *
 * And a reading that succeeded is *filed* as the character's own (`fileTransmogReading` in
 * `server/utils/profileFeed`): this is the only place the wardrobe is ever read, so without that the figure a
 * reader has just looked at would be the one figure of the fourteen the site's record of them never holds - a
 * distribution could not place them by it, and a guest, whose profile no account's sync reads, would never have it
 * at all.
 */
import { getCharacterTransmogs } from '~~/server/utils/blizzard'
import { fileTransmogReading } from '~~/server/utils/profileFeed'

export default defineEventHandler(async (event) => {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  const count = await getCharacterTransmogs(realm, name, region)

  if (count !== null) fileTransmogReading(region, realm, name, count)

  return {
    /** Appearances unlocked across every gear slot, or `null` when the reading could not be taken. */
    count,
    /** The wardrobe belongs to the account, so this count is already the account's own. */
    accountWide: true
  }
})
