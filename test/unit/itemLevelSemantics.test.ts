/**
 * What an item level belongs to.
 *
 * The rule the site means - and the one its code already keeps - is that an item level is **one character's**:
 * it is what that character wears, kept on its own row (`characters.ilvl`, beside its level), and there is no
 * figure of it for an account and no curve or histogram of it at all (`#shared/data/historySchema` says so where
 * the metrics are named). A row of the hall of fame therefore prints the item level of the character it is named
 * after - a guest's own, an account's main - rather than the best gear anywhere on the roster, which is what the
 * table had been written with before `ROW_VERSION` 2.
 *
 * Two comments used to say otherwise - one in `./statisticsPopulation` and one on `account_snapshots` in `./db`,
 * both claiming the item level was the highest any character of the account stands at - and this file is what
 * pins the rule they were contradicting, with the one arrangement that tells the two apart: a main wearing worse
 * gear than its own alt.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fileAccountReading, readAccountTotals } from '../../server/utils/accountPool'
import { readCharacterReading } from '../../server/utils/characterReading'
import { ensurePopulation, readLeaderboardPage } from '../../server/utils/leaderboardRows'
import { METRIC_KEYS } from '#shared/data/historySchema'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** An account whose main wears worse gear than its own alt, and the table built from it. */
function account(): { userId: number; main: number; alt: number } {
  const userId = 7
  memory.addUser(userId)

  const main = memory.addCharacter({
    userId,
    region: 'eu',
    realm: 'gordunni',
    name: 'Mainchar',
    isMain: true,
    level: 90,
    ilvl: 320
  })
  const alt = memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name: 'Altchar', level: 90, ilvl: 350 })

  for (const id of [main, alt]) {
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: 0,
      mounts: id === main ? 100 : 200,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
  }

  fileAccountReading(userId)
  ensurePopulation()

  return { userId, main, alt }
}

describe('the item level of an account whose alt wears better gear', () => {
  it('prints the item level of the character the row is named after, not the best on the roster', () => {
    const { main, alt } = account()

    const [row] = readLeaderboardPage({}, 10).players

    expect(row).toMatchObject({ name: 'mainchar', isAccount: true, ilvl: 320, mounts: 200 })
    // The alt's gear is not lost - it is the alt's own, and the account's collections are the best of the two.
    expect(memory.db.prepare('SELECT ilvl FROM characters WHERE id = ?').get(alt)).toMatchObject({ ilvl: 350 })
    expect(memory.db.prepare('SELECT ilvl FROM characters WHERE id = ?').get(main)).toMatchObject({ ilvl: 320 })
  })

  it('follows the main when the main is re-read, and never the alt', () => {
    const { userId, main } = account()

    // The main re-gears: the row it is named after moves with it.
    memory.db.prepare('UPDATE characters SET ilvl = 400 WHERE id = ?').run(main)
    fileAccountReading(userId)

    expect(readLeaderboardPage({}, 10).players[0]).toMatchObject({ ilvl: 400 })
  })

  it('reads a character\'s own item level on the character\'s own page', () => {
    account()

    // Both characters answer with what they themselves wear - which is what a page, a card and a tile print.
    expect(readCharacterReading('eu', 'gordunni', 'mainchar')).toMatchObject({ ilvl: 320 })
    expect(readCharacterReading('eu', 'gordunni', 'altchar')).toMatchObject({ ilvl: 350 })
  })

  it('has no item level of its own to aggregate', () => {
    const { userId } = account()

    // The account's totals are about what it has gathered, and an item level is not gathered: there is no field
    // for it at all, which is the same statement `./accountPool` makes in its own words.
    expect('ilvl' in readAccountTotals(userId)).toBe(false)

    // And no column for it on the account's own points, nor on the readings: the figure lives on the character.
    const columns = (table: string) =>
      (memory.db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name)

    expect(columns('account_snapshots')).not.toContain('ilvl')
    expect(columns('snapshots')).not.toContain('ilvl')
    expect(columns('characters')).toContain('ilvl')
  })

  it('is not a metric, so there is no history and no distribution of it', () => {
    // The list the history and distribution endpoints validate against, which is what the panels are drawn from:
    // an item level is deliberately not on it (`#shared/data/historySchema`).
    expect(METRIC_KEYS).not.toContain('ilvl')
    expect(METRIC_KEYS).toContain('mPlusScore')
  })
})
