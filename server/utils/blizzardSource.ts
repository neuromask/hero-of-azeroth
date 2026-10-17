/**
 * What asked for a Blizzard call, carried down to the one place that counts them.
 *
 * The wrapper (`callBlizzard` in `./blizzard`) is the only place a request to Blizzard is made, and it is also
 * where the counters live - but it has no idea *why* it was called: it sees a URL, and the URL of a character
 * read is the same whether a reader opened the page, a card was being drawn or the timer was filling a roster.
 *
 * Threading a parameter through every function between the entry point and the wrapper would mean changing every
 * signature in the read path for a diagnostic. So the answer travels where the async call stack already goes:
 * `AsyncLocalStorage` keeps one value per *call chain*, the entry point sets it once, and the wrapper reads it.
 * Nothing in between is touched, and no request ever sees another's tag.
 *
 * It deliberately does not survive a fire-and-forget call made *outside* the chain that set it - `void
 * something()` inside a tagged handler still carries the tag (the promise chain inherits the context), but a
 * timer created earlier does not, and lands in `other`. That is the honest answer: an untagged caller is one
 * nobody has classified yet, and `other` in the panel is the signal to go and classify it.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { BLIZZARD_SOURCES, type BlizzardSource } from '#shared/data/adminDiagnostics'

const storage = new AsyncLocalStorage<BlizzardSource>()

/** The source of the call being made, or `other` when nothing tagged this call chain. */
export function currentBlizzardSource(): BlizzardSource {
  return storage.getStore() ?? 'other'
}

/** Runs `run` with every Blizzard call it makes attributed to `source`. */
export function runWithBlizzardSource<T>(source: BlizzardSource | string, run: () => T): T {
  const known = (BLIZZARD_SOURCES as readonly string[]).includes(source) ? (source as BlizzardSource) : 'other'
  return storage.run(known, run)
}

/**
 * The source of a character read, as the public endpoints see it.
 *
 * A forced read is the Refresh button, and it is worth its own row: it spends the quota on purpose, it is the one
 * public act that does, and a panel that lumped it in with ordinary page views could not show an operator how
 * much of the traffic was somebody pressing a button.
 */
export function characterReadSource(force: boolean): BlizzardSource {
  return force ? 'profile_refresh' : 'profile_read'
}

/**
 * The source of a shelf or a feed beside the profile: collections, achievements, reputations, the activity feed and
 * the wardrobe tray. Kept apart from `profile_read` because they are opened as pages and panels of their own, and a
 * profile view that also opens three shelves is four rows of traffic, not one. A forced read is still the Refresh
 * button, whatever it refreshes.
 */
export function collectionReadSource(force: boolean): BlizzardSource {
  return force ? 'profile_refresh' : 'collection_read'
}
