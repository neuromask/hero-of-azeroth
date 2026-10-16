/**
 * The place of one character in the overall table.
 *
 * A place is only meaningful if it agrees with the table a reader is looking at, so the property pinned here is
 * exactly that: for every row, the place `readLeaderboardStanding` answers is the row's own position in the order
 * `readLeaderboardPage` draws. The read counts how many members sort above the character rather than numbering
 * the whole population - a window function cost 329 ms of SQL at two hundred thousand members against 9 ms for
 * the count (`test/bench`) - and this is what says the cheaper one still means the same thing.
 *
 * The one place the two are allowed to differ is a tie, and it is the answer rather than a discrepancy: two
 * members with the same rating *and* the same name share a place, where numbering them would hand out two
 * arbitrary ones.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fileAccountReading } from '../../server/utils/accountPool'
import { fileDailyReading } from '../../server/utils/characterReading'
import {
  ensurePopulation,
  readLeaderboardPage,
  readLeaderboardStanding,
  refreshAccountRow
} from '../../server/utils/leaderboardRows'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/**
 * A guest whose rating is a figure of its own: achievements weigh one each, so a row's score is what is asked for.
 */
function member(name: string, realm: string, score: number, displayName = name): void {
  const id = memory.addGuestCharacter({ region: 'eu', realm, name })
  memory.addSnapshot({
    characterId: id,
    takenAt: 1000,
    achievements: score,
    mounts: 0,
    pets: 0,
    toys: 0,
    decor: 0,
    reputations: 0
  })
}

describe('the place of one character', () => {
  it('agrees with the order the page is drawn in, row for row', () => {
    member('Alpha', 'gordunni', 300, 'Alpha')
    member('Beta', 'gordunni', 200, 'Beta')
    // Ties Alpha on the rating; the name settles it, and Alpha comes first.
    member('Gamma', 'gordunni', 300, 'Gamma')
    member('Delta', 'gordunni', 100, 'Delta')

    ensurePopulation()

    const page = readLeaderboardPage({}, 10).players
    expect(page.map((player) => player.name)).toEqual(['alpha', 'gamma', 'beta', 'delta'])

    page.forEach((player, index) => {
      const standing = readLeaderboardStanding(player)

      expect(standing?.rank).toBe(index + 1)
      expect(standing?.total).toBe(4)
      expect(standing?.player.name).toBe(player.name)
    })
  })

  it('agrees with the page whatever the rating is, including the last place', () => {
    for (let score = 0; score < 25; score += 1) member(`player${score}`, 'gordunni', score)

    ensurePopulation()

    const page = readLeaderboardPage({}, 50).players
    expect(page).toHaveLength(25)

    page.forEach((player, index) => {
      expect(readLeaderboardStanding(player)?.rank).toBe(index + 1)
    })
  })

  it('gives a tie the same place rather than two arbitrary ones', () => {
    // The same rating and the same name, on two realms: nothing in the page's own order tells them apart.
    member('Twin', 'gordunni', 250, 'Twin')
    member('Twin', 'eversong', 250, 'Twin')
    member('Below', 'gordunni', 100, 'Below')

    ensurePopulation()

    const page = readLeaderboardPage({}, 10).players
    expect(page).toHaveLength(3)

    for (const twin of page.filter((player) => player.name === 'twin')) {
      expect(readLeaderboardStanding(twin)?.rank).toBe(1)
    }

    expect(readLeaderboardStanding(page.find((player) => player.name === 'below')!)?.rank).toBe(3)
  })

  it('answers nothing for a character the table does not draw', () => {
    member('Alpha', 'gordunni', 300)
    ensurePopulation()

    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'nobody' })).toBeNull()
    // And for one on a realm that holds nobody at all.
    expect(readLeaderboardStanding({ region: 'eu', realm: 'eversong', name: 'alpha' })).toBeNull()
  })

  it('treats two names that differ only in case as the tie they are', () => {
    // The order the page is drawn in sorts names without case, so these two are equal to it - and a place is a
    // place in that order, not in one made of the raw bytes of two names.
    member('twin', 'gordunni', 250, 'TWIN')
    member('Twin', 'eversong', 250, 'twin')
    member('Below', 'gordunni', 100, 'Below')

    ensurePopulation()

    for (const twin of readLeaderboardPage({}, 10).players.filter((player) => player.score === 250)) {
      expect(readLeaderboardStanding(twin)?.rank).toBe(1)
    }
  })

  it('places a member holding nothing at all behind everybody who holds something', () => {
    // A real zero on every figure, which is what a reading with no collections leaves in a row - and it must not
    // be mistaken for a missing figure, which is the one case a place is not given at all.
    member('Empty', 'gordunni', 0)
    member('Holds', 'gordunni', 1)

    ensurePopulation()

    const page = readLeaderboardPage({}, 10).players
    expect(page.map((player) => player.score)).toEqual([1, 0])
    expect(readLeaderboardStanding(page[0])?.rank).toBe(1)
    expect(readLeaderboardStanding(page[1])?.rank).toBe(2)
  })

  it('stops answering for an account that asks to be left out, and follows the main it names', () => {
    const userId = 7
    memory.addUser(userId)
    const main = memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name: 'Mainchar', isMain: true })
    const alt = memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name: 'Altchar' })

    for (const id of [main, alt]) {
      memory.addSnapshot({
        characterId: id,
        takenAt: 1000,
        mounts: id === main ? 100 : 300,
        pets: 1,
        toys: 1,
        decor: 1,
        reputations: 1,
        achievements: 1
      })
    }

    fileAccountReading(userId)
    ensurePopulation()

    // The row is the account's, under the character it leads with - so that is the only address with a place.
    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'mainchar' })?.rank).toBe(1)
    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'altchar' })).toBeNull()

    // Naming the other character moves the row, and the place with it.
    memory.db.prepare('UPDATE characters SET is_main = 0 WHERE user_id = ?').run(userId)
    memory.db.prepare('UPDATE characters SET is_main = 1 WHERE id = ?').run(alt)
    refreshAccountRow(userId)

    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'mainchar' })).toBeNull()
    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'altchar' })?.rank).toBe(1)

    // And asking to be left out of the table takes the place away entirely.
    memory.db.prepare('UPDATE users SET hide_from_fame = 1 WHERE id = ?').run(userId)
    refreshAccountRow(userId)

    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'altchar' })).toBeNull()
    expect(readLeaderboardPage({}, 10).total).toBe(0)
  })

  it('follows a rating that moves between two reads of the same place', () => {
    member('Alpha', 'gordunni', 100)
    member('Beta', 'gordunni', 200)

    ensurePopulation()

    expect(readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'alpha' })?.rank).toBe(2)

    // Alpha is read again holding more, which files a point and rewrites its row: the place a reader is shown
    // next is the place in the table they are looking at, not the one from the read before.
    const id = memory.db.prepare("SELECT id FROM characters WHERE name_key = 'alpha'").get().id
    memory.addSnapshot({ characterId: id, takenAt: 2000, mounts: 900, pets: 1, toys: 1, decor: 1, reputations: 1, achievements: 1 })
    fileDailyReading(id, { stats: { mounts: { count: 900 } } } as never)

    const page = readLeaderboardPage({}, 10)
    expect(page.players.map((player) => player.name)).toEqual(['alpha', 'beta'])
    expect(readLeaderboardStanding(page.players[0])?.rank).toBe(1)
    expect(readLeaderboardStanding(page.players[1])?.rank).toBe(2)
  })
})
