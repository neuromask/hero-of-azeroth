/**
 * Opens or closes the account's roster to other readers.
 *
 * Public means another visitor may see the main and the characters beside it; private means the
 * roster is the account's own and only the main is visible from outside - which is the state the
 * site has always been in, since a lookup was never more than one character. The main itself is
 * not hidden either way: naming a character the site already serves is what putting it in the
 * leaderboard means.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ isPublic?: boolean }>(event)

  if (typeof body?.isPublic !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'isPublic must be true or false' })
  }

  useDb().prepare('UPDATE users SET is_public = ? WHERE id = ?').run(body.isPublic ? 1 : 0, user.id)

  return { ok: true, isPublic: body.isPublic }
})
