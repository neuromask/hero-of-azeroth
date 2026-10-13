/**
 * A remembered character: the shape the two lists under a search field are written in, the key they are
 * unique on, and the storage a browser keeps them in.
 *
 * Two things are remembered this way - the characters a reader looked up, and the ones they saved with a
 * star for a comparison (`app/composables/searchHistory.ts`, `app/composables/versusFavorites.ts`) - and
 * they are one record remembered for two reasons, which is why there is one shape rather than two. It sits
 * in `shared/` because both ends of the wire write it: a browser keeps its own copy in `localStorage`, and a
 * reader who is signed in has the same two lists kept for their account (`server/utils/savedCharacters.ts`,
 * synced through `app/composables/savedCharacters.ts`). A request body is therefore parsed into an entry by
 * the very reader the browser writes one with, because a second parser for one type is how two lists come
 * to disagree about what a character is.
 */

/** One searched character: the three parts of its address, plus the realm's name for a row. */
export interface SearchHistoryEntry {
  /** The character's name as Blizzard spells it, which is what the field is filled with. */
  name: string
  /** The realm's slug, which is the part a page address carries. */
  realm: string
  /** The region the realm is in, which decides whether EU or US is searched. */
  region: 'eu' | 'us'
  /**
   * The realm's name as it read when the entry was written, so a row can name the realm before
   * the realm list has loaded; the list's own name wins once it is there.
   */
  realmName: string
  /**
   * The class the character was when the entry was written, so the front page can tint the
   * remembered name with its signature colour (see `#shared/utils/wow-class`). Blizzard's id
   * is the durable half and the Armoury slug is the readable one; both are optional, because a
   * row written before either was kept resolves to the brand gold instead of to no colour.
   */
  classId?: number
  class?: string
  /**
   * Blizzard's square portrait of the character, kept so the site can show who this browser is
   * "signed in" as without asking Blizzard for it again (`app/components/MyProfile.vue`). Optional,
   * because a row written before it was kept - and a character the media call had no picture for -
   * falls back to a monogram in the class colour.
   */
  avatar?: string
}

/** Where a browser keeps the characters it looked up, and the ones it saved with a star. */
export const SEARCH_HISTORY_KEY = 'hoa_search_history'
export const VERSUS_FAVORITES_KEY = 'hoa_versus_favorites'
/**
 * Where a browser records whose lists its own copy is: the account it handed them to
 * (`app/composables/savedCharacters.ts`). Absent means the copy has never belonged to an account, which is
 * what lets a reader's browser-side list be carried into the first account that signs in on it - and only
 * that one, so a second account on a shared machine is never handed the first one's lookups.
 */
export const SAVED_ACCOUNT_KEY = 'hoa_saved_account'

/**
 * How many characters each list holds, in the browser and on the account alike.
 *
 * Both are bounded because neither is a log: they are the way back to a character, and the reader who wants
 * an archive of who they have looked at does not exist. The account's copy is cut at the same numbers
 * (`server/utils/savedCharacters.ts`), so a list that survives a sign-out is the list that was on screen.
 */
export const SAVED_RECENT_LIMIT = 20
export const SAVED_STARRED_LIMIT = 12

/**
 * The identity a character is unique on, as one string: its three address segments, lowercased.
 *
 * The list below is deduplicated by it, and the hall of fame marks the reader's own row with it. The
 * two are answers about one character written by two different layers - an entry is written from the
 * profile the browser read, a row is written by the table's own storage - so the case a name happens
 * to be spelled in can differ between them, and lowercasing here is what lets the two be compared at
 * all rather than only matching when they were written the same way.
 */
export function searchHistoryKey(entry: { region: string; realm: string; name: string }): string {
  return `${entry.region}:${entry.realm}:${entry.name.toLowerCase()}`
}

/**
 * A value from storage - or from a request body - as an entry, or `null` when it is not the shape the site
 * writes.
 *
 * The one reader for that shape, shared by the browser, by the account's own copy and by the endpoints that
 * accept one: a body is a stranger's, so it is held to exactly the rules a row the site wrote obeys, and a
 * value that fails them is refused rather than half-stored.
 */
export function toSearchHistoryEntry(value: unknown): SearchHistoryEntry | null {
  const entry = value as Partial<SearchHistoryEntry>
  if (!entry || typeof entry.name !== 'string' || typeof entry.realm !== 'string' || !entry.name || !entry.realm) {
    return null
  }
  const region = entry.region === 'us' ? 'us' : entry.region === 'eu' ? 'eu' : null
  if (!region) return null

  const classId = typeof entry.classId === 'number' && entry.classId > 0 ? entry.classId : undefined
  const classSlug = typeof entry.class === 'string' && entry.class ? entry.class : undefined
  const avatar = typeof entry.avatar === 'string' && entry.avatar ? entry.avatar : undefined

  return {
    name: entry.name,
    realm: entry.realm,
    region,
    realmName: typeof entry.realmName === 'string' && entry.realmName ? entry.realmName : entry.realm,
    classId,
    class: classSlug,
    avatar
  }
}

/**
 * The list a search field offers: the characters somebody saved for a quick compare, and the ones they
 * looked up, as one list.
 *
 * The two are the same thing remembered for two reasons - a character somebody searched for, and a character
 * somebody starred (`app/composables/versusFavorites.ts`) - and a reader looking for one of them does not care
 * which list it went into, so a field offers them together rather than as two sections that would each have to
 * be searched. The saved ones come first (they were chosen on purpose), and the pair is deduplicated by the key
 * a character is unique on (`searchHistoryKey`) - so a saved character is never also drawn as a lookup of
 * itself, however the two happen to spell its case.
 */
export function mergeSearchEntries(
  saved: SearchHistoryEntry[],
  lookedUp: SearchHistoryEntry[]
): SearchHistoryEntry[] {
  const seen = new Set(saved.map((entry) => searchHistoryKey(entry)))
  return [...saved, ...lookedUp.filter((entry) => !seen.has(searchHistoryKey(entry)))]
}

/**
 * A string out of the reader's own storage, or `null` - and `null` on the server, where there is no storage
 * at all.
 *
 * A browser can refuse storage outright - a private window, site data blocked - so both directions are
 * wrapped: without it the field simply offers nothing and remembers nothing, and the form keeps working.
 * `globalThis` rather than the bare name because this module is imported on both sides of the wire: the
 * server renders the very components that read these lists.
 */
export function readStoredText(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStoredText(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Nothing to do: losing the list breaks nothing.
  }
}

/** One of the two lists as a browser holds it: what an earlier visit wrote, read into entries. */
export function readSavedEntries(key: string): SearchHistoryEntry[] {
  const raw = readStoredText(key)
  if (!raw) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(toSearchHistoryEntry).filter((entry): entry is SearchHistoryEntry => entry !== null)
  } catch {
    return []
  }
}

export function writeSavedEntries(key: string, entries: SearchHistoryEntry[]): void {
  writeStoredText(key, JSON.stringify(entries))
}
