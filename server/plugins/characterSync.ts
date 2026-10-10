/**
 * Fills in the stats a sign-in could not wait for, on a timer.
 *
 * The sign-in writes names, not figures: an account with thirty alts is one light account summary
 * at sign-in, and everything expensive - item level, M+ rating, collections - is left to this pass
 * and to the profile page's own on-demand read (`server/api/profile/sync.post.ts`). A handful of
 * characters every few minutes is what keeps the work off every request path while still filling a
 * roster in on its own.
 *
 * It is a plugin rather than a Nitro task because the built `node-server` is what actually runs on
 * the host: a plugin's timer needs no scheduler, no external cron and no task runtime, and
 * `unref` keeps it from holding the process open on its own. A pass that throws is retried on the
 * next tick - a background refresh that fails is a stale row, not a broken site.
 */
const SYNC_INTERVAL_MS = 3 * 60 * 1000

/** How many characters one pass reads, so a burst of Blizzard calls is never sent at once. */
const SYNC_BATCH = 10

export default defineNitroPlugin(() => {
  let running = false

  const timer = setInterval(async () => {
    if (running) return
    running = true

    try {
      await syncDueCharacters(SYNC_BATCH)
    } catch {
      // Left for the next pass.
    } finally {
      running = false
    }
  }, SYNC_INTERVAL_MS)

  // The timer must never be the reason the process stays up by itself.
  timer.unref?.()
})
