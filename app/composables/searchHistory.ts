/**
 * The characters this browser has looked up.
 *
 * A search that found its character is worth keeping: the front page can then offer the name
 * to type and the realm to search it on. The list is a convenience rather than a log, so it is
 * bounded, deduplicated and kept in `localStorage` - it outlives the tab, which is what makes
 * it useful next visit, and it never leaves the browser.
 *
 * The character page is where a search proves successful (it rendered a character), so that is
 * where `remember` is called; the front page reads the same list under the name field.
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
}

/** Where the list is kept, and how many characters it holds. */
export const SEARCH_HISTORY_KEY = 'hoa_search_history'
export const SEARCH_HISTORY_LIMIT = 10

/** The identity an entry is unique on: the pair read as one string. */
export function searchHistoryKey(entry: SearchHistoryEntry): string {
  return `${entry.region}:${entry.realm}:${entry.name.toLowerCase()}`
}

/** A value from storage as an entry, or `null` when it is not the shape this wrote. */
function toEntry(value: unknown): SearchHistoryEntry | null {
  const entry = value as Partial<SearchHistoryEntry>
  if (!entry || typeof entry.name !== 'string' || typeof entry.realm !== 'string' || !entry.name || !entry.realm) {
    return null
  }
  const region = entry.region === 'us' ? 'us' : entry.region === 'eu' ? 'eu' : null
  if (!region) return null

  return {
    name: entry.name,
    realm: entry.realm,
    region,
    realmName: typeof entry.realmName === 'string' && entry.realmName ? entry.realmName : entry.realm
  }
}

/**
 * A browser can refuse storage outright - a private window, site data blocked - so every read
 * and write is wrapped: without it the field simply offers nothing and remembers nothing,
 * and the form keeps working.
 */
function readStorage(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(toEntry).filter((entry): entry is SearchHistoryEntry => entry !== null)
  } catch {
    return []
  }
}

function writeStorage(entries: SearchHistoryEntry[]) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // Nothing to do: losing the list breaks nothing.
  }
}

/**
 * The list of searched characters and the ways it changes. Every instance reads `localStorage`
 * for itself, because a page fills its own copy on mount (the server has none) and the writes
 * keep that copy in step.
 */
export function useSearchHistory() {
  const history = ref<SearchHistoryEntry[]>([])

  /** Reads what an earlier visit left behind. Call it from `onMounted`, when there is storage. */
  const load = () => {
    history.value = readStorage()
  }

  /**
   * Puts a character at the front of the list: the pair it is unique on is dropped from
   * wherever it sat, and the oldest past the limit falls off the end. Reads the stored list
   * rather than the in-memory copy, so a page that never called `load` - the character page,
   * which only writes - cannot overwrite the rest of the history with one entry.
   */
  const remember = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const rest = readStorage().filter((existing) => searchHistoryKey(existing) !== key)
    const next = [entry, ...rest].slice(0, SEARCH_HISTORY_LIMIT)

    writeStorage(next)
    history.value = next
  }

  /** Drops one character, by the pair the list is unique on. */
  const forget = (entry: SearchHistoryEntry) => {
    const key = searchHistoryKey(entry)
    const next = readStorage().filter((existing) => searchHistoryKey(existing) !== key)

    writeStorage(next)
    history.value = next
  }

  return { history, load, remember, forget }
}