/**
 * How many mounts the mount tile is measured against.
 *
 * Blizzard's static mount index is the list of every mount in the game data, and it holds entries no
 * character's journal ever shows: unreleased and placeholder content ("[PH] Purple Cat Mount", "Wintry
 * Witchwick's Rider"), the Trading Post's coming stock, the mounts of a patch that is not live yet.
 * Measured against the index the tile reads 1,215 of 1,676 - 72% - while the journal of that same
 * character holds 1,215 of its 1,387, 87%. The 289 mounts the journal does not list are the whole
 * difference between the two.
 *
 * The journal of a character is published on Blizzard's own Armoury, and its size is what the tile
 * counts - per character, because it follows the faction as well as the patch (the same two characters
 * read 1,387 and 1,359 on the day this was written). `armouryMountJournal` reads it for the character
 * that is being looked at and keeps it for a day; `armoury-totals.json`, the snapshot the command
 * `npm run refresh:armoury-totals` writes, stands in for a process that cannot reach the Armoury, and
 * the index itself for a checkout that has never run that command.
 *
 * `collected` is the character's own list, used as a floor the way `reputationTotal` uses the
 * character's reputation count: a mount released after the journal was cached can push a collection
 * past it, and the bar must not read over 100% for it.
 */
import armoury from './armoury-totals.json'

export function mountTotal(journal: number | undefined, indexed: number, collected: number): number {
  return Math.max(journal || armoury.mounts || indexed, collected)
}