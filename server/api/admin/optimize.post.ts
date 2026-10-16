/**
 * Runs SQLite's own `PRAGMA optimize`, once, because an administrator pressed the button.
 *
 * The pragma is the lightest maintenance this database has (`optimizeDatabase`, `server/utils/adminActions`):
 * it refreshes the planner statistics a hot index suggests are stale, it never rewrites the file and it cannot
 * be made to run long by anything a request says. Nothing here runs it on a schedule, on a page load or on any
 * other trigger - the only caller is a person, and the panel makes them confirm it first.
 *
 * The gate is `requireAdminAction`: a session that is an administrator (`401`/`403` otherwise) *and* a POST
 * whose `Origin` is this site's own. The operation takes the same single slot a manual character refresh takes,
 * so the two cannot run at once, and both the press and its outcome are filed for the panel without anything
 * of the database's own structure travelling to the client.
 */

/** The name this endpoint takes in the single manual-operation slot both maintenance actions share. */
const MANUAL_OPERATION = 'database-optimize'

export default defineEventHandler(async (event) => {
  await requireAdminAction(event)

  if (!claimManualOperation(MANUAL_OPERATION)) {
    throw createError({ statusCode: 409, statusMessage: 'Another maintenance operation is already running' })
  }

  try {
    const { durationMs } = optimizeDatabase()

    recordDiagnostic({ level: 'info', category: 'admin', message: 'database optimize finished' })
    // The panel is about to be asked what the process is doing, and this is a thing it just did.
    invalidateDiagnosticsCache()

    return { ok: true, durationMs, at: Math.floor(Date.now() / 1000) }
  } catch {
    // A failure here is the database's problem rather than the caller's, so it is reported as one - and the
    // error text itself is not passed on: it can name a file, and the client has no business seeing either.
    recordDiagnostic({ level: 'error', category: 'database', message: 'database optimize failed' })
    throw createError({ statusCode: 500, statusMessage: 'The database maintenance step failed' })
  } finally {
    releaseManualOperation(MANUAL_OPERATION)
  }
})
