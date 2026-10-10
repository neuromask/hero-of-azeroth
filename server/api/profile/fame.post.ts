/**
 * Whether the account's row is published in the Hall of Fame.
 *
 * The table is the site's one public surface, and it shows exactly one character per account - the
 * main - which is what makes this a switch of its own rather than part of the privacy setting: a
 * reader who wants out of the table is asking for their main to be left out, and that is a different
 * question from who may see the roster beside it.
 *
 * Both halves of the rule are honoured by the one module that owns it
 * (`server/utils/leaderboardExclusions`): a character kept out is neither written into the table nor
 * served from the row that an earlier visit may have left there. Its memo is dropped here, so the
 * choice is visible on the very next read of the table rather than a minute later.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ hideFromFame?: boolean }>(event)

  if (typeof body?.hideFromFame !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'hideFromFame must be true or false' })
  }

  useDb().prepare('UPDATE users SET hide_from_fame = ? WHERE id = ?').run(body.hideFromFame ? 1 : 0, user.id)

  clearLeaderboardExclusions()

  return { ok: true, hideFromFame: body.hideFromFame }
})
