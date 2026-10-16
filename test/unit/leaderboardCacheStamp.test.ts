/**
 * The stamp the leaderboard's cache is keyed on.
 *
 * `/api/leaderboard` is cached for an hour (`server/api/leaderboard/index.ts`), and what keeps that hour from
 * serving a table the site has moved past is that the stamp of the data rides in the key every answer is filed
 * under: an entry written before a write is filed under a stamp nobody asks for again. That makes the stamp a
 * contract, and this is the contract - it moves for every write that changes what the table draws, and it does
 * not move for a write that changed nothing.
 *
 * The writes below are the ones a reader's own actions go through: a character page read files a reading
 * (`fileDailyReading`), a background sync moves the account's totals (`fileAccountReading`), signing in claims a
 * character (`claimGuestCharacter`), naming a main or hiding from the table rewrites the account's row
 * (`refreshAccountRow`), and a changed rating rebuilds the whole table (`rebuildPopulation`).
 *
 * The HTTP side of the same contract - `cache-control: max-age=3600` on the answer, `no-cache` honoured - is
 * checked against the built server; what cannot be checked there is the invalidation itself, because a write
 * through the site's own endpoints needs a Battle.net sign-in. That is why it is pinned here.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fileAccountReading } from '../../server/utils/accountPool'
import { claimGuestCharacter } from '../../server/utils/accountSync'
import { fileDailyReading } from '../../server/utils/characterReading'
import { ensurePopulation, rebuildPopulation, refreshAccountRow } from '../../server/utils/leaderboardRows'
import { leaderboardDataStamp } from '../../server/utils/leaderboardStorage'
import { statisticsRevision } from '../../server/utils/statisticsPopulation'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** An account whose main is read in full, and the table built. */
function account(): { userId: number; main: number } {
  const userId = 42
  memory.addUser(userId)
  const main = memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true })
  memory.addSnapshot({ characterId: main, takenAt: 1000, mounts: 100, pets: 1, toys: 1, decor: 1, reputations: 1, achievements: 1 })
  fileAccountReading(userId)
  ensurePopulation()
  return { userId, main }
}

describe('the stamp the leaderboard cache is keyed on', () => {
  it('is the revision of the data, read out loud', () => {
    expect(leaderboardDataStamp()).toBe(String(statisticsRevision()))
  })

  it('moves when a guest is read again and its figures moved', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, { stats: { mounts: { count: 10 } } } as never)
    ensurePopulation()

    const before = leaderboardDataStamp()
    fileDailyReading(id, { stats: { mounts: { count: 11 } } } as never)

    expect(leaderboardDataStamp()).not.toBe(before)
  })

  it('does not move when a guest is read again and nothing moved', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, { stats: { mounts: { count: 10 } } } as never)
    ensurePopulation()

    const before = leaderboardDataStamp()
    fileDailyReading(id, { stats: { mounts: { count: 10 } } } as never)

    expect(leaderboardDataStamp()).toBe(before)
  })

  it("moves when an account's totals move", () => {
    const { userId, main } = account()
    const before = leaderboardDataStamp()

    memory.addSnapshot({ characterId: main, takenAt: 2000, mounts: 150, pets: 1, toys: 1, decor: 1, reputations: 1, achievements: 1 })
    fileAccountReading(userId)

    expect(leaderboardDataStamp()).not.toBe(before)
  })

  it('moves when a character an account claims stops being a guest', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, { stats: { mounts: { count: 10 } } } as never)
    ensurePopulation()
    memory.addUser(42)

    const before = leaderboardDataStamp()
    claimGuestCharacter(42, 'eu', 'gordunni', 'Stranger')

    expect(leaderboardDataStamp()).not.toBe(before)
  })

  it('moves when an account is hidden from the table, and when it comes back', () => {
    const { userId } = account()

    memory.db.prepare('UPDATE users SET hide_from_fame = 1 WHERE id = ?').run(userId)
    const hidden = leaderboardDataStamp()
    refreshAccountRow(userId)

    expect(leaderboardDataStamp()).not.toBe(hidden)

    memory.db.prepare('UPDATE users SET hide_from_fame = 0 WHERE id = ?').run(userId)
    const shown = leaderboardDataStamp()
    refreshAccountRow(userId)

    expect(leaderboardDataStamp()).not.toBe(shown)
  })

  it('moves when the table is rebuilt, so no answer survives a formula change', () => {
    account()
    const before = leaderboardDataStamp()

    rebuildPopulation()

    expect(leaderboardDataStamp()).not.toBe(before)
  })
})
