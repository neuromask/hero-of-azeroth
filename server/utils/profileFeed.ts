/**
 * One profile written into both of the stores the site keeps from it.
 *
 * A character page is a Blizzard lookup, and a lookup that came back with somebody is the moment
 * the site learns two things at once: that a page exists (which is what the sitemap's index is for,
 * see `./characterIndex`) and what the character was when it was read (which is what the hall of
 * fame's table is for, see `./leaderboardStorage`). Both are written from here, and from nowhere
 * else, because *every* reader of a profile has to feed both of them.
 *
 * That is the rule the two stores were missing. A profile is read by more than the character page:
 * the card the page previews as and the front door shares is read by crawlers, by every share of a
 * link and by the download button, and a lookup that filled the index and the table only from the
 * character endpoint left the readers of the other one with a row that was missing everything the
 * profile had said - a portrait, a faction, the pets, the toys, the decor, the achievements -
 * while the card drawn from the very same profile showed all of it.
 *
 * It is one function rather than two calls beside each other at each reader for the same reason the
 * table and the index are written in one place each: what a Blizzard profile becomes when it is
 * stored is a single decision, and a second copy of the mapping is a copy that drifts. Each of the
 * two writes swallows its own failure, because a record that could not be written is a stale row
 * rather than a broken page - so this awaits both and still cannot fail the request it is made for.
 */
import type { CharacterData } from './blizzard'
import type { BlizzardRegion } from './params'

/** A freshly read profile, and the three address segments it belongs to. */
export interface ProfileFeedInput {
  region: BlizzardRegion
  /** The realm's slug, lowercased: what an address and a record are keyed by. */
  realm: string
  /** The character's name, lowercased. */
  name: string
  profile: CharacterData
}

export async function feedProfile({ region, realm, name, profile }: ProfileFeedInput): Promise<void> {
  // Everything a stored record is made of, read off the profile once. Both stores are filled from
  // the same list on purpose: a field the table prints is a field the index has to keep, or the
  // table's own backfill (`backfillFromIndex`) would write rows without it.
  const figures = {
    displayName: profile.name,
    avatar: profile.avatarUrl,
    faction: profile.faction,
    classId: profile.classId,
    level: profile.level,
    ilvl: profile.ilvl,
    mPlusScore: profile.mPlusScore,
    mounts: profile.stats.mounts.count,
    pets: profile.stats.pets.count,
    toys: profile.stats.toys.count,
    decor: profile.stats.decor.count,
    achievements: profile.ap
  }

  // The sitemap's index: the page exists, and what the character was when it was seen.
  await rememberCharacter({ region, realm, name, ...figures })

  // The hall of fame's table: the row the page's history is read from. The realm's own name rides
  // along here too - the index knows the slug alone, and a row prints the realm as the game spells
  // it.
  await upsertPlayer({ region, realm, name, realmName: profile.realm, ...figures })
}
