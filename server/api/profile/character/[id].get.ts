/**
 * One character's live stats, paid for the first time it is actually looked at.
 *
 * The stored row is the address; the figures come from the site's own public character reader,
 * which is why loading an alt costs what a guest lookup costs and needs no user token. What is read
 * is written as one snapshot for the day, so the account's aggregate grows a history rather than a
 * single reading - and the second click on the same character is served from the site's two-hour
 * profile cache by the reader below.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = Number(getRouterParam(event, 'id'))
  const locale = (getQuery(event).locale as string) || 'en_US'

  if (!Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'A character id is required' })
  }

  const row = useDb()
    .prepare('SELECT id, user_id, region, realm_slug, name, name_key FROM characters WHERE id = ? AND user_id = ?')
    .get(id, user.id) as CharacterRow | undefined

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'That character is not on your account' })
  }

  return await refreshCharacterStats(row, locale)
})
