/**
 * What an account remembers: the two lists a search field draws, kept beside the account rather than in one
 * browser.
 *
 * These pin the rules a browser cannot pin for itself, because they are the rules an account adds: a character
 * is one row carrying two moments (looked up, starred) so that the same character in both lists is not two
 * rows, the two lists are windows over that one table and are cut at their own limits after every write, and a
 * browser's own lists are handed over once without anything the account already had being replaced.
 *
 * Time is handed to every write instead of being read from the clock, because the order these lists are in
 * *is* the answer they give: a test that wants to pin that order has to be able to say when each write
 * happened. The database is the in-memory one (`test/helpers/memoryDb.ts`), reached through the `useDb()` the
 * server modules call.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import {
  forgetSavedCharacter,
  importSavedCharacters,
  listSavedCharacters,
  readSavedEntry,
  readSavedList,
  rememberSavedCharacter,
  setSavedCharacterStar
} from '../../server/utils/savedCharacters'
import type { SearchHistoryEntry } from '../../shared/utils/savedCharacters'

/** The account every test writes for. */
const USER = 1

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
  memory.addUser(USER)
})

/** A remembered character, with only the parts a row is drawn from. */
function entry(name: string, realm = 'gordunni', region: 'eu' | 'us' = 'eu'): SearchHistoryEntry {
  return { name, realm, region, realmName: 'Gordunni' }
}

/** How many rows the account keeps altogether, which is what the two windows together leave behind. */
function rowCount(): number {
  const row = memory.db.prepare('SELECT COUNT(*) AS total FROM saved_characters WHERE user_id = ?').get(USER) as {
    total: number
  }
  return row.total
}

describe('the characters an account remembers', () => {
  it('keeps a character it looked up once, at the front, however its case is spelled', () => {
    rememberSavedCharacter(USER, entry('Neromask'), 100)
    rememberSavedCharacter(USER, entry('Rival'), 200)
    rememberSavedCharacter(USER, entry('neromask'), 300)

    expect(listSavedCharacters(USER).recent.map((row) => row.name)).toEqual(['neromask', 'Rival'])
    expect(rowCount()).toBe(2)
  })

  it('keeps the parts a row is drawn with when a later write leaves them out', () => {
    rememberSavedCharacter(USER, { ...entry('Neromask'), classId: 11, class: 'druid', avatar: 'portrait.jpg' }, 100)
    // The same character, remembered again by a page that read nothing but its name: the write is about the
    // lookup, and it must not take the portrait and the class off the row.
    rememberSavedCharacter(USER, entry('Neromask'), 200)

    expect(listSavedCharacters(USER).recent[0]).toMatchObject({ classId: 11, class: 'druid', avatar: 'portrait.jpg' })
  })

  it('keeps a star in its own list and the lookup in the other', () => {
    rememberSavedCharacter(USER, entry('Rival'), 100)
    setSavedCharacterStar(USER, entry('Rival'), true, 150)

    expect(listSavedCharacters(USER).starred.map((row) => row.name)).toEqual(['Rival'])
    expect(listSavedCharacters(USER).recent.map((row) => row.name)).toEqual(['Rival'])
    expect(rowCount()).toBe(1)

    setSavedCharacterStar(USER, entry('Rival'), false, 200)

    expect(listSavedCharacters(USER).starred).toEqual([])
    expect(listSavedCharacters(USER).recent.map((row) => row.name)).toEqual(['Rival'])
  })

  it('stops keeping a row that is neither looked up nor starred any more', () => {
    setSavedCharacterStar(USER, entry('Rival'), true, 100)
    setSavedCharacterStar(USER, entry('Rival'), false, 200)

    expect(rowCount()).toBe(0)
  })

  it('forgets a character entirely, from both halves of the list', () => {
    rememberSavedCharacter(USER, entry('Rival'), 100)
    setSavedCharacterStar(USER, entry('Rival'), true, 110)
    forgetSavedCharacter(USER, entry('Rival'))

    expect(listSavedCharacters(USER)).toEqual({ starred: [], recent: [] })
    expect(rowCount()).toBe(0)
  })

  it('keeps the twenty newest lookups and the twelve newest stars, and nothing besides', () => {
    for (let index = 1; index <= 25; index++) rememberSavedCharacter(USER, entry(`Lookup${index}`), index)

    const { recent } = listSavedCharacters(USER)
    expect(recent).toHaveLength(20)
    expect(recent[0]!.name).toBe('Lookup25')
    expect(recent.at(-1)!.name).toBe('Lookup6')
    expect(rowCount()).toBe(20)

    for (let index = 1; index <= 14; index++) setSavedCharacterStar(USER, entry(`Star${index}`), true, 1000 + index)

    const starred = listSavedCharacters(USER).starred
    expect(starred).toHaveLength(12)
    expect(starred[0]!.name).toBe('Star14')
    // The twenty lookups and the twelve stars together, minus the characters in both windows - none here.
    expect(rowCount()).toBe(32)
  })
})

describe('the lists a browser hands over when its reader signs in', () => {
  it('takes them in the order they were held, both of them', () => {
    importSavedCharacters(
      USER,
      {
        starred: [entry('Star1'), entry('Star2')],
        recent: [entry('Look1'), entry('Look2'), entry('Look3')]
      },
      5000
    )

    const lists = listSavedCharacters(USER)
    expect(lists.recent.map((row) => row.name)).toEqual(['Look1', 'Look2', 'Look3'])
    expect(lists.starred.map((row) => row.name)).toEqual(['Star1', 'Star2'])
  })

  it('adds to what the account already had rather than replacing it', () => {
    rememberSavedCharacter(USER, entry('Own'), 100)
    importSavedCharacters(USER, { starred: [], recent: [entry('FromBrowser')] }, 200)

    expect(listSavedCharacters(USER).recent.map((row) => row.name)).toEqual(['FromBrowser', 'Own'])
  })

  it('keeps a hand-over inside the same two limits the lists are drawn at', () => {
    const many = Array.from({ length: 30 }, (_, index) => entry(`Look${index + 1}`))
    importSavedCharacters(USER, { starred: [], recent: many }, 300)

    const { recent } = listSavedCharacters(USER)
    expect(recent).toHaveLength(20)
    // A browser's list is newest-first, so the front of it is what the account's front becomes.
    expect(recent[0]!.name).toBe('Look1')
  })
})

describe('what a request body is allowed to be', () => {
  it('is a character of this site, or nothing at all', () => {
    expect(readSavedEntry({ entry: { name: 'Rival', realm: 'gordunni', region: 'eu' } })).toMatchObject({
      name: 'Rival',
      realm: 'gordunni',
      region: 'eu'
    })
    expect(readSavedEntry({ entry: { name: 'Rival', realm: 'gordunni', region: 'asia' } })).toBeNull()
    expect(readSavedEntry({ entry: { name: '', realm: 'gordunni', region: 'eu' } })).toBeNull()
    expect(readSavedEntry({ entry: { name: 'Rival', realm: '', region: 'eu' } })).toBeNull()
    expect(readSavedEntry({})).toBeNull()
    expect(readSavedEntry(null)).toBeNull()
    expect(readSavedEntry('nonsense')).toBeNull()
  })

  it('drops the rows of a list it cannot read, and keeps the rest of it', () => {
    const list = readSavedList([
      { name: 'Rival', realm: 'gordunni', region: 'eu' },
      { name: 'Neromask', realm: 'gordunni', region: 'eu' },
      'nonsense',
      null
    ])

    expect(list.map((row) => row.name)).toEqual(['Rival', 'Neromask'])
    expect(readSavedList('nonsense')).toEqual([])
    expect(readSavedList(undefined)).toEqual([])
  })
})
