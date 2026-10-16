/**
 * The history: the event-log writes (`fileDailyReading`) and the reader that serves them (`readCharacterHistory`).
 *
 * The record is one point a **day**: the day is the smallest thing a history holds. So the tests below are about
 * exactly that - a first read files the day's point, an unchanged read files nothing, a changed read *rewrites* the
 * day's point rather than filing a second one beside it, a reading older than the one the day already holds is not
 * written at all, and a partial read keeps what the day's point carries. The overall rating is stored with the point
 * (computed when the six figures it weighs are all present), and the reader folds whatever the table holds to one
 * point a day and maps the snapshot's snake_case columns to the camelCase the wire speaks - so both halves are
 * exercised against the very SQL the site runs, through `memoryDb`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CharacterData } from '../../server/utils/blizzard'
import { fileDailyReading, readCharacterHistory, readSnapshotDistribution } from '../../server/utils/characterReading'
import { calculatePlayerScore } from '../../server/utils/playerScore'
import { dayStartOf, SECONDS_PER_DAY } from '#shared/utils/day'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** A complete profile, with the figures the six-category rating weighs. */
function profile(): CharacterData {
  return {
    name: 'Testchar',
    title: '',
    level: 90,
    race: 'Human',
    class: 'Warrior',
    spec: 'Arms',
    guild: '',
    realm: 'Gordunni',
    faction: 'ALLIANCE',
    ap: 10000,
    ilvl: 300,
    mPlusScore: 2500,
    renderUrl: '',
    avatarUrl: '',
    classId: 1,
    raceId: 1,
    gender: 'MALE',
    backgroundUrl: '',
    stats: {
      mounts: { count: 100, total: 800 },
      pets: { count: 200, total: 1400 },
      toys: { count: 300, total: 900 },
      decor: { count: 400, total: 1200 },
      reputations: { count: 50, total: 230, accountWide: false },
      achievements: { count: 10000, total: 50000 },
      titles: { count: 5 },
      quests: { count: 6 },
      recipes: { count: 7 },
      honorableKills: { count: 8 },
      honorLevel: { count: 9 }
    }
  }
}

/** The one score `fileDailyReading` should store for `profile()`. */
const expectedScore = calculatePlayerScore({
  achievements: 10000,
  mounts: 100,
  pets: 200,
  toys: 300,
  decor: 400,
  reputations: 50
})

describe('fileDailyReading', () => {
  it('files the first read as one point with its score', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    fileDailyReading(id, profile())

    const rows = memory.db.prepare('SELECT * FROM snapshots WHERE character_id = ?').all(id)
    expect(rows).toHaveLength(1)
    expect((rows[0] as Record<string, unknown>).mounts).toBe(100)
    expect((rows[0] as Record<string, unknown>).score).toBe(expectedScore)
  })

  it('files nothing for an unchanged read', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    fileDailyReading(id, profile())
    fileDailyReading(id, profile())

    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE character_id = ?').get(id)).toMatchObject({ n: 1 })
  })

  it("rewrites the day's point when a figure moved, and files no second one", () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    fileDailyReading(id, profile())

    const grown = profile()
    grown.stats.mounts = { count: 150, total: 800 }
    fileDailyReading(id, grown)

    // One day, one point - and what it holds is the newest thing read in it.
    const rows = memory.db
      .prepare('SELECT taken_at, mounts FROM snapshots WHERE character_id = ?')
      .all(id) as Array<{ taken_at: number; mounts: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mounts: 150 })
  })

  it('is not written at all when the reading is older than the day the site has read', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    // Two moments of one day, the first reading the later of them: the second is exactly what the migration that
    // moves the hall of fame's own table files - a reading for a day the site has read since - and it must not take
    // the day back.
    const later = dayStartOf(Math.floor(Date.now() / 1000)) + 120
    fileDailyReading(id, profile(), later)

    const changed = profile()
    changed.stats.mounts = { count: 150, total: 800 }
    fileDailyReading(id, changed, later - 60)

    const rows = memory.db
      .prepare('SELECT taken_at, mounts FROM snapshots WHERE character_id = ?')
      .all(id) as Array<{ taken_at: number; mounts: number }>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ taken_at: later, mounts: 100 })
  })

  it('keeps a figure the reading did not carry from the newest point', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    fileDailyReading(id, profile())

    // A later profile with the appearances and the pvp figures missing, and one collection grown: the new
    // point must keep the missing figures rather than blanking them.
    const partial = profile()
    const base = profile().stats
    ;(partial as { stats: unknown }).stats = {
      mounts: { count: 160, total: 800 },
      pets: base.pets,
      toys: base.toys,
      decor: base.decor,
      reputations: base.reputations,
      achievements: base.achievements,
      titles: undefined,
      quests: undefined,
      recipes: undefined,
      transmogs: undefined,
      honorableKills: undefined,
      honorLevel: undefined
    }
    fileDailyReading(id, partial)

    const latest = memory.db
      .prepare('SELECT titles, quests, recipes, transmogs, honorable_kills, honor_level FROM snapshots WHERE character_id = ? ORDER BY taken_at DESC LIMIT 1')
      .get(id) as Record<string, unknown>
    expect(latest.titles).toBe(5)
    expect(latest.quests).toBe(6)
    expect(latest.honor_level).toBe(9)
  })

  it('leaves the score null when a figure the rating weighs is missing', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    const partial = profile()
    ;(partial as { ap?: unknown }).ap = undefined
    fileDailyReading(id, partial)

    const row = memory.db.prepare('SELECT score FROM snapshots WHERE character_id = ?').get(id) as { score: number | null }
    expect(row.score).toBeNull()
  })
})

describe('readCharacterHistory', () => {
  it('is nothing for a character the site has no row for', () => {
    expect(readCharacterHistory('eu', 'gordunni', 'nobody', 'score')).toBeNull()
  })

  it('reads one metric a point a day, oldest first', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Testchar' })

    memory.addSnapshot({ characterId: id, takenAt: 1000, mounts: 10, score: 123 })
    memory.addSnapshot({ characterId: id, takenAt: 1000 + SECONDS_PER_DAY, mounts: 20, mplus: 1800 })
    // A second point of the *same* day is not a second point of the history: the table is folded to the newest
    // reading of each day, which is what a history is (`fileDailyReading`), and a row filed by an older build - a
    // point per change - is folded the same way.
    memory.addSnapshot({ characterId: id, takenAt: 1000 + SECONDS_PER_DAY + 120, mounts: 25 })

    const history = readCharacterHistory('eu', 'gordunni', 'testchar', 'mounts')

    expect(history?.character).toEqual({ region: 'eu', realm: 'gordunni', name: 'testchar', displayName: 'Testchar' })
    expect(history?.metric).toBe('mounts')
    expect(history?.points).toEqual([
      { takenAt: 1000, value: 10 },
      { takenAt: 1000 + SECONDS_PER_DAY + 120, value: 25 }
    ])
  })

  it('reads the snake_case column of a metric the wire spells in camelCase', () => {
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Testchar' })
    memory.addSnapshot({ characterId: id, takenAt: 1000, mplus: 1800 })

    const history = readCharacterHistory('eu', 'gordunni', 'testchar', 'mPlusScore')
    expect(history?.points).toEqual([{ takenAt: 1000, value: 1800 }])
  })
})

/**
 * The distribution of one figure, over the population the statistics are counted over.
 *
 * What these tests pin down is the figure and the shape - a character read twice counts once, a character never
 * read for this figure is not in it at all, and a character the site has no row for is answered with nothing
 * rather than a fabricated place. The population itself (guests, and the main of an account that signed in) is
 * the subject of `./statisticsPopulation.test.ts`; the characters here are guests, which is the simplest way to
 * be in it.
 */
describe('readSnapshotDistribution', () => {
  it('reads one figure per character, from its newest point', () => {
    const alpha = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Alpha' })
    const beta = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Beta' })
    const gamma = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Gamma' })
    const delta = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Delta' })

    memory.addSnapshot({ characterId: alpha, takenAt: 1000, transmogs: 10 })
    memory.addSnapshot({ characterId: alpha, takenAt: 2000, transmogs: 30 })
    memory.addSnapshot({ characterId: beta, takenAt: 1000, transmogs: 20 })
    memory.addSnapshot({ characterId: delta, takenAt: 1000, transmogs: 5 })
    // Read, but never for this figure: it is not part of the population, and its bucket holds nobody.
    memory.addSnapshot({ characterId: gamma, takenAt: 1000, quests: 5 })

    const distribution = readSnapshotDistribution('transmogs', ['eu:gordunni:alpha', 'eu:gordunni:beta'])

    expect(distribution.metric).toBe('transmogs')
    expect(distribution.population).toBe(3)
    expect(distribution.bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(3)
    expect(distribution.bins[0]?.from).toBe(5)
    expect(distribution.bins[distribution.bins.length - 1]?.to).toBe(30)
    // Alpha's newest point is 30, not the 10 it held before - and the two places count the figures above them.
    expect(distribution.positions).toEqual([
      { key: 'eu:gordunni:alpha', value: 30, rank: 1, percentile: 33 },
      { key: 'eu:gordunni:beta', value: 20, rank: 2, percentile: 67 }
    ])
    expect(distribution.updatedAt).toBe(new Date(2000 * 1000).toISOString())
  })

  it('answers a character the site has never read with nothing rather than a place', () => {
    const alpha = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Alpha' })
    memory.addSnapshot({ characterId: alpha, takenAt: 1000, transmogs: 10 })

    const distribution = readSnapshotDistribution('transmogs', ['eu:gordunni:nobody'])

    expect(distribution.population).toBe(1)
    expect(distribution.positions).toEqual([
      { key: 'eu:gordunni:nobody', value: null, rank: null, percentile: null }
    ])
  })

  it('is an empty histogram for a figure no reading ever carried', () => {
    const alpha = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Alpha' })
    memory.addSnapshot({ characterId: alpha, takenAt: 1000, transmogs: 10 })

    const distribution = readSnapshotDistribution('honorLevel', ['eu:gordunni:alpha'])

    expect(distribution.population).toBe(0)
    expect(distribution.bins).toEqual([])
    expect(distribution.updatedAt).toBe('')
    expect(distribution.positions[0]).toMatchObject({ value: null, rank: null, percentile: null })
  })
})
