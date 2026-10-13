/**
 * The characters an account remembers, in SQLite.
 *
 * The two lists a search field draws - what the account looked up, and what it saved with a star for a
 * comparison - kept beside the account rather than in one browser, which is what makes them follow a reader
 * from device to device. The shape, the key, the limits and the parser are the ones both ends write
 * (`#shared/utils/savedCharacters`); this module is the storage: one row per character carrying two moments
 * - when it was last looked up and when it was starred - cut at those limits after every write, so a row
 * that has fallen out of both lists stops existing rather than being kept for nobody.
 *
 * The connection comes from the auto-imported `useDb()` (which is what lets a test point this module at an
 * in-memory database), the clock from `./db` directly.
 */
import {
  SAVED_RECENT_LIMIT,
  SAVED_STARRED_LIMIT,
  searchHistoryKey,
  toSearchHistoryEntry,
  type SearchHistoryEntry
} from '#shared/utils/savedCharacters'
import { nowSec } from './db'

/** The columns both lists are read from, which is every part of an entry a row is drawn with. */
const READ_COLUMNS = 'region, realm_slug, name, realm_name, class_id, class_slug, avatar'

/** A row of `saved_characters` as it is read out. */
interface SavedRow {
  region: string
  realm_slug: string
  name: string
  realm_name: string | null
  class_id: number | null
  class_slug: string | null
  avatar: string | null
}

/** The two lists as an account holds them, newest first, each cut at its own limit. */
export interface SavedLists {
  starred: SearchHistoryEntry[]
  recent: SearchHistoryEntry[]
}

/**
 * A row as the shape the browser draws a row from.
 *
 * The region is narrowed rather than trusted: the column was written from a parsed entry, so a row is only
 * ever read back into the shape it was written in - but that shape is what every list and every chip on the
 * site is expressed in, so the one place a row becomes one is the one place the narrowing belongs.
 */
function toEntry(row: SavedRow): SearchHistoryEntry {
  return {
    name: row.name,
    realm: row.realm_slug,
    region: row.region === 'us' ? 'us' : 'eu',
    realmName: row.realm_name || row.realm_slug,
    classId: row.class_id ?? undefined,
    class: row.class_slug ?? undefined,
    avatar: row.avatar ?? undefined
  }
}

/** What the account remembers, as the two lists a search field offers. */
export function listSavedCharacters(userId: number): SavedLists {
  const db = useDb()

  const starred = db
    .prepare(
      `SELECT ${READ_COLUMNS} FROM saved_characters
        WHERE user_id = ? AND starred_at IS NOT NULL
        ORDER BY starred_at DESC, id DESC
        LIMIT ?`
    )
    .all(userId, SAVED_STARRED_LIMIT) as unknown as SavedRow[]

  const recent = db
    .prepare(
      `SELECT ${READ_COLUMNS} FROM saved_characters
        WHERE user_id = ? AND seen_at IS NOT NULL
        ORDER BY seen_at DESC, id DESC
        LIMIT ?`
    )
    .all(userId, SAVED_RECENT_LIMIT) as unknown as SavedRow[]

  return { starred: starred.map(toEntry), recent: recent.map(toEntry) }
}

/**
 * The statement every write goes through: the row of a character, created when the account has never
 * remembered it and refreshed when it has.
 *
 * `COALESCE` on both moments *and* on the parts a row is drawn with is deliberate. A write carries one
 * intention - this was looked up, or this was starred - so it must not blank the other half of the row, and
 * it must not lose the portrait and the class an earlier read had already kept.
 */
const UPSERT = `
INSERT INTO saved_characters
  (user_id, region, realm_slug, name_key, name, realm_name, class_id, class_slug, avatar, seen_at, starred_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(user_id, region, realm_slug, name_key) DO UPDATE SET
  name = excluded.name,
  realm_name = COALESCE(excluded.realm_name, saved_characters.realm_name),
  class_id = COALESCE(excluded.class_id, saved_characters.class_id),
  class_slug = COALESCE(excluded.class_slug, saved_characters.class_slug),
  avatar = COALESCE(excluded.avatar, saved_characters.avatar),
  seen_at = COALESCE(excluded.seen_at, saved_characters.seen_at),
  starred_at = COALESCE(excluded.starred_at, saved_characters.starred_at)
`

/** The key a row is unique on, as the statements beside this one spell it. */
const KEY_WHERE = 'user_id = ? AND region = ? AND realm_slug = ? AND name_key = ?'

/** One row, inside the transaction of the write it belongs to. */
function writeRow(userId: number, entry: SearchHistoryEntry, seenAt: number | null, starredAt: number | null): void {
  useDb()
    .prepare(UPSERT)
    .run(
      userId,
      entry.region,
      entry.realm,
      searchHistoryKey(entry),
      entry.name,
      entry.realmName,
      entry.classId ?? null,
      entry.class ?? null,
      entry.avatar ?? null,
      seenAt,
      starredAt
    )
}

/**
 * Drops what neither list holds any more.
 *
 * The two lists are windows over the same rows, so the account keeps a character while either of them can
 * still show it - the twenty newest lookups and the twelve newest stars - and stops keeping anything else.
 * It runs inside the transaction of the write that moved a row rather than on a pass of its own: the cut is
 * decided by the moments that write just changed, and a list a reader can see is the only reason the limits
 * exist at all.
 */
function prune(userId: number): void {
  const db = useDb()
  const keep = new Set<number>()

  const newest = (orderColumn: string, limit: number) =>
    db
      .prepare(
        `SELECT id FROM saved_characters
          WHERE user_id = ? AND ${orderColumn} IS NOT NULL
          ORDER BY ${orderColumn} DESC, id DESC
          LIMIT ?`
      )
      .all(userId, limit) as unknown as { id: number }[]

  for (const row of newest('seen_at', SAVED_RECENT_LIMIT)) keep.add(row.id)
  for (const row of newest('starred_at', SAVED_STARRED_LIMIT)) keep.add(row.id)

  const remembered = db.prepare('SELECT id FROM saved_characters WHERE user_id = ?').all(userId) as unknown as {
    id: number
  }[]

  const remove = db.prepare('DELETE FROM saved_characters WHERE user_id = ? AND id = ?')
  for (const row of remembered) {
    if (!keep.has(row.id)) remove.run(userId, row.id)
  }
}

/** One write in one transaction: a row and the cut it may have moved are one intention. */
function transact(work: () => void): void {
  const db = useDb()
  db.exec('BEGIN')
  try {
    work()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * A character the account just looked up, which is what puts it at the front of a search field's list.
 *
 * `now` is a parameter rather than a call to the clock inside, because the order those two lists are in *is*
 * the answer they give: a test that wants to pin it has to be able to say when each write happened.
 */
export function rememberSavedCharacter(userId: number, entry: SearchHistoryEntry, now: number = nowSec()): void {
  transact(() => {
    writeRow(userId, entry, now, null)
    prune(userId)
  })
}

/**
 * The star on a row, either way.
 *
 * Explicit rather than a toggle: the browser knows which way it went, and a toggle would make the answer
 * depend on how many times a request arrived - a retry would unstar a character as easily as star it. In
 * the other direction the row is left standing rather than deleted, because a character that is no longer
 * saved may still be one the account looked up, and only the cut that follows decides whether anything is
 * left of it at all.
 */
export function setSavedCharacterStar(
  userId: number,
  entry: SearchHistoryEntry,
  starred: boolean,
  now: number = nowSec()
): void {
  transact(() => {
    if (starred) {
      writeRow(userId, entry, null, now)
    } else {
      useDb()
        .prepare(`UPDATE saved_characters SET starred_at = NULL WHERE ${KEY_WHERE}`)
        .run(userId, entry.region, entry.realm, searchHistoryKey(entry))
    }
    prune(userId)
  })
}

/**
 * The cross in the list: gone from both halves of it.
 *
 * The row may be there because the character was looked up, because it was saved, or because of both - and
 * the cross means "not this one any more" rather than "not in this half", so one statement takes the row.
 */
export function forgetSavedCharacter(userId: number, entry: { region: string; realm: string; name: string }): void {
  useDb()
    .prepare(`DELETE FROM saved_characters WHERE ${KEY_WHERE}`)
    .run(userId, entry.region, entry.realm, searchHistoryKey(entry))
}

/**
 * What a browser hands over the first time its reader signs in: the lists it had been keeping for itself.
 *
 * The browser's lists are newest-first and carry no moments of their own - `localStorage` holds an entry, not
 * a history - so the order is the only truth they have: entry `i` is written as if it had happened `i`
 * seconds ago, which lands the front of that list at the front of the account's. That is deliberate rather
 * than a second best: the reader is looking at the list they had a moment ago, and the account's copy has to
 * agree with what is on the screen. A character looked up on another device an hour ago may fall out of the
 * twenty because of it - and the list the reader can see is the one that wins, once, because the browser
 * records that it has handed its copy over (`SAVED_ACCOUNT_KEY`) and never offers it again.
 */
export function importSavedCharacters(userId: number, lists: SavedLists, now: number = nowSec()): void {
  transact(() => {
    lists.starred.slice(0, SAVED_STARRED_LIMIT).forEach((entry, index) => writeRow(userId, entry, null, now - index))
    lists.recent.slice(0, SAVED_RECENT_LIMIT).forEach((entry, index) => writeRow(userId, entry, now - index, null))
    prune(userId)
  })
}

/**
 * The entry in a request body, or `null`.
 *
 * A body is a stranger's whatever the page in front of it is, so it goes through the very reader a row the
 * site wrote is read with (`toSearchHistoryEntry`) and a value that fails it is dropped instead of being
 * stored half-way.
 */
export function readSavedEntry(body: unknown): SearchHistoryEntry | null {
  return toSearchHistoryEntry((body as { entry?: unknown } | null)?.entry)
}

/** The same for a list of entries, which is the shape one hand-over of a browser's lists arrives in. */
export function readSavedList(value: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.map(toSearchHistoryEntry).filter((entry): entry is SearchHistoryEntry => entry !== null)
}


