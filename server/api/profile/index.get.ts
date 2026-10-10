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
  } | null
}

/** The account's own totals, as the profile page reads them. */
export interface ProfileTotals {
  characters: number
  ilvl: number | null
  mplus: number | null
  achievements: number
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
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
              c.stats_read_at,
              s.taken_at, s.ilvl, s.mplus_score, s.achievements, s.mounts, s.pets, s.toys, s.decor, s.reputations
         FROM characters c
         LEFT JOIN snapshots s ON s.id = (
           SELECT id FROM snapshots WHERE character_id = c.id ORDER BY taken_at DESC LIMIT 1
         )
        WHERE c.user_id = ?
        ORDER BY c.is_main DESC, c.level DESC, c.name ASC`
    )
    .all(user.id) as ProfileRow[]

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
    latest: row.taken_at === null
      ? null
      : {
          takenAt: row.taken_at,
          ilvl: row.ilvl,
          mplus: row.mplus_score,
          achievements: row.achievements,
          mounts: row.mounts,
          pets: row.pets,
          toys: row.toys,
          decor: row.decor,
          reputations: row.reputations
        }
  }))

  // Every collection tile is the account's, not the character's: mounts, pets, toys, decor and the
  // factions driven to Exalted are shared across the whole Battle.net account, so the account's own
  // pool is laid over the reading stored for the character (`server/utils/accountPool`). The item
  // level, the rating and the level stay the character's own - those are the numbers that are
  // actually theirs. A pool that is still empty leaves the reading as it was.
  const pool = readAccountPool(user.id)
  if (POOL_KINDS.some((kind) => pool[kind] > 0)) {
    for (const character of characters) {
      if (!character.latest) continue

      character.latest.mounts = pool.mounts || character.latest.mounts
      character.latest.pets = pool.pets || character.latest.pets
      character.latest.toys = pool.toys || character.latest.toys
      character.latest.decor = pool.decor || character.latest.decor
      character.latest.reputations = pool.reputations || character.latest.reputations
    }
  }

  // The account's totals: a WoW collection is shared across the whole Battle.net account, so
  // nothing here is added up over the roster. Blizzard's own account collection is read where it
  // exists, and the best character's reading stands in where it does not - `MAX`, never `SUM`
  // (see `server/utils/accountPool`).
  const account = readAccountTotals(user.id)
  const totals: ProfileTotals = {
    characters: characters.length,
    ilvl: account.ilvl,
    mplus: account.mplus,
    achievements: account.achievements,
    mounts: account.mounts,
    pets: account.pets,
    toys: account.toys,
    decor: account.decor,
    reputations: account.reputations,
    score: account.score,
    accountWide: account.accountWide
  }

  return {
    user: {
      bnetSub: user.bnetSub,
      battletag: user.battletag,
      mainCharacterId: user.mainCharacterId,
      hideFromFame: user.hideFromFame
    },
    characters,
    totals
  }
})
