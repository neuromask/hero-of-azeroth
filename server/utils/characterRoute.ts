/**
 * The shared prologue of every endpoint that answers for a character named as three address segments.
 *
 * Six endpoints read a character the same way - the region, the realm and the name out of the route, a locale
 * and a `force` flag out of the query - and each used to spell that prologue out for itself, in three different
 * spellings of the `force` flag. That is how a drift starts: a flag is accepted by one endpoint and not the
 * next, or a validation check is moved and the `requireRefreshBudget` call ends up inside the wrong block
 * (which is exactly what happened to the reputations endpoint). Reading the route in one place means a
 * character is read, validated and charged the same way everywhere it is asked for.
 */
import type { H3Event } from 'h3'
import { decodeRouteParam, parseRegion, type BlizzardRegion } from './params'

/** A character named by its three address segments, lowercased the way a record and a key use them. */
export interface CharacterRoute {
  region: BlizzardRegion
  /** The realm's slug, lowercased. */
  realm: string
  /** The character's name, lowercased. */
  name: string
}

/**
 * Reads and validates the three address segments every character endpoint takes.
 *
 * A missing realm or name is a 400 rather than a lookup: the Blizzard API cannot answer either, and the honest
 * answer to an address with a hole in it is the one the caller can correct.
 */
export function readCharacterRoute(event: H3Event): CharacterRoute {
  const region = parseRegion(getRouterParam(event, 'region'))
  const realm = decodeRouteParam(getRouterParam(event, 'realm')).toLowerCase()
  const name = decodeRouteParam(getRouterParam(event, 'name')).toLowerCase()

  if (!realm || !name) {
    throw createError({ statusCode: 400, statusMessage: 'Realm and Name are required' })
  }

  return { region, realm, name }
}

/**
 * A query flag, read the way a link, a fetch and a form each write it.
 *
 * `'true'`, `'1'`, `true` and `'on'` are all accepted, so a caller's spelling never decides whether a refresh
 * is forced.
 */
export function parseBoolFlag(value: unknown): boolean {
  return value === 'true' || value === '1' || value === true || value === 'on'
}

/** The API locale a caller asked for, `en_US` when it named none. */
export function apiLocale(query: Record<string, unknown>): string {
  return (query.locale as string) || 'en_US'
}

/**
 * A failed Blizzard read as the site's own answer.
 *
 * An error that already carries a status - a 404, a 429, a 503 - is the answer and is thrown as it is; a
 * failure with no status (a connection that died, a parse that broke) becomes a 500 that names what the
 * endpoint was trying to fetch, without leaking the upstream URL or body.
 */
export function mapBlizzardError(err: unknown, noun: string): never {
  const failure = err as { statusCode?: number }
  if (failure?.statusCode) throw err
  throw createError({ statusCode: 500, statusMessage: `Failed to fetch ${noun} from Blizzard API` })
}
