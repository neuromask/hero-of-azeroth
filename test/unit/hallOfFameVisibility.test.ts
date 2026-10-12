/**
 * Who the public table may draw, and the key it is asked by.
 *
 * The rule is the site's own: a row belongs to one character per account - the main - every other
 * character of a signed-in account is personal, and an account that asked to be left out is left out
 * whole, main included. It is written as one SQL query, so it is tested against a throwaway database
 * through that same query. The minute-long memo is exercised as well, because a stale memo is what a
 * main change would otherwise hide behind.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLeaderboardExclusions,
  excludedLeaderboardKeys,
  leaderboardKey
} from '../../server/utils/leaderboardExclusions'
import { accountLeaderboardKeys, clearAccountKeys } from '../../server/utils/accounts'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
  // Both sets are memoised for a minute; each test starts from an empty memo so it reads its own rows.
  clearLeaderboardExclusions()
  clearAccountKeys()
})

describe('leaderboardKey', () => {
  it('lowercases the three address segments', () => {
    expect(leaderboardKey('EU', 'Gordunni', 'NeroMask')).toBe('eu:gordunni:neromask')
  })
})

describe('the hall of fame\'s visibility', () => {
  it('draws one main per account, and drops an account that hid itself - main included', () => {
    memory.addUser(1, false)
    memory.addUser(2, true)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'MainOne', isMain: true })
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'AltOne' })
    memory.addCharacter({ userId: 2, region: 'eu', realm: 'gordunni', name: 'HiddenMain', isMain: true })

    expect([...accountLeaderboardKeys()].sort()).toEqual(['eu:gordunni:hiddenmain', 'eu:gordunni:mainone'])
    expect([...excludedLeaderboardKeys()].sort()).toEqual(['eu:gordunni:altone', 'eu:gordunni:hiddenmain'])
  })

  it('asks lowercased names, which is how the roster stores them', () => {
    memory.addUser(1, false)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'MainOne', isMain: true })

    expect(accountLeaderboardKeys().has('eu:gordunni:mainone')).toBe(true)
  })

  it('honours a change the moment the memo is dropped', () => {
    memory.addUser(1, false)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'MainOne', isMain: true })
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'AltOne' })

    expect(excludedLeaderboardKeys().has('eu:gordunni:altone')).toBe(true)

    memory.db.prepare('UPDATE characters SET is_main = 1 WHERE name_key = ?').run('altone')
    // The memo still holds the set it built, which is exactly why the write paths clear it.
    expect(excludedLeaderboardKeys().has('eu:gordunni:altone')).toBe(true)

    clearLeaderboardExclusions()
    expect(excludedLeaderboardKeys().has('eu:gordunni:altone')).toBe(false)
  })

  it('offers no exclusions at all when the database cannot be read', () => {
    // The conservative answer: a process with no database shows what it always showed.
    installUseDb(null as unknown as import('node:sqlite').DatabaseSync)
    clearLeaderboardExclusions()
    expect(excludedLeaderboardKeys().size).toBe(0)
  })
})
