/**
 * Names the character an account leads with.
 *
 * Exactly one character per account is the main, and it is the only one the public leaderboard
 * shows (see `server/utils/leaderboardExclusions`): the rest remain personal stats, beside their
 * siblings on the profile. The two writes - the flag on the characters and the pointer on the
 * account - are one intention, so they are one statement each inside a transaction.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ characterId?: number }>(event)
  const characterId = Number(body?.characterId)

  if (!Number.isInteger(characterId)) {
    throw createError({ statusCode: 400, statusMessage: 'characterId is required' })
  }

  const db = useDb()
  const owned = db
    .prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?')
    .get(characterId, user.id) as { id: number } | undefined

  if (!owned) {
    throw createError({ statusCode: 404, statusMessage: 'That character is not on your account' })
  }

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE characters SET is_main = 0 WHERE user_id = ?').run(user.id)
    db.prepare('UPDATE characters SET is_main = 1 WHERE id = ? AND user_id = ?').run(characterId, user.id)
    db.prepare('UPDATE users SET main_character_id = ? WHERE id = ?').run(characterId, user.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  // The table's own view of who is excluded is a minute old at most; a main that just changed
  // must not wait for it.
  clearLeaderboardExclusions()

  return { ok: true, mainCharacterId: characterId }
})
