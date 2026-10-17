/**
 * Runs the statistics migration once, at startup.
 *
 * It is what moves the hall of fame's own table into the database and gives every account its first point of
 * history (`server/utils/statisticsMigration`). A site that has never had a table, or one that has already been
 * moved, costs a single file read that finds nothing.
 *
 * Deliberately not awaited: a plugin body is synchronous, and nothing the site serves while this runs is wrong -
 * it is a database that holds what it held a moment ago. A failure is logged rather than thrown, and the next
 * start tries again; the tables it writes are the ones the site reads, so a migration that half-ran leaves
 * characters it had already filed, which is the state a second run starts from.
 *
 * The table the hall of fame is read from is built in the same pass, and building it is one transaction
 * (`rebuildPopulation` in `server/utils/leaderboardRows`): a page read while this runs is answered from the table
 * as it was, never from half of it.
 */
import { recordDiagnostic } from '../utils/adminDiagnostics'

import { runWithBlizzardSource } from '../utils/blizzardSource'

export default defineNitroPlugin(() => {
  // The migration and the rebuild read SQLite and the old JSON table only. The tag is what would make a Blizzard
  // request added here later visible as startup work rather than as `other`.
  runWithBlizzardSource('startup', () => migrateStatistics())
    .then((moved) => {
      // A file that is there and could not be read is reported as itself: the site keeps serving what the
      // database already holds, and whoever runs it is told that a table has not been moved rather than left to
      // notice it. Nothing was deleted, so a build that understands the file can still be rolled back to.
      if (moved.error) {
        console.error(`[statistics] the old table was not moved: ${moved.error}`)
        recordDiagnostic({ level: 'warn', category: 'migration', message: `old statistics table not moved: ${moved.error}` })
      }

      if (moved.characters || moved.accounts) {
        console.log(`[statistics] moved ${moved.characters} character(s) and ${moved.accounts} account(s)`)
      }

      if (moved.skipped) {
        console.warn(`[statistics] ${moved.skipped} row(s) of the old table could not be placed`)
      }

      // And the hall of fame's own table, built here rather than by whoever reads it first. A database that has
      // never held it pays for the whole population once (`rebuildPopulation` in `server/utils/leaderboardRows`),
      // and that cost belongs to a start rather than to somebody's first page; every later start is a header read
      // that finds the version it expects and does nothing at all.
      const built = Date.now()
      ensurePopulation()
      const took = Date.now() - built

      if (took > 50) console.log(`[statistics] the hall of fame's table was built in ${took} ms`)
    })
    .catch((error) => {
      console.warn(
        `[statistics] the migration was left for the next start: ${error instanceof Error ? error.message : String(error)}`
      )
      recordDiagnostic({
        level: 'error',
        category: 'migration',
        message: `statistics migration failed: ${error instanceof Error ? error.message : String(error)}`
      })
    })
})
