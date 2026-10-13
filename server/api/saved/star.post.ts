/**
 * The star on a remembered character: saved for a quick compare, or dropped from that list again.
 *
 * `starred` is required, and it is taken as it was sent rather than toggled here - the browser knows which
 * way the reader pressed, while a toggle would make the answer depend on how many times a request arrived.
 */
import { toSearchHistoryEntry } from '#shared/utils/savedCharacters'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ entry?: unknown; starred?: unknown }>(event)
  const entry = toSearchHistoryEntry(body?.entry)

  if (!entry) throw createError({ statusCode: 400, statusMessage: 'A character, a realm and a region are required' })
  if (typeof body?.starred !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'starred is required' })
  }

  setSavedCharacterStar(user.id, entry, body.starred)

  return { ok: true }
})
