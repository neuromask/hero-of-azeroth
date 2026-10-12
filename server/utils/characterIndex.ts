/**
 * The characters the site has ever rendered, which is the only list of its pages a crawler
 * can be handed without guessing.
 *
 * A character page exists the moment a lookup finds somebody - the game has no index of its
 * players to read - so the site keeps its own. Every search that came back with a character
 * is written down, and the sitemap is built from what the list kept. It is de-duplicated by
 * the address a record names and bounded, so a character searched a hundred times is one
 * line and the stalest page falls off the end.
 *
 * It is one JSON document in the app's own data directory (`./appPaths`), written through a temporary file
 * so a process that dies mid-write leaves the previous list whole, and read back whenever the sitemap is
 * built - which is what keeps the pages a crawler has been told about across a restart and a redeploy.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dataDirectory } from './appPaths'
import type { BlizzardRegion } from './params'

export interface IndexedCharacter {
  /** The Blizzard region, as the endpoints spell it (`eu`, `us`). */
  region: BlizzardRegion
  /** The realm's slug, which is the part an address carries. */
  realm: string
  /** The character's name, lowercased: the address segment, and the half the list is unique on. */
  name: string
  /** The day the character was last seen, `YYYY-MM-DD`, which is the sitemap's `lastmod`. */
  updatedAt: string
  /** The day the site first met the character, `YYYY-MM-DD`: a later lookup cannot tell it. */
  firstSeenAt?: string
  /** The name as the game spells it, which the address cannot carry - an address is lowercased. */
  displayName?: string
  /**
   * What the profile said the day the character was seen: its portrait, the side it plays for, its
   * level, the class Blizzard ids it by, the item level it was wearing, its Mythic+ rating and what
   * it had gathered.
   *
   * None of it is a page - the map is built from the addresses - but it is what makes the map worth
   * opening for a reader: the file a browser paints is a page about the characters the site has been
   * asked about, and what they were when they were asked for. It is the same list the hall of fame's
   * table is filled from when it has no file of its own (`backfillFromIndex` in
   * `./leaderboardStorage`), which is the other reason it is kept whole: a record that carries only
   * half of what a row prints writes a table of rows without a portrait and without a faction, and a
   * backfilled row is only ever completed by looking that character up again. A record written before
   * a field was kept simply carries none of it, and every field is optional for exactly that reason.
   */
  avatar?: string
  faction?: string
  level?: number
  classId?: number
  ilvl?: number
  mPlusScore?: number
  mounts?: number
  pets?: number
  toys?: number
  decor?: number
  reputations?: number
  achievements?: number
}

/**
 * The file the whole list is kept in, beside the database and the hall of fame's table.
 *
 * Read and written directly rather than through a Nitro storage mount: a mount's `base` is resolved against
 * the working directory of the process, which would put the list somewhere else the moment the app is
 * started from a directory that is not its own - and `./appPaths` is the one answer to where the data is.
 */
const INDEX_FILE = join(dataDirectory(), 'characters.json')

/**
 * How many characters the list holds. Each one is two URLs in the sitemap and a sitemap may
 * name fifty thousand, so this stays far short of the limit while keeping a personal site's
 * file small; past it the least recently seen character falls off the end.
 */
const INDEX_LIMIT = 5000

/** The day a record was written, in the `YYYY-MM-DD` a sitemap reads a `lastmod` as. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The identity a record is unique on: its three address segments, lowercased. */
function identity(record: Pick<IndexedCharacter, 'region' | 'realm' | 'name'>): string {
  return `${record.region}:${record.realm}:${record.name}`.toLowerCase()
}

/** The list as it is stored; a file that is missing, unreadable or not a list reads as an empty one. */
export async function readCharacterIndex(): Promise<IndexedCharacter[]> {
  try {
    const stored: unknown = JSON.parse(await readFile(INDEX_FILE, 'utf8'))
    return Array.isArray(stored) ? (stored as IndexedCharacter[]) : []
  } catch {
    // No list yet, or one nothing can read: nobody has been looked up, which is where a site starts.
    return []
  }
}

/**
 * Writes the list through a temporary file.
 *
 * The rename is what makes the write atomic, and the list is the only record of the pages the site can
 * serve: a process that dies while writing leaves the previous list whole rather than half of a new one.
 */
async function writeIndex(list: IndexedCharacter[]): Promise<void> {
  await mkdir(dirname(INDEX_FILE), { recursive: true })
  const temporary = `${INDEX_FILE}.tmp`

  await writeFile(temporary, JSON.stringify(list), 'utf8')
  await rename(temporary, INDEX_FILE)
}

/**
 * Writes a character down, or refreshes the day of one already in the list.
 *
 * The list is the only record the site has of the pages it can serve, so a lost update is a
 * page a crawler is never told about. Writes are therefore threaded onto one promise chain:
 * two searches arriving together would otherwise read the same list, and the second would
 * write over the first. The chain is what makes each write see the one before it.
 */
let writes: Promise<void> = Promise.resolve()

export function rememberCharacter(character: {
  region: BlizzardRegion
  realm: string
  name: string
  displayName?: string
  avatar?: string
  faction?: string
  level?: number
  classId?: number
  ilvl?: number
  mPlusScore?: number
  mounts?: number
  pets?: number
  toys?: number
  decor?: number
  reputations?: number
  achievements?: number
}): Promise<void> {
  writes = writes.then(async () => {
    try {
      const index = await readCharacterIndex()
      const key = identity({
        region: character.region,
        realm: character.realm.toLowerCase(),
        name: character.name.toLowerCase()
      })
      const previous = index.find((entry) => identity(entry) === key)

      const record: IndexedCharacter = {
        region: character.region,
        realm: character.realm.toLowerCase(),
        name: character.name.toLowerCase(),
        updatedAt: today(),
        // What the profile carried is written down; what it did not is kept from the record this one
        // replaces, so a detail is only ever lost when the character itself stops reporting it. The
        // first day is the one thing no later lookup can tell, and it is kept for good.
        firstSeenAt: previous?.firstSeenAt || today(),
        displayName: character.displayName || previous?.displayName,
        avatar: character.avatar || previous?.avatar,
        faction: character.faction || previous?.faction,
        level: character.level ?? previous?.level,
        classId: character.classId ?? previous?.classId,
        ilvl: character.ilvl ?? previous?.ilvl,
        mPlusScore: character.mPlusScore ?? previous?.mPlusScore,
        mounts: character.mounts ?? previous?.mounts,
        pets: character.pets ?? previous?.pets,
        toys: character.toys ?? previous?.toys,
        decor: character.decor ?? previous?.decor,
        reputations: character.reputations ?? previous?.reputations,
        achievements: character.achievements ?? previous?.achievements
      }

      const rest = index.filter((entry) => identity(entry) !== key)
      // The character just seen goes to the front, so the cap above drops the stalest page.
      await writeIndex([record, ...rest].slice(0, INDEX_LIMIT))
    } catch {
      // Storage that cannot be written is not worth failing a search over: the sitemap simply
      // lists this character one visit later.
    }
  })

  return writes
}