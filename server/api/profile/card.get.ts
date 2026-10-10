/**
 * The account's card: the main's own card, carrying the account's own numbers.
 *
 * A card is drawn from a character, because a card needs a face - the render, the class, the title.
 * What it must not do is report that character's collections as the account's: a WoW collection is
 * shared across the whole Battle.net account, and a character's own mount list is faction-limited on
 * top of that. So the main is the picture and the account's pool (see `server/utils/accountPool`)
 * is the figures, which is what a reader who downloads or shares this expects to be showing off.
 *
 * Served as a JPEG with no shared cache: it is a signed-in reader's own card, and it has to move the
 * moment they refresh their roster.
 */
import type { CharacterData } from '~~/server/utils/blizzard'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const locale = getQuery(event).locale === 'ru_RU' ? 'ru_RU' : 'en_US'

  // The character the card is drawn from: the account's main, or the strongest it has until one is
  // named - exactly the character the profile page leads with.
  const row = useDb()
    .prepare(
      `SELECT region, realm_slug, name_key
         FROM characters
        WHERE user_id = ?
        ORDER BY is_main DESC, COALESCE(level, 0) DESC, name ASC
        LIMIT 1`
    )
    .get(user.id) as { region: string; realm_slug: string; name_key: string } | undefined

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'There is no character to draw a card for yet' })
  }

  const profile = (await getCharacter(row.realm_slug, row.name_key, row.region, locale)) as CharacterData

  // The picture is the main's; the figures are the account's. `overlayPool` is the same rule every
  // character page keeps, so the card, the page and the profile tiles can never disagree about what
  // the account owns.
  overlayPool(profile, row.region, row.realm_slug, row.name_key)

  setHeader(event, 'Content-Type', 'image/jpeg')
  setHeader(event, 'Cache-Control', 'private, no-store')

  return await renderCharacterCard(profile, locale)
})
