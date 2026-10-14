/**
 * A per-character stamp that moves whenever the character's profile is re-read from Blizzard on purpose.
 *
 * The character endpoint serves a profile through its own stale-while-revalidate store (`./swrCache` in
 * `server/api/character`), and a `?force=true` request - the Refresh button - re-reads Blizzard and stores
 * the fresh copy. The shelves that draw from the same character (collections, achievements, reputations)
 * keep their own SWR stores keyed by the character's address, and a Refresh that reached the profile but
 * not those stores would leave a reader with a fresh overview and a shelf up to two hours old.
 *
 * This stamp is folded into every shelf's cache key, the way the hall of fame folds its own data stamp into
 * the table's key (`server/utils/leaderboardStorage`): a bump makes the old entry unreachable - filed under
 * a stamp nobody asks for again - rather than reachable-but-stale. The map is bounded by the process
 * lifetime (it restarts on deploy), which is also the lifetime of the SWR stores it invalidates.
 */
const revisions = new Map<string, number>()

/** How many stamps are kept before the oldest is dropped; a process rarely holds more than a few hundred. */
const REVISION_LIMIT = 2000

/** A character's three address segments, spelled the way an endpoint holds them. */
function keyOf(region: string, realm: string, name: string): string {
  return `${region}:${realm.toLowerCase()}:${name.toLowerCase()}`
}

/** The current stamp of a character, `0` for one never force-refreshed since the process started. */
export function profileRevision(region: string, realm: string, name: string): number {
  return revisions.get(keyOf(region, realm, name)) ?? 0
}

/** Marks a character's profile as freshly read, so every shelf cached against the old one is stale. */
export function bumpProfileRevision(region: string, realm: string, name: string): void {
  const key = keyOf(region, realm, name)

  if (!revisions.has(key) && revisions.size >= REVISION_LIMIT) {
    const oldest = revisions.keys().next().value
    if (oldest !== undefined) revisions.delete(oldest)
  }

  revisions.set(key, (revisions.get(key) ?? 0) + 1)
}

/** Drops every stamp, for a test that has to start from a clean map. */
export function clearProfileRevisions(): void {
  revisions.clear()
}