/**
 * The online dot the hall of fame draws: who is marked, and who is not.
 *
 * The dot says one thing - the account behind this row is on the site - so what it must mark is the row a
 * reader is looking at. The table draws one row per account: the character the account named its main, or the
 * strongest character it has until one is named (`./leaderboardRows`). The read here used to key on
 * `characters.is_main = 1`, which marked nobody for an account that had never named a main - its row is in the
 * table all the same, and the dot on it never lit. That case is the first test below.
 *
 * The rest is the shape of the rule: a beat older than the window is offline, an account that asked to be left
 * out of the table has no row to mark, a guest is nobody's account, the answer is memoised so a burst of page
 * reads is one query, and a database that cannot be read marks nobody rather than failing the page.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fileAccountReading } from '../../server/utils/accountPool'
import { fileDailyReading } from '../../server/utils/characterReading'
import { onlineLeaderboardKeys, PRESENCE_WINDOW_SECONDS, touchPresence } from '../../server/utils/presence'
import { refreshAccountRow } from '../../server/utils/leaderboardRows'
import { nowSec } from '../../server/utils/db'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** An account with a roster read in full, which is what puts its row in the table. */
function account(userId: number, characters: Array<{ name: string; mounts: number; isMain?: boolean }>): void {
  memory.addUser(userId)

  for (const character of characters) {
    const id = memory.addCharacter({
      userId,
      region: 'eu',
      realm: 'gordunni',
      name: character.name,
      isMain: character.isMain
    })

    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: 0,
      mounts: character.mounts,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
  }

  fileAccountReading(userId)
}

describe('the online dot', () => {
  it('marks an account that never named a main by the row the table draws', () => {
    account(42, [{ name: 'Strongest', mounts: 30 }])

    // No character is flagged as the main, so the table draws the strongest one - and that is the row the dot
    // has to be found on.
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters WHERE is_main = 1').get()).toMatchObject({ n: 0 })

    touchPresence(42)

    expect([...onlineLeaderboardKeys()]).toEqual(['eu:gordunni:strongest'])
  })

  it('marks the character a named main is', () => {
    account(42, [
      { name: 'Main', mounts: 10, isMain: true },
      { name: 'Alt', mounts: 30 }
    ])

    touchPresence(42)

    // The stronger character is the alt, but the account leads with the one it named, so that is the row - and
    // the dot is on it.
    expect([...onlineLeaderboardKeys()]).toEqual(['eu:gordunni:main'])
  })

  it('leaves an account whose last beat is older than the window offline', () => {
    account(42, [{ name: 'Main', mounts: 10, isMain: true }])
    memory.db
      .prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .run(nowSec() - PRESENCE_WINDOW_SECONDS - 1, 42)

    expect([...onlineLeaderboardKeys()]).toEqual([])
  })

  it('marks nobody for an account that asked to be left out of the table', () => {
    account(42, [{ name: 'Main', mounts: 10, isMain: true }])
    memory.db.prepare('UPDATE users SET hide_from_fame = 1 WHERE id = 42').run()
    refreshAccountRow(42)
    touchPresence(42)

    // There is no row to mark: the table has taken the account out.
    expect([...onlineLeaderboardKeys()]).toEqual([])
  })

  it('never marks a guest, who belongs to no account', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, { stats: { mounts: { count: 10 } } })

    expect([...onlineLeaderboardKeys()]).toEqual([])
  })

  it('answers a burst of readers from one memo', () => {
    account(42, [{ name: 'Main', mounts: 10, isMain: true }])
    touchPresence(42)

    // The same set, not a second one: the read is kept for half a minute, which is what makes a page's own
    // readers cost one query between them.
    expect(onlineLeaderboardKeys()).toBe(onlineLeaderboardKeys())
  })

  it('marks nobody rather than failing when the database cannot be read', () => {
    ;(globalThis as Record<string, unknown>).useDb = () => {
      throw new Error('no database')
    }

    expect([...onlineLeaderboardKeys()]).toEqual([])
  })
})
