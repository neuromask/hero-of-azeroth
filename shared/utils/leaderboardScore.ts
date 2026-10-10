/**
 * The weights the overall rating is made of: what a reader is told, and nothing else.
 *
 * This module is the *reader's* half of the rating, and it is in `shared/` because a page prints it - the
 * legend beside the hall of fame's filters lists these multipliers, read off this very table, so the panel
 * a reader opens and the formula cannot drift apart. The formula itself is the server's
 * (`server/utils/playerScore.ts`), and the client may not compute a rating at all: it used to, and the one
 * page that did assembled its own list of figures and left one out. Every number a page prints now travels
 * with the figures it was computed from.
 *
 * The weights are multipliers rather than a statement of "importance": a mount is worth twenty-five
 * achievement points, a toy fifteen, a finished reputation fifty, and a piece of decor or a pet five. Only
 * what a character has *collected* is weighed - mounts, pets, toys, decor, the achievement points behind
 * them, and the reputations driven to the top of their faction's ladder - so a Mythic+ rating or an item
 * level, earned by playing or simply worn, never decides where a collector stands. The figures in the
 * comments are what a fully collected character of the current expansion brings, which is what a later
 * category (transmog) should be weighed against.
 *
 * Adding a category is one line in the table below, one field in the profile the storage writes, and a bump
 * of `SCORE_VERSION` (`server/utils/playerScore.ts`), which is what re-derives the ratings already on file.
 */
export const SCORE_WEIGHTS = {
  /** ~45 000 achievement points, which is why this weight is the smallest of the six. */
  achievements: 1,
  /** ~1200 mounts in the journal: the collection the site weighs most heavily. */
  mounts: 25,
  /** ~950 toys. */
  toys: 15,
  /** ~1480 decor pieces, which is why this weight sits with the pets rather than above them. */
  decor: 5,
  /** ~1500 pets, counted by species. */
  pets: 5,
  /**
   * ~230 factions reachable by a character of one side (`server/utils/reputation-totals.json`),
   * counted only where they are finished - `isReputationMaxed`, so a renown faction at its last level
   * and a delve companion at its hundredth count the same as a classic ladder at Exalted.
   */
  reputations: 50
} as const