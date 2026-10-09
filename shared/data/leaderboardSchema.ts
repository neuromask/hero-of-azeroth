/**
 * The shapes the leaderboard is written, stored and served in.
 *
 * The table on `/leaderboard` is built from one record per character the site has ever rendered,
 * and both ends of the wire need to agree on what such a record is: the storage layer writes it,
 * the endpoint reads it out of a cache, the components draw it. The three types below are that
 * agreement, and they are the only thing the frontend is told about the data - nothing here says
 * where a record lives or how it got there, which is what lets the storage layer be swapped for
 * SQLite without a line changing in a handler or a component.
 *
 * Everything is plain JSON: numbers, strings and one nested object per aggregate. No `Date`, no
 * class instance, because a record has to survive being written to a file, cached by Nitro and
 * serialised into an HTML payload.
 */

/**
 * The side a character plays for, as the profile API reports it (`faction.type`) and lowercased.
 *
 * `neutral` is a real answer rather than a missing one: the API returns it for a character whose
 * faction it will not state, and a record backfilled from the sitemap's index - which never kept
 * a faction at all - wears it too. It is filtered out by both of the faction chips.
 */
export type LeaderboardFaction = 'alliance' | 'horde' | 'neutral'

/**
 * How the table can be ordered: one per preset the page offers.
 *
 * The first five are the page's own tabs; `pets` and `toys` are here because the table has a
 * column for each of them and a column a reader can see is a column a reader expects to sort by.
 */
export type LeaderboardSort =
  | 'total'
  | 'mounts'
  | 'decor'
  | 'mplus'
  | 'achievements'
  | 'pets'
  | 'toys'
  | 'ilvl'

/** Every sort the endpoint accepts, which is what a query string is checked against. */
export const LEADERBOARD_SORTS: readonly LeaderboardSort[] = [
  'total',
  'mounts',
  'decor',
  'mplus',
  'achievements',
  'pets',
  'toys',
  'ilvl'
]

/**
 * The level the current expansion ends at: the one fact about levelling the table needs.
 *
 * An item level is only a comparison among characters who have finished the climb. A character at 40
 * wearing 120 says nothing beside a capped one wearing 700, and a table of "who is geared" that mixes
 * the two misleads the reader who scans it. So the table prints an item level for a character at the
 * cap and a dash for everybody else, and this is the number that decides which is which - bump it
 * when an expansion raises the cap, and the table follows on its own.
 */
export const CURRENT_MAX_LEVEL = 90

/**
 * Whether a character's item level may be read beside the others': the rule above, written once.
 *
 * Both ends of the wire need the same answer to that question. The table prints an item level for a
 * character at the cap and a dash for everybody else, and the ordering puts the characters whose
 * item level it prints first, because a figure a row does not show cannot be the thing that decides
 * where the row goes. Asked in one place, the two can never drift apart - a number cannot disappear
 * from a row while its place in the table stays, or the other way round. A level the record does not
 * carry is not a level at the cap: the dash is the honest answer, and the tail of the table is where
 * such a row belongs.
 */
export function isAtItemLevelCap(level?: number): boolean {
  return typeof level === 'number' && level >= CURRENT_MAX_LEVEL
}

/**
 * One player, as the leaderboard stores and serves them.
 *
 * The record is keyed by the three address segments - region, realm, name - because that triple
 * is what the site has a page for, and it is written whenever that page is built. `name` is
 * lowercased (an address is) while `displayName` keeps the spelling the game uses.
 */
export interface LeaderboardPlayer {
  /** The Blizzard region, as the endpoints spell it (`eu`, `us`). */
  region: string
  /** The realm's slug, which is the part an address carries. */
  realm: string
  /** The realm as the game spells it, for the table to print. Falls back to the slug. */
  realmName: string
  /** The character's name, lowercased: the address segment, and the half the record is unique on. */
  name: string
  /** The name as the game spells it, which an address cannot carry. */
  displayName: string
  /**
   * Blizzard's square portrait of the character, which the table draws beside the name. Optional
   * because a record backfilled from the sitemap's index has none - that index never kept a URL -
   * and a row without one draws a monogram in the class colour instead.
   */
  avatar?: string
  /** Blizzard's class id, which is the same in every language. */
  classId: number
  /** The side the character plays for. */
  faction: LeaderboardFaction
  /** The level the profile reported. */
  level: number
  /** The item level the character was wearing. */
  ilvl: number
  /** The Mythic+ rating, rounded, as the profile reported it. */
  mPlusScore: number
  /** Mounts collected. */
  mounts: number
  /** Pets collected, counted by species. */
  pets: number
  /** Toys collected. */
  toys: number
  /** Decor collected. */
  decor: number
  /** Achievement points. */
  achievements: number
  /**
   * The overall rating the table is ordered by, computed once - when the profile was written -
   * rather than on every read (see `#shared/utils/leaderboardScore`). Stored rather than derived
   * so that a change to the weights is a change to what a *later* lookup writes, and never
   * silently re-ranks a file of records behind the reader's back.
   */
  score: number
  /** The day the profile was last seen, `YYYY-MM-DD`. */
  updatedAt: string
  /** The day the site first met the character, `YYYY-MM-DD`. */
  firstSeenAt: string
}

/**
 * One figure of the summary row: a leader and the number that put them there.
 *
 * The player is carried whole rather than as a name, so a widget can colour the name by class,
 * link it to the profile and print the realm under it without asking for anything else.
 */
export interface LeaderboardLeader {
  player: LeaderboardPlayer
  /** The figure the player leads on: the one the widget prints large. */
  value: number
}

/**
 * The aggregated figures behind the widgets, computed in one pass over the whole population.
 *
 * This is the only place anything is summed up, and the storage layer memoises it, so the cost is
 * paid when the data changes rather than when a reader opens the page.
 */
export interface LeaderboardStats {
  /** How many characters the site has in the table. */
  players: number
  /** How many realms and classes they are spread over, for the line under the widgets. */
  realms: number
  classes: number
  /** The class most players wear, with its share of the population as a whole percent. */
  topClass: { classId: number; count: number; share: number } | null
  /** The player holding the most collectables altogether (mounts + pets + toys + decor). */
  collector: LeaderboardLeader | null
  /** The best Mythic+ rating among the players. */
  rating: LeaderboardLeader | null
  /** The player with the most decor collected. */
  architect: LeaderboardLeader | null
  /** Everything gathered across the population, which the line under the widgets counts. */
  totals: { mounts: number; pets: number; toys: number; decor: number; achievements: number }
  /**
   * The facets the filters are built from: what a reader can pick, and how many players each
   * choice would leave. Read off the same pass, so a filter can never offer an empty result.
   */
  realmsFacet: { region: string; realm: string; realmName: string; count: number }[]
  classesFacet: { classId: number; count: number }[]
  factionsFacet: { faction: LeaderboardFaction; count: number }[]
}

/** What the endpoint answers with: one page of the table, and the widgets that sit above it. */
export interface LeaderboardPage {
  /** The page of players, already sorted and sliced. */
  players: LeaderboardPlayer[]
  /** How many players the whole table holds. */
  total: number
  /** The page that was served, one-based. */
  page: number
  /** How many players a page holds. */
  perPage: number
  /** How many pages the table runs to at this `perPage`. */
  pages: number
  /** The order the players are in, echoed back so the page can mark its tab. */
  sort: LeaderboardSort
  /** The summary figures, which every query carries - one request, not two. */
  stats: LeaderboardStats
  /** When the data behind the answer was last written, so a reader can judge how fresh it is. */
  updatedAt: string
}

/**
 * Where one character stands in the hall of fame: their own row, the place it holds and the
 * population it holds it among.
 *
 * A place is a place in the *overall* table - every character, ordered by the overall rating, with no
 * filter in front of it - because that is the table the page opens on and the only one a place can
 * mean without saying whose filters it was read under. It is a number rather than a page, because how
 * many rows a page holds is the reader's to ask for; the page turns the number into a page itself
 * (see `revealRank` in `app/composables/leaderboardView.ts`).
 */
export interface LeaderboardStanding {
  /** The character's row, exactly as the table draws it. */
  player: LeaderboardPlayer
  /** Their place in the overall table, one-based. */
  rank: number
  /** How many characters they are ranked among, which is what makes `#128 of 1 240` read. */
  total: number
}

/**
 * What a caller may ask for. Every field is optional: an empty query is the first page of the
 * overall table, which is what the page's own address says before a filter is touched.
 */
export interface LeaderboardQuery {
  sort?: LeaderboardSort
  /** A faction to keep, or `all` (the default) to keep everybody. */
  faction?: LeaderboardFaction | 'all'
  /** A realm slug to keep. */
  realm?: string
  /** A class id to keep, or `all`. */
  classId?: number | 'all'
  /** A fragment of a character's name, matched case-insensitively. */
  q?: string
  /** One-based. */
  page?: number
  perPage?: number
}
