/**
 * The two sides a character can play for, and how each one is drawn.
 *
 * The leaderboard prints a faction twice - as a chip in the filter bar and as a badge beside a
 * name in the table - and both places have to agree on what colour that is, exactly as the class
 * table keeps the class colours in one place (`#shared/utils/wow-class`). The palette is the
 * game's own: the blue and the red a player reads off a battleground scoreboard.
 *
 * `neutral` is not a side. It is the answer for a character whose faction Blizzard will not state,
 * and for a row backfilled from the sitemap's index, which never kept one - so it is drawn grey and
 * is never offered as a filter, only reported when it is what the data says.
 */
import type { LeaderboardFaction } from '../data/leaderboardSchema'

export interface WoWFaction {
  /** The id a record stores. */
  id: LeaderboardFaction
  /** The colour a chip, a badge and a dot are drawn in. */
  hex: string
  /** The translation key the faction is named by, so the two components that print it agree. */
  labelKey: string
}

/** The sides, in the order the filter chips are drawn: Alliance, Horde, then everybody else. */
export const WOW_FACTIONS: readonly WoWFaction[] = [
  { id: 'alliance', hex: '#3fa9f5', labelKey: 'lbAlliance' },
  { id: 'horde', hex: '#e0293a', labelKey: 'lbHorde' },
  { id: 'neutral', hex: '#9ca3af', labelKey: 'lbNeutral' }
]

/** The sides a reader may filter by: the two that mean something, without the fallback. */
export const FILTERABLE_FACTIONS: readonly WoWFaction[] = WOW_FACTIONS.filter(
  (faction) => faction.id !== 'neutral'
)

/** A faction looked up by the id a record stores. */
export function factionById(id?: string | null): WoWFaction | null {
  if (!id) return null
  return WOW_FACTIONS.find((faction) => faction.id === id) || null
}

/** The colour a faction is drawn in, or a neutral grey for anything unrecognised. */
export function factionHex(id?: string | null): string {
  return factionById(id)?.hex || '#9ca3af'
}
