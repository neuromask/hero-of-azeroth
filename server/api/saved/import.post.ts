/**
 * The one hand-over: the lists a browser had been keeping for itself, given to the account that has just
 * signed in on it.
 *
 * It happens once per browser and per account (`SAVED_ACCOUNT_KEY`, `#shared/utils/savedCharacters`), which is
 * why a whole list arrives here rather than one character at a time - and why the browser's copy is adopted as
 * the account's afterwards instead of being thrown away, so a reader who signs out still finds the list they
 * had, exactly where they left it.
 *
 * Entries that are not the shape the site writes are dropped rather than the request refused: the rest of a
 * browser's list is worth keeping even when one row in it is not. Nothing here comes from a field a reader is
 * typing in, so a bad row is a stale write from an older build rather than an answer to be corrected.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readBody<{ starred?: unknown; recent?: unknown }>(event)

  importSavedCharacters(user.id, {
    starred: readSavedList(body?.starred),
    recent: readSavedList(body?.recent)
  })

  return { ok: true }
})
