/**
 * The history: the event-log writes (`fileDailyReading`) and the reader that serves them (`readCharacterHistory`).
 *
 * The record is one point per real update, not one per day, so the tests below are about exactly that: a first
 * read files a point, an unchanged read files nothing, a changed read files a new point, and a partial read
 * keeps what the newest point already holds. The overall rating is stored with the point (computed when the six
 * figures it weighs are all present), and the reader maps the snapshot's snake_case columns to the camelCase the
 * wire speaks - so both halves are exercised against the very SQL the site runs, through `memoryDb`.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { CharacterData } from '../../server/utils/blizzard'
import { fileDailyReading, readCharacterHistory } from '../../server/utils/characterReading'
import { calculatePlayerScore } from '../../server/utils/playerScore'
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

  it('files a new point when a figure moved', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    fileDailyReading(id, profile())

    const grown = profile()
    grown.stats.mounts = { count: 150, total: 800 }
    fileDailyReading(id, grown)

    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE character_id = ?').get(id)).toMatchObject({ n: 2 })
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

  it('reads one metric oldest first, mapped to the wire shape', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })

    memory.addSnapshot({ characterId: id, takenAt: 1000, mounts: 10, score: 123 })
    memory.addSnapshot({ characterId: id, takenAt: 2000, mounts: 20, mplus: 1800 })

    const history = readCharacterHistory('eu', 'gordunni', 'testchar', 'mounts')

    expect(history?.character).toEqual({ region: 'eu', realm: 'gordunni', name: 'testchar', displayName: 'Testchar' })
    expect(history?.metric).toBe('mounts')
    expect(history?.points).toEqual([
      { takenAt: 1000, value: 10 },
      { takenAt: 2000, value: 20 }
    ])
  })

  it('reads the snake_case column of a metric the wire spells in camelCase', () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'gordunni', name: 'Testchar' })
    memory.addSnapshot({ characterId: id, takenAt: 1000, mplus: 1800 })

    const history = readCharacterHistory('eu', 'gordunni', 'testchar', 'mPlusScore')
    expect(history?.points).toEqual([{ takenAt: 1000, value: 1800 }])
  })
})
