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
import { bestExtras, readAccountTotals } from '../../server/utils/accountPool'
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

describe('the figures beside the collections', () => {
  it('unions the titles, quests and recipes a roster has earned, and says so', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })

    // One character has earned two titles, the account's pool has been told about three.
    memory.addSnapshot({ characterId: main, takenAt: 1, titles: 2 })
    memory.addPoolItems(1, 'titles', [10, 11, 12])
    memory.addPoolItems(1, 'quests', [1, 2])
    memory.addPoolItems(1, 'recipes', [7])

    const totals = readAccountTotals(1)
    expect(totals.extra.titles).toBe(3)
    expect(totals.extra.quests).toBe(2)
    expect(totals.extra.recipes).toBe(1)
    // Marked as the account's own, which is the note a tile prints and the reason a signed-in reader sees one
    // number for a title on every page while a stranger is shown the character's own.
    expect(totals.accountWide).toContain('titles')
    expect(totals.accountWide).not.toContain('honorLevel' as never)
  })

  it('adds the kills up over the roster, once per character', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    const alt = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Alt' })

    // Two readings of one character, one of the other: the account's total is 8 + 2, not 5 + 8 + 2 - a
    // character read on two days has not earned its kills twice.
    memory.addSnapshot({ characterId: main, takenAt: 1, honorableKills: 5 })
    memory.addSnapshot({ characterId: main, takenAt: 2, honorableKills: 8 })
    memory.addSnapshot({ characterId: alt, takenAt: 1, honorableKills: 2 })

    const totals = readAccountTotals(1)
    expect(totals.extra.honorableKills).toBe(10)
    // And the honor level is the highest any of them stands at, which is the account's standing.
    expect(totals.extra.honorLevel).toBe(0)
  })

  it('takes the honor level of the character standing highest', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    const alt = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Alt' })

    memory.addSnapshot({ characterId: main, takenAt: 1, honorLevel: 7 })
    memory.addSnapshot({ characterId: alt, takenAt: 1, honorLevel: 22 })

    expect(readAccountTotals(1).extra.honorLevel).toBe(22)
  })

  it('merges a character reading upward into the account, and never adds the kills twice', () => {
    memory.addUser(1)
    const main = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
    memory.addPoolItems(1, 'titles', [1, 2])
    memory.addSnapshot({ characterId: main, takenAt: 1, honorableKills: 8 })

    const account = readAccountTotals(1)
    const merged = bestExtras(
      { titles: 5, quests: 0, recipes: 0, transmogs: 0, honorableKills: 8, honorLevel: 0 },
      account
    )

    expect(merged.titles).toBe(5)
    // The reading is one of the account's own characters, so it is already inside the total: 8, not 16.
    expect(merged.honorableKills).toBe(8)
  })
})
