/**
 * Who the site's statistics are about, and at what level each figure is counted.
 *
 * One population answers every aggregate the site publishes - the hall of fame's table, a character's history,
 * the distribution a comparison board draws - and it is deliberately not "every row the database holds":
 *
 *   - a **guest** is in it as itself: a character the site read that no account holds
 *     (`characters.user_id IS NULL`, written by `./profileFeed`);
 *   - an **account** that signed in is in it *once*, whatever number of characters it holds: one value in a
 *     distribution, one curve on a comparison board, one row in the hall of fame. Its figures are its own totals
 *     (`account_snapshots`, gathered by `readAccountTotals` in `./accountPool`), so its main and each of its alts
 *     show the same numbers and the same history - the main exists only to be the row the public table draws;
 *   - an account that asked to be left out of the table (`users.hide_from_fame`) is not in it at all;
 *   - a character with no reading is not in it: a row is written the moment a character is read, and a row with
 *     nothing filed behind it has no figures to count.
 *
 * The sitemap's index (`./characterIndex`) is **not** a member and is never consulted here. It lists the pages
 * the site can serve, which is a fact about addresses rather than about what anybody holds; a character known
 * only from that list is counted nowhere - not in the table, not in a history, not in a distribution.
 *
 * ## What level a figure is counted at
 *
 * A guest's figures are the character's own. A main's are the *account's* - the same totals the hall of fame
 * prints and the account's own pages show (`readAccountTotals` in `./accountPool`) - because the row that
 * stands for an account must print the account's numbers, and a history drawn from anything else would show a
 * curve that never happened. The two levels do not share a name: the tables and the rules below say which one
 * a figure is read at, and the write path is what keeps a main's reading at the account's level
 * (`./accountSync`). Within the account's own level the metrics are not all the same aggregate either, and that
 * is deliberate and named per figure in `./accountPool`:
 *
 *   - `mounts`, `pets`, `toys`, `decor`, `achievements` - the best of the pool's union and the roster's
 *     readings (an account-wide collection seen through one character);
 *   - `reputations` - the pool's union alone (a stored count can still be Blizzard's old account-wide counter);
 *   - `mPlusScore`, `honorLevel` - the highest any character of the account stands at, never merged;
 *   - `ilvl` - not aggregated at all, and deliberately: an item level is always one character's
 *     (`characters.ilvl`, beside its level), an account has no figure of its own, and the row of the hall of fame
 *     prints the one the character it is named after wears (`./leaderboardRows`);
 *   - `titles`, `quests`, `recipes` - the pool's union of earned ids, merged with the best reading;
 *   - `transmogs` - the account's wardrobe, which is one document and is not unioned;
 *   - `honorableKills` - the *sum* over the account's characters, because a kill belongs to the character that
 *     earned it.
 */
import type { MetricKey } from '#shared/data/historySchema'

/**
 * The population's rows, one per member, with the newest point of each.
 *
 * A member is an **account** or a **guest**, never a character of an account: an account's thirty alts are one
 * player, one value in a distribution and one curve on a comparison board, and the row that stands for it in the
 * hall of fame is its main's. So the two branches below read two different tables, and each is the newest point
 * of the thing being counted:
 *
 *   - a guest's own reading (`snapshots`), reached through `idx_snapshots_character(character_id, taken_at)` -
 *     one index seek per guest;
 *   - an account's own totals (`account_snapshots`), reached through `idx_account_snapshots_user(user_id,
 *     taken_at)` - one index seek per account, however many characters it holds.
 *
 * `column` is one of the snapshot's own columns, taken from the one map that names them (`METRIC_COLUMNS` in
 * `./characterReading`), so nothing a caller writes reaches this string - and the two tables name those columns
 * the same way on purpose, so one metric is one name.
 */
export function populationRows(column: string): string {
  return `
    SELECT value, taken_at FROM (
      SELECT s.${column} AS value, s.taken_at AS taken_at
        FROM characters c
        JOIN snapshots s ON s.id = (
          SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
        )
       WHERE c.user_id IS NULL

      UNION ALL

      SELECT a.${column} AS value, a.taken_at AS taken_at
        FROM users u
        JOIN account_snapshots a ON a.id = (
          SELECT id FROM account_snapshots WHERE user_id = u.id ORDER BY taken_at DESC LIMIT 1
        )
       WHERE COALESCE(u.hide_from_fame, 0) = 0
    )`
}

/**
 * How many times the statistics have moved, which is what a memo of them is thrown away on.
 *
 * A counter in the process rather than a stamp of the tables: what a memo has to notice is a write the process
 * itself made - a reading filed, a character claimed by an account, a main named, an account hidden - and each
 * of those calls `bumpStatisticsRevision`. It is deliberately not a query: the point of the memo is that
 * reading the population costs nothing when nothing has moved.
 */
let revision = 0

/** Marks every aggregate of the population as stale. Called by the writes that move it. */
export function bumpStatisticsRevision(): void {
  revision += 1
}

/** How many times the population has moved since the process started. */
export function statisticsRevision(): number {
  return revision
}
