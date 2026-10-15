/**
 * The key a row of the hall of fame is addressed by.
 *
 * This module used to answer who the table must not draw, and memoised the answer for a minute. The population
 * is a query over the database now (`./statisticsPopulation`, `./leaderboardRows`), so those rules - one row per
 * account, drawn as the character it leads with, and nothing at all for an account that asked to be left out -
 * are written as that query's own `WHERE` and tested with it.
 *
 * What is left here is the string the two ends of a comparison are made of: a row of the table, and the presence
 * dot a row wears (`./presence`). It is the same string `searchHistoryKey` writes in the browser, which is what
 * lets a row and a key be compared at all.
 */

/** The identity the leaderboard keys a record on: its three address segments, lowercased. */
export function leaderboardKey(region: string, realm: string, name: string): string {
  return `${region}:${realm}:${name}`.toLowerCase()
}
