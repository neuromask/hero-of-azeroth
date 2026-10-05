/**
 * The reputation factions the game actually tracks: how many of them a character of each
 * faction can work on, and how far each faction's ladder goes.
 *
 * Blizzard's reputation-faction index lists every entry of the reputation pane, which
 * includes the 37 factions only Horde characters can raise, the 40 only Alliance
 * characters can, and the 18 entries that merely group the rest - the twelve expansions,
 * the two faction groups, `Guild`, a stray placeholder. Measuring a character against
 * that list is what made the tile read 284 and warn that most of it could never be
 * filled. The index carries neither a side nor a "this is only a heading" flag, so the
 * split would cost 284 reads per character page; the snapshot next to this file holds the
 * answer instead and is refreshed after a patch with `npm run refresh:reputations`.
 *
 * The same snapshot holds the top of each faction's ladder, which is how a reputation the
 * character has finished is told from one they merely have a record with: the classic
 * table ends at Exalted, a renown faction at its last renown level, a delve companion at
 * its last level (Brann Bronzebeard runs to Level 100), the brokers of K'aresh at
 * Mastermind.
 */
import snapshot from './reputation-totals.json'

/** Cast because the snapshot is data: TypeScript cannot know which ids it holds. */
const tops = snapshot.tops as Record<string, number>
const reachable = snapshot.reachable as Record<string, number>

/**
 * How many reputations a character of this faction can reach at all: the factions of
 * their own side plus the neutral ones.
 *
 * `listed` is what Blizzard's index holds right now and `recorded` the number of
 * reputations the character payload carries. A patch that adds factions after the
 * snapshot was taken moves the total by however many ids the index has grown by, and a
 * character who carries more reputations than the snapshot knows about keeps the tile
 * from reading over 100%.
 */
export function reputationTotal(side: string, listed: number, recorded: number): number {
  const known = reachable[side] ?? Math.max(reachable.ALLIANCE, reachable.HORDE)

  return Math.max(known + Math.max(0, listed - snapshot.listed), recorded)
}

/** "Exalted" is tier 7; the name is the fallback for a faction on a shorter tier table. */
const EXALTED_NAMES = new Set(['Exalted', 'Превознесение'])

export function isExalted(standing: any): boolean {
  return standing?.tier === 7 || EXALTED_NAMES.has(standing?.name)
}

/**
 * Whether a standing sits at the top of its faction's own ladder. A renown faction
 * reports the level it is on as `renown_level`, every other one as `tier`, and both are
 * compared against the top the snapshot holds. A faction it does not know - one a patch
 * added after the snapshot was taken - falls back to the Exalted reading.
 */
export function isReputationMaxed(factionId: number | undefined, standing: any): boolean {
  const top = factionId === undefined ? undefined : tops[String(factionId)]
  const level = standing?.renown_level ?? standing?.tier

  if (typeof top === 'number' && typeof level === 'number') {
    return level >= top
  }

  return isExalted(standing)
}