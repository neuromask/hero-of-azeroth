/**
 * The Reputations schema: what a reputation journal is made of, and how one character's own payload is
 * folded into the groups a visitor reads.
 *
 * The shape mirrors the Collections and Achievements ones on purpose. A collection is a group holding
 * sources holding items; a reputation journal is an *expansion* holding the subgroups Blizzard's own pane
 * puts under it (a side, a garrison, a cluster of city factions) holding the factions themselves. The
 * same walk therefore draws all three: a heading, a heading under it, and a row per faction.
 *
 * Where this schema parts company with the other two is what a row *is*. A collection row is a tile that
 * is either held or not; a reputation row carries the character's own place on a ladder - the stage it
 * stands on, the progress inside that stage, and how many stages the ladder has - so a shelf draws a
 * scale with a tick at every step of it (`app/components/ReputationRow.vue`) rather than a bar of percent.
 * The stages are the game's own and their names are read from the atlas, in the page's language, because
 * there are 217 of them across 81 ladders and no message file can hold them; the fourteen the game spells
 * the same way everywhere - Hated … Exalted, Stranger … Best Friend - are message keys instead, so a
 * translator meets them as words rather than as data (`REPUTATION_STANDING_KEYS`).
 *
 * One group of the journal has no document of Blizzard's behind it: the factions no expansion heading
 * reached (the Shattrath and Steamwheedle reputations of the Burning Crusade are left under none) are
 * collected under a synthetic group, and its id - `other` rather than an id - is what says so. Its name
 * is a message key of its own (`REPUTATION_GROUP_KEYS`), because no atlas names it.
 */

/** The one synthetic group, which no document of Blizzard's names: its label is a message key instead. */
export const REPUTATION_GROUP_KEYS = { other: 'reputationsOther' } as const

/** A group's id: Blizzard's own id for a heading, or `other` for the group the atlas puts together. */
export type ReputationGroupId = number | keyof typeof REPUTATION_GROUP_KEYS

/**
 * The stages the game spells the same way on every ladder it uses them on, as message keys, keyed by the
 * name the atlas stores them under. The rest of a ladder - a delve companion's hundred levels, a cartel's
 * seven ranks, the number words of the Timewalking ladder - is read from the atlas itself.
 */
export const REPUTATION_STANDING_KEYS: Record<string, string> = {
  Hated: 'standingHated',
  Hostile: 'standingHostile',
  Unfriendly: 'standingUnfriendly',
  Neutral: 'standingNeutral',
  Friendly: 'standingFriendly',
  Honored: 'standingHonored',
  Revered: 'standingRevered',
  Exalted: 'standingExalted',
  Stranger: 'standingStranger',
  Acquaintance: 'standingAcquaintance',
  Buddy: 'standingBuddy',
  Friend: 'standingFriend',
  'Good Friend': 'standingGoodFriend',
  'Best Friend': 'standingBestFriend'
}

/**
 * One step of a ladder - the stage a reputation is measured in, and the words a row names it with.
 *
 * This is the "instruction how to read" a reputation that travels with it: the atlas beside the endpoint
 * records the tier table every faction points at, and a table is a run of steps with a name and a span
 * each. The classic ladder is eight of them (Hated … Exalted), a friendship ladder six (Stranger … Best
 * Friend), a cartel seven ranks, a delve companion a hundred levels, a renown faction thirty levels. There
 * are 217 such names across the 81 tables and the renown ladders, so they are carried as data - resolved
 * into the page's language by the server - and only the fourteen stages the game spells the same way
 * everywhere are message keys (`REPUTATION_STANDING_KEYS`).
 *
 * `from`/`to` are the step's own numbers in the ladder's units (a reputation's points), and are `null` on
 * a ladder counted in levels - a renown faction, which Blizzard reports by level rather than by tier.
 */
export interface ReputationStep {
  /** The message key of the step, where the game spells it in words every ladder shares. */
  key: string
  /** The step's name in the page's language, for the names the game keeps to one ladder. */
  label: string
  /** The renown level this step is, on a ladder that counts in levels. */
  level: number | null
  from: number | null
  to: number | null
}

/**
 * How many steps a ladder may have and still have them carried to the page.
 *
 * A step's name and span are what a row's tooltip is read from (see `ReputationStep`), and they are read
 * once per ladder and shared by every row on it - a hundred factions stand on the one classic table. A
 * ladder longer than this (a delve companion's hundred ranks, the forty levels of a cartel's renown) is
 * left out: its steps would be carried for the sake of one tooltip, while the stage the character stands on
 * is named by the row itself in any case.
 *
 * The server and the shelf both read this: a ladder longer than it is not carried at all
 * (`ReputationRow.ladder` is empty), so the two can never disagree about which ladders come with their
 * steps.
 */
export const REPUTATION_MAX_STEPS = 30

/**
 * The place one character stands on one ladder.
 *
 * `key` is the message key of the stage where the game spells it in words every ladder shares, and empty
 * where the stage is the ladder's own - a reader then sees `label`, which the atlas already holds in the
 * language of the page. `value` and `max` are the payload's own pair, exactly as Blizzard reports them:
 * the progress inside the stage the character stands on and the width of that stage, which is what a row
 * prints beside its bar (`12 450 / 21 000`). `level` is the renown level of a renown ladder - the one
 * ladder Blizzard reports by level rather than by tier - and `null` on every other.
 */
export interface ReputationStanding {
  key: string
  label: string
  value: number
  max: number
  level: number | null
}

/**
 * One faction of the journal, with the character's own place on its ladder.
 *
 * `steps` is how many stages the ladder has, which is what the bar is cut into; `percent` is where the
 * character stands over the whole of it, one stage counting as one equal share, so a reader sees how many
 * stages are behind and ahead rather than how large their numbers are. A ladder the character has never
 * touched carries no `standing` at all: its bar is empty and its label says so.
 */
export interface ReputationRow {
  id: number
  /** The faction's name in the page's language. */
  name: string
  /** Whether the ladder is a renown one, which the game counts in levels rather than in tiers. */
  renown: boolean
  /** The top of the ladder: the last stage's tier, or the last renown level. */
  top: number
  steps: number
  /**
   * The key of this ladder in `ReputationJournal.ledgers`, which is where the words a row names its stage
   * with are read from - or empty for a ladder longer than `REPUTATION_MAX_STEPS`, which is named by the
   * stage's own label and carries no steps with it.
   */
  ladder: string
  standing: ReputationStanding | null
  /** Whether the character has any progress on it at all - a record at nought does not count. */
  started: boolean
  /** Whether it is at the top of its ladder: Exalted, the last renown level, the hundredth delve rank. */
  finished: boolean
  /** How much of the ladder is behind the character, one stage counting as one equal share, 0–100. */
  percent: number
  /**
   * The same place counted in stages rather than in hundredths: `3.4` is three stages behind the character
   * and four tenths of the one they are standing on. Its whole part is the step the row's tooltip names
   * (`Honored · 9 000 – 21 000`), which is what a bar without divisions is still read by.
   */
  position: number
  /**
   * Whether another character of this character's account has taken this ladder to the top of it, which is the
   * account's own pool of finished factions (`server/utils/accountPool`) and is what the reputations tile above
   * the journal counts. Set only on a row the account has finished and this character has not - the ones that
   * tell a reader something - and only when the journal was read as the account's; the row's own stage and
   * figures stay this character's, because the site holds no other character's ladder.
   */
  account?: boolean
}

/**
 * A run of rows under one heading, or straight under the group where Blizzard's tree names no heading
 * between them - which is what an empty `label` says. A subshelf keeps its own count, so a reader can
 * see how much of a garrison or a side is done without adding it up themselves.
 */
export interface ReputationSection {
  id: string
  label: string
  rows: ReputationRow[]
  finished: number
  total: number
}

/** One expansion of the journal - or the synthetic group of factions no expansion claimed. */
export interface ReputationGroup {
  id: ReputationGroupId
  /** The heading in the page's language, empty for the synthetic group (`REPUTATION_GROUP_KEYS`). */
  label: string
  sections: ReputationSection[]
  finished: number
  started: number
  total: number
  /** The share of the group the character has finished, rounded to a whole percent. */
  percent: number
}

/**
 * The whole reputation journal of one character, ready to draw: the expansions in the order the game's
 * pane lists them, and the running total over everything they hold.
 *
 * The totals are the reading that was asked for: this character's own by default, and the account's when the
 * journal was read as the account's (`CollectionPage.account`, one shelf over). `finished` is the counter the
 * game itself shows - Exalted factions and maxed renown ladders together - and in the account's reading it is how
 * many of these ladders *some* character of the account has finished, which is the number the tile above the
 * journal prints; `characterFinished` carries this character's own count beside it, because the sentence under the
 * numbers names both.
 */
export interface ReputationJournal {
  /** How many reputations the character can work on at all: their own side's plus the neutral ones. */
  total: number
  /** How many of them they have any progress on. */
  started: number
  /** How many they have finished - Exalted, or the top of a renown or companion ladder. */
  finished: number
  percent: number
  /** How many of the reputations that go to `total` are renown ladders. */
  renown: number
  groups: ReputationGroup[]
  /**
   * The ladders the rows are measured against, keyed by `ReputationRow.ladder`: the steps of each one, with
   * its name and its span. They are shared rather than repeated - a hundred factions stand on the one
   * classic table - which is what lets every row name its stage and its span without the journal weighing a
   * hundred times as much.
   */
  ledgers: Record<string, ReputationStep[]>
  /** When the journal was assembled, so a caller can tell a fresh copy from a revalidated one. */
  generatedAt: number
  /**
   * Whether the journal was read as the account's rather than as this character's: `true` only for a reader
   * whose account holds the character and who asked for it (`?byAccount=1`), and only when the site has the
   * account's own pool of finished factions at all. What the account's reading adds to the rows is the mark
   * behind `ReputationRow.account` - the stages and the figures below every heading stay this character's,
   * because a ladder is a character's and the site holds only this one.
   */
  account?: boolean
  /**
   * Whether the site holds an account-wide pool for this character's account at all, which is what the
   * character/account switch is drawn from - a fact about the data rather than about the reader, exactly as a
   * collection shelf reports it (`CollectionPage.accountAvailable`).
   */
  accountAvailable?: boolean
  /**
   * How many of the rows drawn here the account has finished, whoever finished them: the same number the tile
   * above the journal prints and the site's score counts. Present only in the account's reading, where it is also
   * what `finished` holds - except when `finished` is not the account's: see `characterFinished`.
   */
  accountFinished?: number
  /**
   * How many of the rows drawn here *this character* has finished, present only in the account's reading, where
   * `finished` is the account's own count. The sentence under the numbers names both, so the reader can tell the
   * character's share of the account's maxima from the maxima themselves.
   */
  characterFinished?: number
  /**
   * How many of the rows drawn here are still under way: something has touched them and nothing has finished. It
   * is the number the note under the heading prints, and what the character's own journal read as its started
   * ladders less the ones it has finished.
   */
  inProgress?: number
  /** How many of those are renown ladders, which the note names in brackets. */
  inProgressRenown?: number
}
