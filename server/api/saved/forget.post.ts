/**
 * The cross in the list: one character goes, from both halves of it at once.
 *
 * The row may be there because the character was looked up, because it was starred, or because of both - and
 * the cross means "not this one any more" rather than "not in this half of the list" (the rule the field's own
 * `removeHistory` states, `app/components/CharacterSearchForm.vue`), so the whole row is what goes.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const entry = readSavedEntry(await readBody(event))

  if (!entry) throw createError({ statusCode: 400, statusMessage: 'A character, a realm and a region are required' })

  forgetSavedCharacter(user.id, entry)

  return { ok: true }
})
