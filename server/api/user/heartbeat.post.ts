/**
 * The presence heartbeat of a signed-in reader: one POST a minute while a tab is open and visible
 * (`app/composables/presence.ts`, started once for the whole site by `app/plugins/presence.client.ts`),
 * which is all it takes to be marked as being on the site in the hall of fame
 * (see `server/utils/presence.ts`).
 *
 * It writes one column of one row, so it is answered with the one thing the caller needs to keep its own
 * timing honest - the window its beat is good for - and with nothing that anybody may cache: a beat served
 * from a cache is a beat that never happened, which is why this answer is `no-store`. A caller who is not
 * signed in is refused rather than quietly answered, because there is no account for the beat to belong to.
 *
 * The one thing it deliberately does not touch is `characters.last_seen_at`: that column is when a
 * character was last read into the site's table, a fact about the data rather than about a reader.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  setHeader(event, 'cache-control', 'no-store')
  touchPresence(user.id)

  return { online: true, window: PRESENCE_WINDOW_SECONDS, at: nowSec() }
})
