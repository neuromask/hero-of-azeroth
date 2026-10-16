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
 * `unref` keeps it from holding the process open on its own.
 *
 * This is not a queue, and it says so: there is no task list and no backlog - the pass simply reads the
 * characters whose newest reading is missing or a day old, ten at a time, and the next tick takes the next ten.
 * What the timer *does* keep is the pass's own state, in the diagnostics module (`server/utils/adminDiagnostics`):
 * whether a pass is running, what started it, and how many characters it read, moved, found unchanged and
 * failed on. The panel prints exactly that, and never a "queue length" there is nothing behind.
 *
 * The claim (`beginSyncPass`, taken by `runSyncPass`) is shared with the on-demand run, so a page asking for its
 * roster while the timer is mid-pass is *refused* rather than given a second pass over the same characters: one
 * claim, one pass, whichever of the two asked for it.
 */
import { SYNC_BATCH, SYNC_INTERVAL_MS } from '#shared/data/adminDiagnostics'

export default defineNitroPlugin(() => {
  const timer = setInterval(() => {
    // The pass takes the claim itself, and answers `null` when one is already running - the timer's own or a
    // page's - which is the whole of what this tick has to do in that case.
    //
    // The tick is counted either way (`recordTimerTick`), and that is a deliberate addition rather than
    // bookkeeping: a pass that never ran because the timer never fired and a pass that was refused because the
    // previous one was still running look *identical* in a count of passes, and they are entirely different
    // incidents - one is a stalled event loop, the other is a pass that has hung. The panel now prints both
    // numbers, so the next operator does not have to infer which one they are looking at.
    //
    // The `catch` is not decoration. A rejected promise nobody handles is, since Node 15, a process that *dies*
    // - and this is the one promise in the site that nothing awaits. A pass that cannot even be started is
    // therefore filed and the timer left running, rather than taking the whole site down with it on a tick
    // nobody was watching.
    void runSyncPass('timer', SYNC_BATCH)
      .then((counters) => recordTimerTick(counters === null))
      .catch(() => {
        recordDiagnostic({ level: 'error', category: 'sync', message: 'background sync pass could not be started' })
      })
  }, SYNC_INTERVAL_MS)

  // The timer must never be the reason the process stays up by itself.
  timer.unref?.()
})
