/**
 * Who the public table may draw, and the key it is asked by.
 *
 * The rule is the site's own: a row belongs to one *account* per signed-in player - drawn as the character it
 * leads with - a character nobody signed in for is drawn as itself, and an account that asked to be left out is
 * left out whole. It used to be a set of excluded keys, memoised for a minute; it is the population a query
 * reads now, and the rules themselves are tested with that query (`./leaderboardRows.test.ts`,
 * `./statisticsPopulation.test.ts`).
 *
 * What is left to test here is the seam between the two: the key a row of the table is addressed by has to be
 * the key a presence dot is looked up under (`./presence`), or a row would wear no dot however online its player
 * is.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { leaderboardKey } from '../../server/utils/leaderboardExclusions'
import { readLeaderboardPage } from '../../server/utils/leaderboardRows'
import { fileAccountReading } from '../../server/utils/accountPool'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

describe('leaderboardKey', () => {
  it('lowercases the three address segments', () => {
    expect(leaderboardKey('EU', 'Gordunni', 'NeroMask')).toBe('eu:gordunni:neromask')
  })
})

describe('the keys a row and a presence dot are compared by', () => {
  it('keys every row of the table the way the dot keys its own', () => {
    memory.addUser(42)
    const main = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'MainOne', isMain: true })
    memory.addSnapshot({
      characterId: main,
      takenAt: 1000,
      ilvl: 320,
      mounts: 100,
      pets: 10,
      toys: 10,
      decor: 10,
      reputations: 1,
      achievements: 100
    })
    fileAccountReading(42)

    memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    const stranger = memory.db.prepare("SELECT id FROM characters WHERE name_key = 'stranger'").get() as { id: number }
    memory.addSnapshot({
      characterId: stranger.id,
      takenAt: 1000,
      ilvl: 300,
      mounts: 5,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })

    const keys = readLeaderboardPage({}, 25)
      .players.map((player) => leaderboardKey(player.region, player.realm, player.name))
      .sort()

    expect(keys).toEqual(['eu:gordunni:mainone', 'eu:gordunni:stranger'])
  })
})
