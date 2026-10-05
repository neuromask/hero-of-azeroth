/**
 * How many mounts the mount tile is measured against.
 *
 * Blizzard's static mount index is the list of every mount in the game data, and it holds
 * entries no character's journal ever shows: unreleased and placeholder content ("[PH]
 * Purple Cat Mount", "Wintry Witchwick's Rider"), the Trading Post's coming stock, the
 * mounts of a patch that is not live yet. Measured against the index the tile reads 1,214
 * of 1,676 - 72% - while the journal of that same character holds 1,214 of its 1,387, 87%.
 * The 289 mounts the journal does not list are the whole difference between the two.
 *
 * The journal of a character is published on Blizzard's own Armoury, and its size is what
 * the tile counts. `armoury-totals.json` holds it (1,387 for the character it was read
 * with) and is refreshed after a patch with `npm run refresh:armoury-totals`; the index is
 * the fallback for a checkout that has never run it.
 *
 * `collected` is the character's own list, used as a floor the way `reputationTotal` uses
 * the character's reputation count: a mount released after the snapshot was taken can push
 * a collection past the recorded journal, and the bar must not read over 100% for it.
 */
import armoury from './armoury-totals.json'

export function mountTotal(indexed: number, collected: number): number {
  return Math.max(armoury.mounts || indexed, collected)
}