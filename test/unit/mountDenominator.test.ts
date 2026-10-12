/**
 * The mount denominator a profile is answered with, when the journal behind it has moved on.
 *
 * A profile is cached twice over - ten minutes as a reading (`getCharacter`), two hours as an answer
 * (`/api/character`) - while the Armoury is read behind the page and lands in the same process within
 * seconds. The denominator used to be captured with the reading, so a tile could go on printing the shared
 * snapshot for two hours after the character's own journal was on file. What `overlayPool` owes now is the
 * journal as it builds the answer: the number moves with the journal, nothing else about the answer does,
 * no lookup is made to get it, and neither the cached profile nor the reading behind it is written into.
 *
 * The Armoury is read the way the site reads it - through the `$fetch` Nuxt hands the module - so the tests
 * below serve pages and count every call: a call made to print a denominator is a call the site did not need.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { overlayPool } from '../../server/utils/accountPool'
import { refreshMountJournal } from '../../server/utils/armory'
import { calculatePlayerScore, scoreFigures } from '../../server/utils/playerScore'
import type { CharacterData } from '../../server/utils/blizzard'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

/** A page shaped the way the Armoury ships one: the journal cut out of a `<script>` block. */
function armouryPage(total: number, collected: number): string {
  const list = Array.from({ length: total }, (_, index) => ({ id: index, collected: index < collected }))
  return `<html><script>{"mountsCollected":${collected},"mounts":[${list
    .map((entry) => JSON.stringify(entry))
    .join(',')}]}</script></html>`
}

/** The journal the Armoury is serving here: 1,387 mounts, 1,265 of them collected. */
const JOURNAL_TOTAL = 1387
/** The denominator the shared snapshot stands in with, as the cached profile carries it. */
const SNAPSHOT_TOTAL = 1291
/** What the character's own list holds, which is the count both answers print. */
const COLLECTED = 1265

let memory: MemoryDb
/** Every call the modules under test made through `$fetch`, whichever host they were for. */
let calls: number

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
  calls = 0
  ;(globalThis as Record<string, unknown>).$fetch = async () => {
    calls += 1
    return armouryPage(JOURNAL_TOTAL, COLLECTED)
  }
})

/** A profile as the endpoint's cache holds one: the snapshot behind it, 1,291, and the count above it. */
function cachedProfile(): CharacterData {
  return {
    name: 'Нейромаск',
    realm: 'Gordunni',
    region: 'eu',
    level: 90,
    ilvl: 317,
    mPlusScore: 2500,
    ap: 12000,
    classId: 8,
    faction: 'HORDE',
    renderUrl: '',
    avatarUrl: '',
    backgroundUrl: '',
    raceId: 0,
    gender: '',
    pooled: false,
    score: 0,
    stats: {
      achievements: { count: 12000, total: 40000 },
      mounts: { count: COLLECTED, total: SNAPSHOT_TOTAL },
      pets: { count: 1471, total: 2179 },
      toys: { count: 959, total: 1135 },
      decor: { count: 100, total: 2131 },
      reputations: { count: 5, total: 100, accountWide: false }
    }
  } as never
}

/** An answer with the one number under test taken out of it, so the rest can be compared as it stands. */
function withoutDenominator(value: CharacterData) {
  return {
    ...value,
    stats: { ...value.stats, mounts: { ...value.stats.mounts, total: 0 } }
  }
}

describe('the denominator a guest profile is answered with', () => {
  it('is the journal on file, not the one the cached profile was answered with', async () => {
    await refreshMountJournal('eu', 'gordunni', 'neuromask')
    const lookups = calls

    const result = overlayPool(cachedProfile(), 'eu', 'gordunni', 'neuromask')

    expect(result.pooled).toBe(false)
    expect(result.stats.mounts.count).toBe(COLLECTED)
    expect(result.stats.mounts.total).toBe(JOURNAL_TOTAL)
    // Nothing was read to print it: the journal was already on file, and reading it costs no call.
    expect(calls).toBe(lookups)
  })

  it('does not write into the profile it was handed', async () => {
    const profile = cachedProfile()
    const before = JSON.parse(JSON.stringify(profile))
    await refreshMountJournal('eu', 'gordunni', 'untouched')

    const result = overlayPool(profile, 'eu', 'gordunni', 'untouched')

    expect(result).not.toBe(profile)
    expect(result.stats).not.toBe(profile.stats)
    expect(profile).toEqual(before)
    // the rating is the one the reading's own figures give, unchanged by the journal
    expect(result.score).toBe(calculatePlayerScore(scoreFigures(profile.stats)))
  })
})

describe('the denominator when the site holds no journal for the character', () => {
  it('leaves the fallback standing, and prints no zero', () => {
    const result = overlayPool(cachedProfile(), 'eu', 'gordunni', 'never-read')

    expect(result.stats.mounts.total).toBe(SNAPSHOT_TOTAL)
    expect(result.stats.mounts.total).toBeGreaterThan(0)
    expect(calls).toBe(0)
  })

  it('is the count itself when the reading behind it is larger than the fallback', () => {
    const profile = cachedProfile()
    profile.stats.mounts = { count: 1500, total: SNAPSHOT_TOTAL }

    const result = overlayPool(profile, 'eu', 'gordunni', 'never-read')

    expect(result.stats.mounts.total).toBe(1500)
  })
})

describe("the denominator an account's profile is answered with", () => {
  /**
   * A roster: one account with the characters named, and a pool holding that many mount ids.
   *
   * The pool is the account's own figure (`server/utils/accountPool`), so the count the answer prints is the
   * higher of it and the reading - which is the number the denominator has to stay above.
   */
  function roster(userId: number, names: string[], mounts: number): void {
    memory.addUser(userId)
    for (const name of names) memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name })
    memory.addPoolItems(userId, 'mounts', Array.from({ length: mounts }, (_, index) => index))
  }

  it('is the journal on file there too', async () => {
    roster(42, ['owned'], 3)
    await refreshMountJournal('eu', 'gordunni', 'owned')

    const result = overlayPool(cachedProfile(), 'eu', 'gordunni', 'owned')

    expect(result.pooled).toBe(true)
    expect(result.stats.mounts.count).toBe(COLLECTED)
    expect(result.stats.mounts.total).toBe(JOURNAL_TOTAL)
  })

  it('is raised to the count when the account holds more than the journal lists', async () => {
    roster(42, ['union'], 1400)
    await refreshMountJournal('eu', 'gordunni', 'union')

    const result = overlayPool(cachedProfile(), 'eu', 'gordunni', 'union')

    expect(result.stats.mounts.count).toBe(1400)
    expect(result.stats.mounts.total).toBe(1400)
    expect(result.stats.mounts.total).toBeGreaterThanOrEqual(result.stats.mounts.count)
  })

  it('moves the denominator and nothing else about the answer', async () => {
    // One account, two of its characters: the account's figures are the same for both, so the only thing
    // that can differ between the two answers below is the journal each of the names has on file.
    roster(7, ['watched', 'quiet'], 10)
    await refreshMountJournal('eu', 'gordunni', 'watched')

    const quiet = overlayPool(cachedProfile(), 'eu', 'gordunni', 'quiet')
    const watched = overlayPool(cachedProfile(), 'eu', 'gordunni', 'watched')

    expect(watched.stats.mounts.total).toBe(JOURNAL_TOTAL)
    expect(quiet.stats.mounts.total).toBe(SNAPSHOT_TOTAL)
    // the rating of the reading's own figures: the pool holds ten mounts against a character's 1,265
    expect(watched.score).toBe(
      calculatePlayerScore({
        achievements: 12000,
        mounts: COLLECTED,
        pets: 1471,
        toys: 959,
        decor: 100,
        reputations: 5
      })
    )
    // and every other field of the answer - the rating, the account's figures, the tiles - is one answer
    expect(watched.score).toBe(quiet.score)
    expect(watched.ap).toBe(quiet.ap)
    expect(watched.pooled).toBe(quiet.pooled)
    expect(watched.stats.mounts.count).toBe(quiet.stats.mounts.count)
    expect(watched.stats.reputations).toEqual(quiet.stats.reputations)
    expect(withoutDenominator(watched)).toEqual(withoutDenominator(quiet))
  })

  it('asks nothing of Blizzard to print it, an answer after the first', async () => {
    roster(9, ['no-lookup'], 0)
    await refreshMountJournal('eu', 'gordunni', 'no-lookup')
    const lookups = calls

    overlayPool(cachedProfile(), 'eu', 'gordunni', 'no-lookup')
    overlayPool(cachedProfile(), 'eu', 'gordunni', 'no-lookup')

    expect(calls).toBe(lookups)
  })
})

