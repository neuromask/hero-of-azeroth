/**
 * The signed-in reader's own account: who they are, their characters, and what those characters
 * add up to.
 *
 * Read out of SQLite alone. The page that draws it is opened right after a sign-in, which is a
 * moment the gateway is already watching - so this endpoint pays for nothing but a query, and the
 * figures a character is missing are filled in by the background task or by the reader clicking it
 * (`server/api/profile/character/[id].get.ts`).
 *
 * A visitor who is not signed in is answered, not refused: `user` comes back `null` and the header
 * uses exactly that to decide between a sign-in button and an account chip. A 401 would turn a
 * header into an error state on every page.
 */
export interface ProfileCharacter {
  id: number
  region: string
  realmSlug: string
  realmName: string | null
  name: string
  displayName: string | null
  classId: number | null
  level: number | null
  faction: string | null
  /** Blizzard's square portrait, or `null` while the character has not been read in full. */
  avatar: string | null
  /** The primary professions the game names, up to two. */
  professions: string[]
  isMain: boolean
  lastSeenAt: number
  /**
   * When this character's figures were last read, or `null` for one the background task has not
   * reached yet. The day the reading belongs to lives on `latest.takenAt`; this is the moment itself,
   * which is what a page prints.
   */
  statsReadAt: number | null
  /** The newest reading of this character, or `null` while the background task has not run yet. */
  latest: {
    takenAt: number
    ilvl: number | null
    mplus: number | null
    achievements: number | null
    mounts: number | null
    pets: number | null
    toys: number | null
    decor: number | null
    reputations: number | null
    titles: number | null
    quests: number | null
    recipes: number | null
    transmogs: number | null
    honorableKills: number | null
    honorLevel: number | null
  } | null
  /**
   * The overall rating of the figures above, computed where those figures were merged - which is here, in
   * the one place the account's own totals are laid over a character's reading.
   *
   * The page prints this number rather than working one out from the figures it draws: a rating computed
   * by the page that shows it is a second list of the six to keep in step with the formula, and that is
   * exactly how a character page came to print a score without its reputation term.
   */
  score: number
}

/** The account's own totals, as the profile page reads them. */
export interface ProfileTotals {
  characters: number
  // No item level: an item level is never the account's, so the page prints the main's own (`latest.ilvl` of
  // the roster row above) rather than a figure no character ever wore.
  mplus: number | null
  achievements: number
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
  /** The six figures beside the collections, which no rating weighs (`server/utils/accountPool`). */
  titles: number
  quests: number
  recipes: number
  transmogs: number
  honorableKills: number
  honorLevel: number
  /** The overall rating the hall of fame ranks by, read off the account's own collections. */
  score: number
  /** The kinds the account's pool answered, which is what makes a figure the account's own. */
  accountWide: string[]
}

interface ProfileRow {
  id: number
  region: string
  realm_slug: string
  realm_name: string | null
  name: string
  display_name: string | null
  class_id: number | null
  level: number | null
  faction: string | null
  avatar: string | null
  profession_1: string | null
  profession_2: string | null
  is_main: number
  last_seen_at: number
  stats_read_at: number | null
  taken_at: number | null
  ilvl: number | null
  mplus_score: number | null
  achievements: number | null
  mounts: number | null
  pets: number | null
  toys: number | null
  decor: number | null
  reputations: number | null
  titles: number | null
  quests: number | null
  recipes: number | null
  transmogs: number | null
  honorable_kills: number | null
  honor_level: number | null
}

export default defineEventHandler(async (event) => {
  const user = await getCurrentUser(event)

  if (!user) {
    return { user: null, characters: [], totals: null }
  }

  // The newest snapshot per character, joined by its own id: the correlated subquery is served by
  // `idx_snapshots_character(character_id, taken_at)`, so it costs an index seek per row.
  const rows = useDb()
    .prepare(
      `SELECT c.id, c.region, c.realm_slug, c.realm_name, c.name, c.display_name, c.class_id, c.level,
              c.faction, c.avatar, c.profession_1, c.profession_2, c.is_main, c.last_seen_at,
              c.stats_read_at, c.ilvl,
              s.taken_at, s.mplus_score, s.achievements, s.mounts, s.pets, s.toys, s.decor, s.reputations,
              s.titles, s.quests, s.recipes, s.transmogs, s.honorable_kills, s.honor_level
         FROM characters c
         LEFT JOIN snapshots s ON s.id = (
           SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
         )
        WHERE c.user_id = ?
        ORDER BY c.is_main DESC, c.level DESC, c.name ASC`
    )
    .all(user.id) as unknown as ProfileRow[]

  const characters: ProfileCharacter[] = rows.map((row) => ({
    id: row.id,
    region: row.region,
    realmSlug: row.realm_slug,
    realmName: row.realm_name,
    name: row.name,
    displayName: row.display_name,
    classId: row.class_id,
    level: row.level,
    faction: row.faction,
    avatar: row.avatar,
    professions: [row.profession_1, row.profession_2].filter(Boolean) as string[],
    isMain: row.is_main === 1,
    lastSeenAt: row.last_seen_at,
    statsReadAt: row.stats_read_at,
    // Filled in below, off the figures the account's own totals are merged into: a character with no
    // reading at all has no figures to rate, and the page prints a dash for it either way.
    score: 0,
    latest: row.taken_at === null
      ? null
      : {
          takenAt: row.taken_at,
          ilvl: row.ilvl,
          // The rating is read in the season Blizzard is running rather than in the one it was read in
          // (`server/utils/mplus`): a score from a season that has passed counts as nothing.
          mplus: seasonRating(row.mplus_score, row.taken_at),
          achievements: row.achievements,
          mounts: row.mounts,
          pets: row.pets,
          toys: row.toys,
          decor: row.decor,
          reputations: row.reputations,
          titles: row.titles,
          quests: row.quests,
          recipes: row.recipes,
          transmogs: row.transmogs,
          honorableKills: row.honorable_kills,
          honorLevel: row.honor_level
        }
  }))

  // The account's totals: a WoW collection is shared across the whole Battle.net account, so nothing
  // here is added up over the roster. Blizzard's own account collection is read where it exists, and the
  // best character's reading stands in where it does not - `MAX`, never `SUM` (see
  // `server/utils/accountPool`). Read before the rows below, because they are merged with it.
  const account = readAccountTotals(user.id)

  // Every figure a row prints is the best of two readings of the same account - the one stored for that
  // character and the account's own totals - merged by the site's one rule (`bestFigures`), which is the
  // merge the character page and the hall of fame's row are answered with as well. These rows used to be
  // given the raw pool instead: no merge, so a reading that ran ahead of a pool still filling in was
  // thrown away, and no achievement points at all, so the account printed one number on its own page and
  // another on the character page it was opened from. The item level and the level stay the character's
  // own - no account has a "best" of either to stand for it - and the rating on these rows is the
  // character's own reading too, because these are the account's characters rather than the account
  // itself (the account's own rating is in `totals` below).
  for (const character of characters) {
    const latest = character.latest
    if (!latest) continue

    const figures = bestFigures(
      {
        achievements: latest.achievements ?? 0,
        mounts: latest.mounts ?? 0,
        pets: latest.pets ?? 0,
        toys: latest.toys ?? 0,
        decor: latest.decor ?? 0,
        reputations: latest.reputations ?? 0
      },
      account
    )

    // A figure neither source knows keeps its `null`, which the page prints as a dash rather than as a
    // zero: an account whose characters have never been read has no figures to print, not nought of them.
    latest.achievements = figures.achievements || latest.achievements
    latest.mounts = figures.mounts || latest.mounts
    latest.pets = figures.pets || latest.pets
    latest.toys = figures.toys || latest.toys
    latest.decor = figures.decor || latest.decor
    latest.reputations = figures.reputations || latest.reputations

    // And the six beside them, merged the same way and under the same rule (`bestExtras`): the reading this
    // character's snapshot carries against the account's own totals, which is what makes a title, a quest or a
    // recipe the account's union rather than one character's rows.
    const extras = bestExtras(
      {
        titles: latest.titles ?? 0,
        quests: latest.quests ?? 0,
        recipes: latest.recipes ?? 0,
        transmogs: latest.transmogs ?? 0,
        honorableKills: latest.honorableKills ?? 0,
        honorLevel: latest.honorLevel ?? 0
      },
      account
    )

    latest.titles = extras.titles || latest.titles
    latest.quests = extras.quests || latest.quests
    latest.recipes = extras.recipes || latest.recipes
    latest.transmogs = extras.transmogs || latest.transmogs
    latest.honorableKills = extras.honorableKills || latest.honorableKills
    latest.honorLevel = extras.honorLevel || latest.honorLevel

    // And the rating of the very figures above, computed here rather than by the page that prints them:
    // the number and the figures it was made from travel together, so the account's page, the character
    // page and the hall of fame's row cannot disagree about one player.
    character.score = calculatePlayerScore(figures)
  }

  const totals: ProfileTotals = {
    characters: characters.length,
    mplus: account.mplus,
    achievements: account.achievements,
    mounts: account.mounts,
    pets: account.pets,
    toys: account.toys,
    decor: account.decor,
    reputations: account.reputations,
    ...account.extra,
    score: account.score,
    accountWide: account.accountWide
  }

  return {
    user: {
      bnetSub: user.bnetSub,
      battletag: user.battletag,
      mainCharacterId: user.mainCharacterId,
      hideFromFame: user.hideFromFame,
      /**
       * Whether the account's Battle.net sign-in has stopped working (`server/utils/session`).
       *
       * It rides along with the identity because it changes what the page *says* rather than what it holds:
       * the roster and the account's collections are the figures a dead grant freezes, and the page draws the
       * notice and the way back in with this flag rather than discovering it from a failed button.
       */
      authExpired: user.authExpired,
      /**
       * Whether this account may open the admin panel (`server/utils/siteSettings`).
       *
       * It rides along with the identity for the same reason `authExpired` does: it changes what a *control*
       * may offer rather than what the payload holds. The menu draws its entries from this flag, and the panel
       * itself is served by an endpoint that asks the question again - a flag a browser could set is a flag, not
       * a permission (`server/api/admin/settings`).
       */
      isAdmin: isAdmin(user.battletag)
    },
    characters,
    totals
  }
})
