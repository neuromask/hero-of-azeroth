/**
 * The unit the site's statistics are counted over: an **account** or a **guest**, never a character of an account.
 *
 * One population answers the hall of fame's table, a character's history and the distribution a comparison board
 * draws (`./statisticsPopulation`), and these tests are about the rule itself: an account is one value however
 * many alts it holds, its main and its alts show the same figures and the same curve, a guest is itself, an
 * account that asked to be left out is not counted at all, an account none of whose characters has been read in
 * full has nothing to be counted by, and the answer is memoised until the data moves.
 *
 * The distribution is what the population is read through here, because it is the aggregate with the smallest
 * surface: its `population` is the count of members holding a figure, and its `positions` are the members' own -
 * a character of an account is placed by the *account's* figure, which is what makes an alt marked exactly like
 * its main, and placed inside the very histogram the member is counted in.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fileDailyReading, readCharacterHistory, readSnapshotDistribution } from '../../server/utils/characterReading'
import { fileAccountReading } from '../../server/utils/accountPool'
import { claimGuestCharacter } from '../../server/utils/accountSync'
import { fileTransmogReading } from '../../server/utils/profileFeed'
import { bumpStatisticsRevision } from '../../server/utils/statisticsPopulation'
import { dayStartOf, SECONDS_PER_DAY } from '#shared/utils/day'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** How many members the population holds for a metric, which is what every rule below is read through. */
function population(metric: 'mounts' | 'pets' = 'mounts'): number {
  return readSnapshotDistribution(metric, []).population
}

/** A guest the site has read: a row with no owner, and one reading behind it. */
function guest(name: string, mounts: number): number {
  const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name })
  memory.addSnapshot({ characterId: id, takenAt: 1000, mounts })
  return id
}

/**
 * An account with a roster, read in full: the rows the roster writes and one complete reading behind each, and
 * then the account's own totals - which is the point the statistics count it by (`fileAccountReading`).
 */
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

describe('the population the statistics are counted over', () => {
  it('counts an account once, however many characters it holds, and counts a guest as itself', () => {
    account(42, [
      { name: 'Main', mounts: 20, isMain: true },
      { name: 'Alt', mounts: 30 },
      { name: 'SecondAlt', mounts: 25 }
    ])
    guest('stranger', 10)

    expect(population()).toBe(2)
  })

  it('counts the account by its own totals rather than by any one character', () => {
    account(42, [
      { name: 'Main', mounts: 20, isMain: true },
      { name: 'Alt', mounts: 30 }
    ])

    // One member, and the value is the account's own - the best of its pool and its roster's readings.
    const distribution = readSnapshotDistribution('mounts', [])
    expect(distribution.population).toBe(1)
    expect(distribution.bins).toEqual([{ from: 30, to: 30, count: 1 }])
  })

  it('counts an account that asked to be left out of the table by nobody at all', () => {
    memory.addUser(43, true)
    const id = memory.addCharacter({ userId: 43, region: 'eu', realm: 'gordunni', name: 'Hidden', isMain: true })
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mounts: 40,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(43)

    expect(population()).toBe(0)
  })

  it('counts nothing for an account none of whose characters has been read in full', () => {
    memory.addUser(42)
    const id = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Partial', isMain: true })
    // A reading that carries one collection and nothing else: the account's totals cannot be gathered from it.
    memory.addSnapshot({ characterId: id, takenAt: 1000, mounts: 30 })

    fileAccountReading(42)

    expect(population()).toBe(0)
  })

  it('keeps one point a day, rewriting it rather than filing a second', () => {
    account(42, [{ name: 'Main', mounts: 20, isMain: true }])

    fileAccountReading(42)
    fileAccountReading(42)

    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM account_snapshots WHERE user_id = 42').get()).toMatchObject({
      n: 1
    })

    // A reading that moves a figure rewrites the *day's* point - the day is the smallest thing the history holds -
    // and no more than one row joins it however often the account is read inside it.
    const row = memory.db.prepare("SELECT id FROM characters WHERE name_key = 'main'").get() as { id: number }
    memory.addSnapshot({
      characterId: row.id,
      takenAt: 2000,
      mounts: 99,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(42)
    fileAccountReading(42)

    const points = memory.db
      .prepare('SELECT mounts FROM account_snapshots WHERE user_id = 42')
      .all() as Array<{ mounts: number }>
    expect(points).toHaveLength(1)
    // And what the day holds is the newest thing read in it.
    expect(points[0]).toMatchObject({ mounts: 99 })
  })

  it('answers a character of an account with the account\'s history, and a guest with its own', () => {
    account(42, [
      { name: 'Main', mounts: 20, isMain: true },
      { name: 'Alt', mounts: 30 }
    ])

    // An older day of the account's own history, put there as a build that has been running for a while would
    // have left it: the account's curve is its own points, one a day, and not the readings of its characters.
    memory.db
      .prepare('INSERT INTO account_snapshots (user_id, taken_at, mounts) VALUES (42, ?, 30)')
      .run(dayStartOf(Math.floor(Date.now() / 1000)) - SECONDS_PER_DAY + 60)

    const row = memory.db.prepare("SELECT id FROM characters WHERE name_key = 'main'").get() as { id: number }
    memory.addSnapshot({
      characterId: row.id,
      takenAt: 2000,
      mounts: 99,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(42)

    guest('stranger', 10)

    // The main and the alt are two characters and one history: the account's, which is what both of them print -
    // and today's reading is today's point, with yesterday's standing beside it.
    const main = readCharacterHistory('eu', 'gordunni', 'main', 'mounts')
    const alt = readCharacterHistory('eu', 'gordunni', 'alt', 'mounts')
    expect(main?.points.map((point) => point.value)).toEqual([30, 99])
    expect(alt?.points).toEqual(main?.points)

    // And a guest is answered with its own reading.
    expect(readCharacterHistory('eu', 'gordunni', 'stranger', 'mounts')?.points).toEqual([
      { takenAt: 1000, value: 10 }
    ])
  })

  it('drops a guest the moment an account claims it, and counts the account once it has been read', () => {
    account(42, [{ name: 'Main', mounts: 20, isMain: true }])
    const id = guest('stranger', 10)

    expect(population()).toBe(2)

    // Claimed: the row and its reading stay, and the character stops being a member of its own.
    claimGuestCharacter(42, 'eu', 'gordunni', 'Stranger')
    expect(population()).toBe(1)
    expect(memory.db.prepare('SELECT user_id FROM characters WHERE id = ?').get(id)).toMatchObject({ user_id: 42 })

    // Its figures are inside the account's totals, so the account's own value grows and no second member appears.
    fileAccountReading(42)
    expect(population()).toBe(1)
    expect(readSnapshotDistribution('mounts', []).bins).toEqual([{ from: 20, to: 20, count: 1 }])
  })

  it('answers from the memo until a reading moves the data', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })

    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: 0,
      mounts: 10,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })

    const first = readSnapshotDistribution('mounts', ['eu:gordunni:stranger'])
    expect(first.population).toBe(1)
    expect(first.positions[0]).toMatchObject({ key: 'eu:gordunni:stranger', value: 10 })

    // The same question with nothing moved is the very same answer, not a second pass over the population.
    expect(readSnapshotDistribution('mounts', ['eu:gordunni:stranger'])).toBe(first)

    // A refresh that reads the same figures files no point, so the answer stands as it was.
    const profile = {
      name: 'Stranger',
      realm: 'Gordunni',
      level: 90,
      faction: 'HORDE',
      classId: 1,
      avatarUrl: '',
      ilvl: 300,
      mPlusScore: 0,
      stats: {
        mounts: { count: 10 },
        pets: { count: 1 },
        toys: { count: 1 },
        decor: { count: 1 },
        reputations: { count: 1 },
        achievements: { count: 1 }
      }
    } as never

    fileDailyReading(id, profile)
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE character_id = ?').get(id)).toMatchObject({
      n: 1
    })
    expect(readSnapshotDistribution('mounts', ['eu:gordunni:stranger'])).toBe(first)

    // A refresh that moved a figure files one, and the next question is answered afresh.
    ;(profile as { stats: { mounts: { count: number } } }).stats.mounts = { count: 11 }
    fileDailyReading(id, profile)

    const moved = readSnapshotDistribution('mounts', ['eu:gordunni:stranger'])
    expect(moved).not.toBe(first)
    expect(moved.positions[0]).toMatchObject({ key: 'eu:gordunni:stranger', value: 11 })
  })
})

describe('the figure a member is placed by', () => {
  it('places a character of an account by the account, so an alt is marked like its main', () => {
    account(42, [
      { name: 'Main', mounts: 20, isMain: true },
      { name: 'Alt', mounts: 30 }
    ])

    // The account is one member, and the figure it is counted by is its own - the best of what its characters
    // hold - so both of its characters are placed by it: the main and the alt come back with one value, and it is
    // the account's rather than either character's own reading (`./statisticsPopulation`).
    const answer = readSnapshotDistribution('mounts', ['eu:gordunni:main', 'eu:gordunni:alt'])

    expect(answer.positions).toEqual([
      { key: 'eu:gordunni:main', value: 30, rank: 1, percentile: 100 },
      { key: 'eu:gordunni:alt', value: 30, rank: 1, percentile: 100 }
    ])
  })

  it('places a guest by its own newest reading, inside the histogram it is counted in', () => {
    guest('stranger', 10)
    guest('other', 40)

    const answer = readSnapshotDistribution('mounts', ['eu:gordunni:stranger'])
    const position = answer.positions[0]!

    expect(position).toMatchObject({ key: 'eu:gordunni:stranger', value: 10, rank: 2 })

    // The scale is cut from the population's own figures, so a member is always inside one of the buckets - which
    // is what the chart marks the reader's own column with, and a figure that fell outside them would leave that
    // column unmarked.
    expect(answer.bins.some((bin) => position.value! >= bin.from && position.value! <= bin.to)).toBe(true)
  })

  it('leaves a member that holds no figure for the metric unplaced', () => {
    guest('stranger', 10)

    // Nothing was ever read for this metric, so there is no figure to place and no place to give: the panel draws
    // the figure as a dash rather than marking a bucket nobody is in.
    expect(readSnapshotDistribution('titles', ['eu:gordunni:stranger']).positions[0]).toMatchObject({
      key: 'eu:gordunni:stranger',
      value: null,
      rank: null,
      percentile: null
    })
  })

  it('has no figure for a character until the wardrobe is read, and one afterwards', () => {
    guest('stranger', 10)

    // What a panel holds when it is opened *before* the wardrobe has been read: the character is in the population
    // of every other metric, but not in this one - the figure does not exist yet, so no bucket can be marked.
    expect(readSnapshotDistribution('transmogs', ['eu:gordunni:stranger']).positions[0]).toMatchObject({
      key: 'eu:gordunni:stranger',
      value: null,
      rank: null
    })

    // The tray is opened, the wardrobe is read and filed, and the very same question is answered afresh: the
    // revision every distribution memo is keyed on moved with the reading (`bumpStatisticsRevision`).
    fileTransmogReading('eu', 'gordunni', 'stranger', 12_000)

    expect(readSnapshotDistribution('transmogs', ['eu:gordunni:stranger']).positions[0]).toMatchObject({
      key: 'eu:gordunni:stranger',
      value: 12_000,
      rank: 1
    })
  })

  it("places a character by the wardrobe the tray has read: its own for a guest, its account's for an account", () => {
    const id = guest('stranger', 10)

    // The wardrobe is the one figure of the fifteen a profile does not carry: it is read by the tray alone, and
    // filing that reading is what puts the character into this metric's population at all - a guest has no
    // account's sync to read it for them (`fileTransmogReading`).
    fileTransmogReading('eu', 'gordunni', 'stranger', 12_000)

    const answer = readSnapshotDistribution('transmogs', ['eu:gordunni:stranger'])

    expect(answer.positions[0]).toMatchObject({ key: 'eu:gordunni:stranger', value: 12_000 })
    expect(answer.bins.some((bin) => 12_000 >= bin.from && 12_000 <= bin.to)).toBe(true)

    // And the rest of the point is carried forward, so the figures the page had already read are still there.
    expect(
      memory.db
        .prepare('SELECT mounts, transmogs FROM snapshots WHERE character_id = ? ORDER BY taken_at DESC LIMIT 1')
        .get(id)
    ).toMatchObject({ mounts: 10, transmogs: 12_000 })

    // A character of an account is placed by the *account* instead, which is the rule every figure of the
    // population follows: the wardrobe is filed as the reading of the character whose tray was opened, the
    // account's own point takes it up (the best of its roster's readings), and both of its characters are marked
    // by the account's figure - the alt here is marked by 9 000 and by nothing of its own.
    account(42, [
      { name: 'Main', mounts: 20, isMain: true },
      { name: 'Alt', mounts: 30 }
    ])
    fileTransmogReading('eu', 'gordunni', 'alt', 9_000)

    expect(
      readSnapshotDistribution('transmogs', ['eu:gordunni:main', 'eu:gordunni:alt']).positions.map(
        (entry) => entry.value
      )
    ).toEqual([9_000, 9_000])
  })
})
