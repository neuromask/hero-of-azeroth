/**
 * A search that found its character, recorded on the account rather than in the browser that ran it.
 *
 * It is the same fact a character's own page writes for itself (`app/pages/[region]/[realm]/[name].vue`) and
 * the comparison board writes for the character in its second column (`app/components/CharacterVersus.vue`):
 * a read that succeeded. A miss never reaches this endpoint, which is what keeps the list a record of
 * successes rather than of tries - and it is a write of its own rather than a side effect of the read,
 * because a signed-out reader's list is still the browser's own (`app/composables/searchHistory.ts`).
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const entry = readSavedEntry(await readBody(event))

  if (!entry) throw createError({ statusCode: 400, statusMessage: 'A character, a realm and a region are required' })

  rememberSavedCharacter(user.id, entry)

  return { ok: true }
})
