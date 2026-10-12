/**
 * The account's totals: the union of its pool and the best reading of its roster.
 *
 * The rule `readAccountTotals` enforces is the one the tiles, the profile and the hall of fame all
 * read from - `MAX`, never `SUM`, and each id counted once - so it is tested through the very SQL
 * the site runs, against a throwaway database (`test/helpers/memoryDb.ts`), with nothing written to
 * disk. The block on reputations is here too: the pool answers alone, because a stored per-character
 * count used to be Blizzard's account-wide Exalted figure and mixing the two is how the drift began.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readAccountTotals } from '../../server/utils/accountPool'
import { calculatePlayerScore } from '../../server/utils/playerScore'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

describe('readAccountTotals', () => {
  it('takes the best reading of a collection, never the sum of the roster', () => {
    memory.addUser(1)
    const first = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'AltOne', isMain: true })
    const second = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'AltTwo' })

    memory.addSnapshot({ characterId: first, takenAt: 1, mounts: 100, pets: 10, toys: 5, decor: 2, achievements: 1000, ilvl: 300, mplus: 2000 })
    memory.addSnapshot({ characterId: second, takenAt: 2, mounts: 150, pets: 12, toys: 6, decor: 3, achievements: 1200, ilvl: 310, mplus: 2500 })

    const totals = readAccountTotals(1)
    expect(totals.mounts).toBe(150)
    expect(totals.pets).toBe(12)
    expect(totals.achievements).toBe(1200)
    expect(totals.ilvl).toBe(310)
    expect(totals.mplus).toBe(2500)
  })

  it('counts unique pool ids once and marks the kinds the pool answered', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addSnapshot({ characterId: main, takenAt: 1, mounts: 100, toys: 0 })

    memory.addPoolItems(1, 'mounts', [1001, 1002, 1003])
    // The primary key on (user_id, kind, item_id) is what keeps a repeated id from being counted twice.
    memory.addPoolItems(1, 'toys', [7, 7, 8])

    const totals = readAccountTotals(1)
    expect(totals.mounts).toBe(100) // the reading beats the pool
    expect(totals.toys).toBe(2) // two unique ids, not three rows
    expect(totals.accountWide).toContain('mounts')
    expect(totals.accountWide).toContain('toys')
    expect(totals.accountWide).not.toContain('pets')
  })

  it('lets the pool stand for a collection when it is the larger of the two', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addSnapshot({ characterId: main, takenAt: 1, mounts: 5 })
    memory.addPoolItems(1, 'mounts', Array.from({ length: 40 }, (_, index) => 2000 + index))

    expect(readAccountTotals(1).mounts).toBe(40)
  })

  it('reads reputations from the pool alone', () => {
    memory.addUser(1)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addPoolItems(1, 'reputations', [10, 11, 12])

    expect(readAccountTotals(1).reputations).toBe(3)
  })

  it('rates the very figures it reports', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addSnapshot({ characterId: main, takenAt: 1, mounts: 100, pets: 50, toys: 40, decor: 30, achievements: 1000 })

    const totals = readAccountTotals(1)
    expect(totals.score).toBe(
      calculatePlayerScore({
        achievements: totals.achievements,
        mounts: totals.mounts,
        pets: totals.pets,
        toys: totals.toys,
        decor: totals.decor,
        reputations: totals.reputations
      })
    )
  })

  it('answers zeroes for an account the site holds nothing for', () => {
    memory.addUser(7)
    const totals = readAccountTotals(7)
    expect(totals.mounts).toBe(0)
    expect(totals.score).toBe(0)
    expect(totals.accountWide).toEqual([])
  })
})
