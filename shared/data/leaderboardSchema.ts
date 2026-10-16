/**
 * The shapes the leaderboard is written, stored and served in.
 *
 * The table on `/leaderboard` is built from one record per member of the population the site counts its
 * statistics over - an account, or a guest the site has read - and both ends of the wire need to agree on what
 * such a record is: the storage layer writes it, the endpoint reads it out of a cache, the components draw it.
 * The three types below are that agreement, and they are the only thing the frontend is told about the data -
 * nothing here says where a record lives or how it got there, which is what let the storage layer be swapped for
 * SQLite without a line changing in a handler or a component.
 *
 * Everything is plain JSON: numbers, strings and one nested object per aggregate. No `Date`, no
 * class instance, because a record has to survive being written to a database row, cached by Nitro and
 * serialised into an HTML payload.
 */
// The names of the figures themselves, which the history and distribution endpoints speak: a metric
// leaderboard ranks one of those very figures, so its slug table is typed against them rather than against
// strings of its own (`METRIC_LEADERBOARDS` below).
import type { MetricKey } from './historySchema'

/**
 * The side a character plays for, as the profile API reports it (`faction.type`) and lowercased.
 *
 * `neutral` is a real answer rather than a missing one: the API returns it for a character whose
 * faction it will not state, and a character whose side the site has never read wears it too. It is
 * filtered out by both of the faction chips.
 */
export type LeaderboardFaction = 'alliance' | 'horde' | 'neutral'

/**
 * How the table can be ordered: one per preset the page offers.
 *
 * The first five are the page's own tabs; `pets`, `toys` and `reputations` are here because the table
 * has a column for each of them and a column a reader can see is a column a reader expects to sort by.
 * `kills` is the honorable kills a character has earned, and it is the one figure of the table an account
 * is counted for by *adding its characters up* rather than by taking the best of them: a kill belongs to
 * the character that earned it (see `AccountExtra` in `server/utils/accountPool`).
 *
 * The item level is deliberately not among them: it is what a character *wears* rather than what it has
 * gathered, and a reader meets it beside the level under a row's name (`metaLine` in
 * `app/components/leaderboard/MetricLeaderboardTable.vue`) rather than as a figure of its own.
 */
export type LeaderboardSort =
  | 'total'
  | 'achievements'
  | 'mounts'
  | 'toys'
  | 'pets'
  | 'decor'
  | 'reputations'
  | 'kills'
  | 'mplus'

/**
 * The figures a reader can open a leaderboard *of*, one page each (`/leaderboards/<slug>`).
 *
 * This is the second, wider list, and it is a list of its own rather than part of `LeaderboardSort` above on
 * purpose. `LeaderboardSort` is how the hall of fame's own read may be ordered - nine presets over one table of
 * everything - while a *metric leaderboard* is a ranking of one single figure, read from a page of its own with
 * the world, a region or a realm in front of it. The two are different questions - "who has gathered the most, all
 * of it at once" against "who is first at this one thing, here" - so the list of ranked figures is written out
 * here rather than derived from the sorts: the five figures the hall of fame's read has no order for (`titles`,
 * `quests`, `recipes`, `transmogs`, `honorLevel`) are exactly the ones this list earns, and a preset the read adds
 * tomorrow does not silently become a page of its own.
 *
 * The slugs are the addresses, and they are the one spelling a reader, a crawler and a link share: a slug is
 * never a database column (`METRIC_LEADERBOARDS` carries the column beside it) and never reaches SQL as it
 * stands, so a hand-typed address cannot name a field the table does not have.
 */
export type MetricLeaderboardSlug =
  | 'score'
  | 'achievements'
  | 'mounts'
  | 'toys'
  | 'pets'
  | 'decor'
  | 'titles'
  | 'reputations'
  | 'transmogs'
  | 'quests'
  | 'recipes'
  | 'honorable-kills'
  | 'honor-level'

/**
 * One metric leaderboard: its address, the figure it ranks, the row's own column and the words it is drawn in.
 *
 * * `metric` is the name the history and distribution endpoints speak (`#shared/data/historySchema`), so the
 *   figure a page ranks is the very same figure the comparison board draws a chart of - a slug naming a
 *   figure the site has no chart for would not compile.
 * * `column` is the column of the materialised `leaderboard` row the ranking is read from. It is written down
 *   here, in the one whitelist, precisely so a caller's slug is never interpolated into a query: the server
 *   looks the column up by slug and interpolates *that* (`metricOrder` in `server/utils/leaderboardRows`).
 * * `index` is the index the page is *read* through, and it is the same argument one step further: the order a
 *   ranking is drawn in is the index's own, and a page that named it leaves SQLite nothing to decide about the
 *   plan. The planner's own choice for a scoped page - `gordunni`, or a whole region - is to filter by the realm
 *   index and then *sort* what is left, which at two hundred thousand members is 190 ms against 4 ms
 *   (`test/bench` measures both). The name is checked against the schema the database is built from
 *   (`LEADERBOARD_ORDER_INDEXES` in `server/utils/db`).
 * * `labelKey` is the message key the page's heading, the column header and the rank links print the figure
 *   with - the same keys the comparison board and the tiles already use, so one figure has one name.
 * * `icon` is a glyph of `app/assets/icons`, drawn by `AppIcon` the way every other figure of the site is.
 */
export interface MetricLeaderboard {
  slug: MetricLeaderboardSlug
  metric: MetricKey
  column: string
  index: string
  labelKey: string
  icon: string
}

/**
 * Every metric leaderboard the site serves, in the order the comparison board reads its rows.
 *
 * The order is the order of `CharacterVersus.vue`'s thirteen figures rather than alphabetical, because these
 * are the same thirteen rows - a reader who has scrolled the board down to `Recipes` finds the same neighbours
 * here, and a figure added to the board is added in one place rather than two.
 *
 * `honorable-kills` and `honor-level` read the snake_case columns the snapshots were written with
 * (`honorable_kills`, `honor_level`), which is the one place the two spellings meet.
 */
export const METRIC_LEADERBOARDS: readonly MetricLeaderboard[] = [
  { slug: 'score', metric: 'score', column: 'score', index: 'idx_leaderboard_total', labelKey: 'lbColScore', icon: 'trophy' },
  {
    slug: 'achievements',
    metric: 'achievements',
    column: 'achievements',
    index: 'idx_leaderboard_achievements',
    labelKey: 'achievements',
    icon: 'achievments'
  },
  { slug: 'mounts', metric: 'mounts', column: 'mounts', index: 'idx_leaderboard_mounts', labelKey: 'mounts', icon: 'mounts' },
  { slug: 'toys', metric: 'toys', column: 'toys', index: 'idx_leaderboard_toys', labelKey: 'toys', icon: 'toys' },
  { slug: 'pets', metric: 'pets', column: 'pets', index: 'idx_leaderboard_pets', labelKey: 'pets', icon: 'pets' },
  { slug: 'decor', metric: 'decor', column: 'decor', index: 'idx_leaderboard_decor', labelKey: 'decor', icon: 'decor' },
  { slug: 'titles', metric: 'titles', column: 'titles', index: 'idx_leaderboard_titles', labelKey: 'titles', icon: 'titles' },
  {
    slug: 'reputations',
    metric: 'reputations',
    column: 'reputations',
    index: 'idx_leaderboard_reputations',
    labelKey: 'reputations',
    icon: 'exalted-rep'
  },
  {
    slug: 'transmogs',
    metric: 'transmogs',
    column: 'transmogs',
    index: 'idx_leaderboard_transmogs',
    labelKey: 'transmogs',
    icon: 'transmogs'
  },
  { slug: 'quests', metric: 'quests', column: 'quests', index: 'idx_leaderboard_quests', labelKey: 'quests', icon: 'quests' },
  { slug: 'recipes', metric: 'recipes', column: 'recipes', index: 'idx_leaderboard_recipes', labelKey: 'recipes', icon: 'recipes' },
  {
    slug: 'honorable-kills',
    metric: 'honorableKills',
    column: 'honorable_kills',
    index: 'idx_leaderboard_kills',
    labelKey: 'honorableKills',
    icon: 'kills'
  },
  {
    slug: 'honor-level',
    metric: 'honorLevel',
    column: 'honor_level',
    index: 'idx_leaderboard_honor_level',
    labelKey: 'honorLevel',
    icon: 'honorLevel'
  }
]

/** Every slug the endpoint and the pages accept, which is what an address segment is checked against. */
export const METRIC_LEADERBOARD_SLUGS: readonly MetricLeaderboardSlug[] = METRIC_LEADERBOARDS.map(
  (entry) => entry.slug
)

/** The metric leaderboard a slug names, or `null` for an address this build does not serve. */
export function metricLeaderboardOf(slug: unknown): MetricLeaderboard | null {
  if (typeof slug !== 'string') return null
  return METRIC_LEADERBOARDS.find((entry) => entry.slug === slug) ?? null
}

/**
 * The figure one row holds for one metric, read in one place so the page, the rank links and the API answer the
 * same number for the same member.
 *
 * `null` is returned for the one thing a figure can be at two levels: a metric whose field in a row is itself
 * unknown (the five below the collections) reads as "no figure", while every other figure is a number by the
 * time a row exists - a collection nobody has read is a nought, and the rating is computed at write time.
 *
 * The map is written key by key rather than indexed off a string, so the compiler is what says that every metric
 * a slug can name has a field to be read from.
 */
export function metricFigureOf(player: LeaderboardPlayer, metric: MetricKey): number | null {
  const figures: Record<MetricKey, number | null> = {
    score: player.score,
    mPlusScore: player.mPlusScore,
    achievements: player.achievements,
    mounts: player.mounts,
    pets: player.pets,
    toys: player.toys,
    decor: player.decor,
    reputations: player.reputations,
    titles: player.titles,
    quests: player.quests,
    recipes: player.recipes,
    transmogs: player.transmogs,
    honorableKills: player.honorableKills,
    honorLevel: player.honorLevel
  }

  const value = figures[metric]
  return typeof value === 'number' ? value : null
}

/**
 * The scope a metric leaderboard page is drawn for: the whole world, one region, or one realm inside it.
 *
 * A realm is only a realm *within* a region - `gordunni` exists in EU and a realm of the same slug may exist
 * in US - so a realm is never read on its own: it travels with the region that identifies it, and the SQL
 * keeps the two together (`whereClause` in `server/utils/leaderboardRows`). A region with no realm is that
 * region's own ranking, and no region at all is the world.
 */
export interface MetricLeaderboardScope {
  /** A Blizzard region code (`eu`, `us`), or absent for the whole world. */
  region?: string
  /** A realm slug, meaningful together with its region. */
  realm?: string
}

/**
 * A ranking as a page draws it: which figure, and at which scope.
 *
 * It is the two halves of a metric leaderboard's own address (`metricLeaderboardPath` in
 * `app/composables/metricLeaderboard`) travelling as one value, because the two are never useful apart: a page that
 * is drawing a table knows both, and a control that has to open *that* table - the chip of the selected character in
 * a header's corner, which finds the reader's row in it - is handed them together rather than as three props that
 * could name a figure and a scope a page is not drawing.
 */
export interface MetricLeaderboardTarget extends MetricLeaderboardScope {
  /** The ranking's slug, as its address spells it. */
  metric: MetricLeaderboardSlug
}

/** What a caller may ask a metric leaderboard for. */
export interface MetricLeaderboardQuery extends MetricLeaderboardScope {
  /** One-based. */
  page?: number
  perPage?: number
}

/**
 * One page of one metric leaderboard.
 *
 * `scope` is echoed back so a page can print *which* ranking it is drawing, and so the reveal a link asked for
 * (`?rank=`) can be judged against the population it was read in.
 */
export interface MetricLeaderboardPage {
  slug: MetricLeaderboardSlug
  scope: MetricLeaderboardScope
  players: LeaderboardPlayer[]
  total: number
  page: number
  perPage: number
  pages: number
  /**
   * The realms this ranking holds members in, with how many each holds - which is what the realm menu of the
   * filter bar offers.
   *
   * It is the ranking's own facet rather than the population's (`LeaderboardStats.realmsFacet`): a realm nobody
   * has been read for *this* figure in would be a menu row leading to an empty table, and the bar's own rule is
   * that it never offers a choice that empties the page. It is read within the region the page is scoped to (or
   * across the world, when the address names no region), so a realm picked from the menu stays in the region the
   * reader is looking at.
   */
  realms: LeaderboardRealmFacet[]
  /** When the data behind the answer was last written, so a reader can judge how fresh it is. */
  updatedAt: string
}

/**
 * One place of one character in one ranking: their position, and how many they hold it among.
 *
 * `rank` is `null` for a character that is not in the ranking at all, and that is deliberately one answer to
 * two situations: a character outside the population (an alt that is neither its account's main nor a guest
 * row of its own) and a member whose figure for this metric has never been read are both *unplaced*.
 * `participating` and `value` are what tell the two apart where a caller needs to.
 */
export interface MetricLeaderboardRank {
  /** The character, keyed the way the table keys a row: `region:realm:name`, lowercased. */
  key: string
  /** Whether the character is a member of the leaderboard's population at all. */
  participating: boolean
  /**
   * The row the table draws for this character, or nothing at all for one it does not hold.
   *
   * It is the same record a page of the ranking serves (`server/utils/leaderboardRows`), so a plate that prints a
   * character's portrait, class, guild or realm beside their place is printing what the table below prints -
   * rather than a second, browser-remembered copy of them that could disagree.
   */
  player?: LeaderboardPlayer
  /** The figure the character holds for this metric, or `null` when the site has never read one. */
  value: number | null
  /** Their place in the world ranking, one-based, or `null` when they hold none. */
  worldRank: number | null
  /** Their place within their own region, or `null`. */
  regionRank: number | null
  /** Their place within their own realm (inside its region), or `null`. */
  realmRank: number | null
  /** How many members hold a figure for this metric in the world ranking. */
  worldTotal: number
  /** How many hold one in the character's own region. */
  regionTotal: number
  /** How many hold one in the character's own realm. */
  realmTotal: number
}

/** What the ranks endpoint answers: one place per character a caller named, for one metric. */
export interface MetricLeaderboardRanks {
  slug: MetricLeaderboardSlug
  players: MetricLeaderboardRank[]
  /** When the data behind the answer was last written, so a reader can judge how fresh it is. */
  updatedAt: string
}

/**
 * Where one character stands in every ranking the site keeps, keyed by the ranking's slug: their place, or `null`
 * in a ranking the table does not hold them in.
 *
 * It is the ranks question asked the other way round - one character and all thirteen figures rather than one
 * figure and all the names a caller has - and it exists because a *link* needs a place. Every figure on a
 * character's page is a door into the ranking of that figure, and a door carries the place its reader holds in the
 * table it opens (`?rank=`, `app/composables/metricLeaderboard`), so the table turns to their row instead of
 * opening at its first page. The thirteen places come back together because thirteen doors are written from one
 * page, and a place and nothing beside it is what comes back: how many members it is a place among is the table's
 * own to print, and a place is the whole of what an address is written from.
 */
export type CharacterRanks = Record<MetricLeaderboardSlug, number | null>

/**
 * Every sort the endpoint accepts, which is what a query string is checked against.
 */
export const LEADERBOARD_SORTS: readonly LeaderboardSort[] = [
  'total',
  'achievements',
  'mounts',
  'toys',
  'pets',
  'decor',
  'reputations',
  'kills',
  'mplus'
]

/**
 * How many rows a page of any of the site's tables holds.
 *
 * One number for every ranking of the site, because a page of one and a page of another are the same page to a
 * reader - and because a *place* in a ranking is turned into a page with it (`metricLeaderboardPageForRank`), so a
 * place and a page have to be counted the same number of rows at a time.
 */
export const LEADERBOARD_PER_PAGE = 25

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
 * The table reads one character's item level beside everybody else's, under the row's name, so it prints one for
 * a character at the cap and nothing for anybody else - a figure a row does not show cannot be the thing that
 * decides where the row goes. Asked in one place, the two can never drift apart. The comparison board and the
 * header of a character's own page print it unconditionally, because neither ranks anybody: the rule is about a
 * figure read *beside* others, and those two read one character at a time. A level the record does not carry is
 * not a level at the cap: nothing is the honest answer.
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
   * because a character whose portrait the site has never read has none, and a row without one draws a
   * monogram in the class colour instead.
   */
  avatar?: string
  /**
   * The guild the character belongs to, as the profile named it, or absent when the site has never read one.
   *
   * It is not a figure the table ranks by: it is a line a row prints under a name (the metric leaderboards'
   * own `Guild` column), which is why it is optional and why a row without one prints a dash rather than an
   * empty cell - "no guild" and "nobody has read one" are two answers, and the site only ever knows the
   * second. The name travels on the profile the site already reads for everything else, so it costs no
   * Blizzard call of its own (`server/utils/profileFeed`).
   */
  guild?: string
  /**
   * Whether the row belongs to an account on the site - the character an account signed in with and leads
   * with - rather than being a character somebody looked up once.
   *
   * The table wears it as a blue halo on the portrait: the same blue the Battle.net plate of the header
   * wears, because it says the same thing (there is an account behind this), and it is the one mark that
   * tells a reader which figures are the site's own reading of a whole account rather than one glimpse of
   * one character (see `server/utils/statisticsPopulation`). Absent on every other row, and on every row of a table
   * that could not read the database at all.
   */
  isAccount?: true
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
  /**
   * Honorable kills earned, which is the column standing after the Mythic+ rating.
   *
   * The one figure of a row that an account's own is a *sum* rather than a best: a kill belongs to the
   * character that earned it, so the account's total is what its characters have done between them (see
   * `readAccountTotals` and `AccountExtra` in `server/utils/accountPool`). A row that belongs to an account
   * carries the account's total, and every other row carries the reading of the one character it stands
   * for - which is exactly the rule the table's other columns follow.
   */
  honorableKills: number
  /** Mounts collected. */
  mounts: number
  /** Pets collected, counted by species. */
  pets: number
  /** Toys collected. */
  toys: number
  /** Decor collected. */
  decor: number
  /**
   * Factions driven to the top of their own ladder, which is what the reputation tile counts and what
   * the table's own column prints. A character of one side can finish about 230 of them
   * (`server/utils/reputations-data.json`); a renown faction at its last level counts like a classic
   * ladder at Exalted.
   */
  reputations: number
  /** Achievement points. */
  achievements: number
  /**
   * The overall rating the table is ordered by, computed once - when the profile was written -
   * rather than on every read (see `server/utils/playerScore`). Stored rather than derived
   * so that a change to the weights is a change to what a *later* lookup writes, and never
   * silently re-ranks a file of records behind the reader's back.
   */
  score: number
  /**
   * The five figures a metric leaderboard of its own may rank, and the only fields of a row that are allowed to
   * be *unknown*: `null` is a member the site has no reading of for that figure, where the six collections above
   * are always a number (a collection nobody has read is a nought, which is what the table has always held).
   *
   * The distinction matters in exactly one place - the ranking of one of them (`/leaderboards/<slug>`) - where a
   * member holding no figure must not be placed as though they held none, and where a *real* zero (an account
   * whose own totals say it has no titles) must be placed like any other figure.
   */
  titles: number | null
  quests: number | null
  recipes: number | null
  transmogs: number | null
  honorLevel: number | null
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

/** One realm of a facet: where it is, how it is named, and how many members of the population it holds. */
export interface LeaderboardRealmFacet {
  region: string
  realm: string
  realmName: string
  count: number
}

/** One side of a facet, and how many members of the population play for it. */
export interface LeaderboardFactionFacet {
  faction: LeaderboardFaction
  count: number
}

/**
 * The aggregated figures behind the widgets, computed in one pass over the whole population.
 *
 * This is the only place anything is summed up, and the storage layer memoises it, so the cost is
 * paid when the data changes rather than when a reader opens the page.
 *
 * The leaders are the site's own answer to "who is best at what": one per figure a widget stands for, and each of
 * them read off the ranking of that very figure (`readMetricLeader`), so the member a tile names is the member
 * standing first on the page that figure's own ranking opens with. A figure nobody holds is answered with no
 * leader rather than with a row of zeroes.
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
  /** The player with the most decor collected, first on the decor ranking (`/leaderboards/decor`). */
  architect: LeaderboardLeader | null
  /** The player leading each of the figures a widget prints, one per ranking of a single figure. */
  pets: LeaderboardLeader | null
  toys: LeaderboardLeader | null
  mounts: LeaderboardLeader | null
  reputations: LeaderboardLeader | null
  titles: LeaderboardLeader | null
  transmogs: LeaderboardLeader | null
  /** Everything gathered across the population, which the line under the widgets counts. */
  totals: {
    mounts: number
    pets: number
    toys: number
    decor: number
    reputations: number
    achievements: number
  }
  /**
   * The day the table behind these figures was last written, so a reader can judge how fresh they are
   * (`readGlobalStats` reads it in the same pass as the counts).
   */
  updatedAt: string
  /**
   * The facets the filters are built from: what a reader can pick, and how many players each
   * choice would leave. Read off the same pass, so a filter can never offer an empty result.
   */
  realmsFacet: LeaderboardRealmFacet[]
  classesFacet: { classId: number; count: number }[]
  factionsFacet: LeaderboardFactionFacet[]
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
 * (`metricLeaderboardPageForRank` in `app/composables/metricLeaderboard.ts`).
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
  /**
   * A Blizzard region code (`eu`, `us`) to keep, which is what turns a realm slug into *one* realm - and which is
   * also a filter the front door draws as a chip of its own beside the sides (`regionOptions` in
   * `LeaderboardFilters.vue`).
   *
   * A metric leaderboard's realm scope names both, because `gordunni` in EU and a realm of the same slug in US are
   * two different realms (`MetricLeaderboardScope` above). An honest region narrows the table to it; a *code* the
   * endpoint does not know is dropped rather than served, which is the front door's own reading of a filter
   * (`parseRegionFilter` in `server/utils/params`) - while a metric page's address, which names a place rather than
   * a filter, keeps nobody for a place the site cannot draw (`whereClause`).
   */
  region?: string
  /** A class id to keep, or `all`. */
  classId?: number | 'all'
  /** A fragment of a character's name, matched case-insensitively. */
  q?: string
  /** One-based. */
  page?: number
  perPage?: number
}

/**
 * Who is on the site right now, which is what the hall of fame's online dots are drawn from
 * (`GET /api/leaderboard/presence`, read by `app/composables/presence.ts`).
 *
 * `keys` are the characters whose account has beaten inside `window` seconds, written the way the table
 * keys a row - `region:realm:name`, lowercased, which is the same string `searchHistoryKey` writes in the
 * browser - so a row and a key can be compared at all. It is the *mains* that are answered: the one
 * character per account the table draws.
 *
 * This rides on its own endpoint rather than on the table's own answer on purpose: that answer is cached
 * for an hour and may be served by a CDN for another, and a dot that old says nothing.
 */
export interface LeaderboardPresence {
  /** How long a beat is good for, in seconds: what the dot's freshness means. */
  window: number
  /** The online mains, as keys of the characters the table would draw. */
  keys: string[]
}
