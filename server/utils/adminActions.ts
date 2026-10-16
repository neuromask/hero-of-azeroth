/**
 * The two things an administrator may *do* from the panel, as functions a test can call.
 *
 * The endpoints around them (`server/api/admin/*.post.ts`) are the gate and the shape of the answer; what is
 * here is the work - reading a character out of a form's three fields, and running SQLite's own `optimize`
 * pragma - kept apart so it can be exercised against a throwaway database without an HTTP request. Neither
 * function decides who may call it: authorization belongs to `requireAdminAction` (`./requireAdmin`), which is
 * the first statement of both endpoints.
 */
import type { CharacterRow } from './accountSync'
// The route-parameter reader the rest of the character-facing code uses, imported rather than left to Nitro's
// auto-import: this module is also exercised by the unit tests, which have no Nitro to install it.
import { decodeRouteParam } from './params'

/** What an administrator typed into the refresh form. */
export interface TargetCharacterInput {
  characterId?: unknown
  region?: unknown
  realm?: unknown
  name?: unknown
}

/** A character's name is a name: the letters, digits and punctuation WoW allows, and nothing longer than WoW does. */
const NAME_PATTERN = /^[\p{L}\p{N}]{1,12}$/u
/** A realm is a slug or a display name; the site stores the slug it lower-cases to. */
const REALM_PATTERN = /^[\p{L}\p{N}' -]{1,40}$/u

/**
 * The row an administrator asked to refresh, or `null` when the site holds no such character.
 *
 * Two ways to name one, in the order the endpoint documents them: the record's own `characterId` - the one the
 * profile page would use - or the three address segments, normalised exactly the way the record is keyed
 * (`region` lower-case, `realm_slug` and `name_key` lower-cased, `./params`). Everything arrives as
 * `unknown`, because it came off the wire, and nothing that is not a name the game could have is looked up -
 * an address that is not a shape the site stores is answered as "no such character" rather than passed to
 * SQLite.
 */
export function resolveTargetCharacter(input: TargetCharacterInput): CharacterRow | null {
  const id = Number(input.characterId)
  if (Number.isInteger(id) && id > 0) {
    return (
      (useDb()
        .prepare('SELECT id, user_id, region, realm_slug, name, name_key, is_main FROM characters WHERE id = ?')
        .get(id) as CharacterRow | undefined) ?? null
    )
  }

  const region = String(input.region ?? '').trim().toLowerCase().replace(/^region-/, '')
  const realm = decodeRouteParam(String(input.realm ?? '')).trim().toLowerCase()
  const name = decodeRouteParam(String(input.name ?? '')).trim()

  const known = typeof input.region === 'string' && (region === 'eu' || region === 'us')
  if (!known || !REALM_PATTERN.test(realm) || !NAME_PATTERN.test(name)) return null

  return (
    (useDb()
      .prepare(
        'SELECT id, user_id, region, realm_slug, name, name_key, is_main FROM characters WHERE region = ? AND realm_slug = ? AND name_key = ?'
      )
      .get(region, realm, name.toLowerCase()) as CharacterRow | undefined) ?? null
  )
}

/**
 * Runs SQLite's own `PRAGMA optimize`, which decides for itself whether there is anything worth doing.
 *
 * It is the maintenance this database wants: SQLite's query planner keeps per-index statistics, and `optimize`
 * refreshes the ones a hot index's queries suggest are stale - a cheap, bounded, well-understood operation
 * that never rewrites the file and cannot be made to run long by a request. What it deliberately is *not*:
 * `VACUUM`, an integrity check, a rebuild - those are heavy, they lock the database for the duration, and
 * nothing an operator can press should be able to do that to a site its readers are using.
 *
 * A failure is returned rather than thrown so the endpoint can answer with a status of its own choosing.
 */
export function optimizeDatabase(): { durationMs: number } {
  const startedAtMs = Date.now()
  useDb().exec('PRAGMA optimize')
  return { durationMs: Date.now() - startedAtMs }
}
