/**
 * The one character read behind the account sync, and the rule that keeps two passes from reading it twice.
 *
 * `refreshCharacterStats` is the expensive half: a full Blizzard profile plus the id lists that fill the
 * account pool. It is called from the profile page on a click and from the background pass, and the two can
 * overlap - so a character already being read is shared rather than read twice. These tests pin that rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, type MemoryDb } from '../helpers/memoryDb'
import type { CharacterRow } from '../../server/utils/accountSync'

const getCharacter = vi.fn()
const getCharacterMountIds = vi.fn(async () => [] as number[])
const getMaxedReputationIds = vi.fn(async () => [] as number[])
const getCharacterTitleIds = vi.fn(async () => [] as number[])
const getCharacterQuestIds = vi.fn(async () => [] as number[])
const getCharacterRecipeIds = vi.fn(async () => [] as number[])
const getCharacterProfessions = vi.fn(async () => [] as string[])
const getCharacterTransmogs = vi.fn(async () => null)
const addToPool = vi.fn(() => 0)
const syncPoolReputations = vi.fn(() => 0)
const syncPoolFigures = vi.fn(() => 0)

const profile = {
  name: 'X',
  realm: 'Gordunni',
  classId: 8,
  level: 80,
  faction: 'HORDE',
  avatarUrl: '',
  ilvl: 600,
  mPlusScore: 2500,
  ap: 11000,
  stats: {
    mounts: { count: 1200 },
    pets: { count: 1400 },
    toys: { count: 900 },
    decor: { count: 90 },
    reputations: { count: 50 },
    titles: { count: 5 },
    quests: { count: 100 },
    recipes: { count: 30 },
    transmogs: { count: 0 },
    honorableKills: { count: 0 },
    honorLevel: { count: 0 }
  }
}

const row: CharacterRow = {
  id: 1,
  user_id: 1,
  region: 'eu',
  realm_slug: 'gordunni',
  name: 'x',
  name_key: 'x'
}

beforeEach(() => {
  vi.resetModules()
  getCharacter.mockResolvedValue(profile)
  const g = globalThis as Record<string, unknown>
  g.getCharacter = getCharacter
  g.getCharacterMountIds = getCharacterMountIds
  g.getMaxedReputationIds = getMaxedReputationIds
  g.getCharacterTitleIds = getCharacterTitleIds
  g.getCharacterQuestIds = getCharacterQuestIds
  g.getCharacterRecipeIds = getCharacterRecipeIds
  g.getCharacterProfessions = getCharacterProfessions
  g.getCharacterTransmogs = getCharacterTransmogs
  g.addToPool = addToPool
  g.syncPoolReputations = syncPoolReputations
  g.syncPoolFigures = syncPoolFigures
  g.useDb = () => ({ prepare: () => ({ run: () => ({}), get: () => undefined, all: () => [] }) })
})

describe('refreshCharacterStats', () => {
  it('shares one read between two concurrent callers', async () => {
    const { refreshCharacterStats } = await import('../../server/utils/accountSync')

    const first = refreshCharacterStats(row)
    const second = refreshCharacterStats(row)
    await Promise.all([first, second])

    expect(getCharacterMountIds).toHaveBeenCalledTimes(1)
    expect(getCharacter).toHaveBeenCalledTimes(1)
  })

  it('reads different characters independently', async () => {
    const { refreshCharacterStats } = await import('../../server/utils/accountSync')

    await refreshCharacterStats(row)
    await refreshCharacterStats({ ...row, id: 2 })

    expect(getCharacterMountIds).toHaveBeenCalledTimes(2)
  })
})

describe('a pass over the due characters', () => {
  /** The due row a pass would read, and the connection that hands it over. */
  function withOneDueCharacter(): void {
    ;(globalThis as Record<string, unknown>).useDb = () => ({
      prepare: () => ({ run: () => ({}), get: () => undefined, all: () => [row] })
    })
  }

  it('closes the pass it claimed, counts what it found, and reports no queue it does not have', async () => {
    const { runSyncPass } = await import('../../server/utils/accountSync')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    // Nothing is due, so the pass reads nobody - but the pass itself is real, and is reported as one.
    const counters = await runSyncPass('timer')

    expect(counters).toEqual({ checked: 0, updated: 0, skipped: 0, errors: 0 })

    const state = readDiagnosticBuffers().sync
    expect(state.running).toBe(false)
    expect(state.passes).toBe(1)
    expect(state.source).toBe('timer')
    expect(state.lastStartAt).not.toBeNull()
    expect(state.lastFinishAt).not.toBeNull()
    expect(state.lastDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('counts a reading that moved a figure apart from one that said the same thing', async () => {
    withOneDueCharacter()

    const { runSyncPass } = await import('../../server/utils/accountSync')
    const counters = await runSyncPass('timer')

    // One character was examined; the shared stub's profile carries figures, so the day's point moved.
    expect(counters?.checked).toBe(1)
    expect(counters?.updated).toBe(1)
    expect(counters?.skipped).toBe(0)
    expect(counters?.errors).toBe(0)
  })

  it('files a failed read as an error of the pass rather than letting it stop the batch', async () => {
    withOneDueCharacter()
    getCharacter.mockRejectedValue(Object.assign(new Error('Blizzard is not answering'), { statusCode: 503 }))

    const { runSyncPass } = await import('../../server/utils/accountSync')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    const counters = await runSyncPass('timer')

    expect(counters).toEqual({ checked: 1, updated: 0, skipped: 0, errors: 1 })

    const state = readDiagnosticBuffers()
    expect(state.sync.errors).toBe(1)
    expect(state.sync.lastErrorCategory).toBe('sync')
    expect(state.errors[0]).toMatchObject({ level: 'warn', category: 'sync', status: 503 })
  })

  it('refuses a second pass while one is running, whoever asked for it', async () => {
    withOneDueCharacter()

    // The read is held open, so the first pass is still running when the second asks.
    let release: () => void = () => {}
    getCharacter.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(profile)
        })
    )

    const { runSyncPass } = await import('../../server/utils/accountSync')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    const first = runSyncPass('timer')
    const second = await runSyncPass('on-demand')

    // One claim, one pass: the page asking for its roster adds nothing, because there is nothing to queue it in.
    expect(second).toBeNull()
    expect(readDiagnosticBuffers().sync.running).toBe(true)

    release()
    await first

    const state = readDiagnosticBuffers().sync
    expect(state.running).toBe(false)
    expect(state.passes).toBe(1)
  })
})

describe('a pass and the characters it cannot read', () => {
  /**
   * A throwaway database the pass may really query.
   *
   * The tests above stub the connection because they are about *one* character's read; these are about *who the
   * pass chooses*, which is decided by SQL - so they run against the real schema the site runs against
   * (`test/helpers/memoryDb.ts`), with the network stubbed and nothing else.
   */
  function withDueCharacters(saved: { name: string; level?: number; isMain?: boolean }[]) {
    const memory = createMemoryDb()
    ;(globalThis as Record<string, unknown>).useDb = () => memory.db

    memory.addUser(1)
    for (const character of saved) {
      memory.addCharacter({
        userId: 1,
        region: 'eu',
        realm: 'Gordunni',
        name: character.name,
        isMain: character.isMain,
        level: character.level
      })
    }

    return memory
  }

  /** The retry state as the rows hold it, which is what the next pass's own query reads. */
  function parkedCharacters(memory: MemoryDb): { id: number; sync_error: string | null }[] {
    return memory.db
      .prepare('SELECT id, sync_error FROM characters WHERE sync_retry_at IS NOT NULL AND sync_retry_at > ?')
      .all(Math.floor(Date.now() / 1000)) as unknown as { id: number; sync_error: string | null }[]
  }

  const notFound = () => Object.assign(new Error('There is no such character on that realm'), { statusCode: 404 })
  const unreadable = (name: string) => name.startsWith('bad')

  /**
   * A profile a *successful* read hands back, and deliberately a partial one.
   *
   * The account's own aggregate (`fileAccountReading` in `./accountPool`) needs a reading that carries all six
   * collection figures, and the schema this test's database has is the site's selection and history tables rather
   * than every one of them - so the profile leaves one collection unread, which is the ordinary case the site
   * documents ("a caller that has read one figure hands over one figure") and makes the account's aggregate stand
   * aside. What is under test here is who the pass *chooses*, and that is decided before any of this.
   */
  const readableProfile = { ...profile, stats: { ...profile.stats, decor: undefined } } as never

  it('reports the incident: five checked, five failed, and one line per character that can be acted on', async () => {
    const memory = withDueCharacters([
      { name: 'bad1', level: 80 },
      { name: 'bad2', level: 80 },
      { name: 'bad3', level: 80 },
      { name: 'bad4', level: 80 },
      { name: 'bad5', level: 80 },
      { name: 'good1', level: 1 }
    ])

    getCharacter.mockImplementation((_realm: string, name: string) =>
      unreadable(name) ? Promise.reject(notFound()) : Promise.resolve(readableProfile)
    )

    const { runSyncPass } = await import('../../server/utils/accountSync')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    const counters = await runSyncPass('timer', 5)

    expect(counters).toEqual({ checked: 5, updated: 0, skipped: 0, errors: 5 })
    // The invariant the panel leans on, in the very shape the panel showed it.
    expect(counters!.checked).toBe(counters!.updated + counters!.skipped + counters!.errors)

    // Every one of the five is remembered, with the code of what went wrong.
    expect(parkedCharacters(memory)).toHaveLength(5)
    expect(parkedCharacters(memory).every((row) => row.sync_error === 'missing')).toBe(true)

    const sync = readDiagnosticBuffers()
    expect(sync.sync.errors).toBe(5)
    const lines = sync.errors.filter((entry) => entry.category === 'sync')
    expect(lines).toHaveLength(5)

    // Each carries the identity of the character it is about, and the moment it will be tried again.
    for (const line of lines) {
      expect(line.context?.characterId).toBeGreaterThan(0)
      expect(line.context?.region).toBe('eu')
      expect(line.context?.realm).toBe('gordunni')
      expect(line.context?.stage).toBe('profile')
      expect(line.context?.nextAttemptAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    }

    // And nothing was invented for any of them: a read that failed files no reading, and a failure is not a
    // successful read - so the characters keep no snapshot and their last-read moment is untouched.
    expect(memory.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get()).toEqual({ count: 0 })
    expect(memory.db.prepare('SELECT COUNT(*) AS count FROM characters WHERE stats_read_at IS NOT NULL').get()).toEqual({
      count: 0
    })
  })

  it('does not let the same unreadable characters take every pass', async () => {
    const memory = withDueCharacters([
      { name: 'bad1', level: 80 },
      { name: 'bad2', level: 80 },
      { name: 'bad3', level: 80 },
      { name: 'bad4', level: 80 },
      { name: 'bad5', level: 80 },
      { name: 'good1', level: 1 }
    ])

    getCharacter.mockImplementation((_realm: string, name: string) =>
      unreadable(name) ? Promise.reject(notFound()) : Promise.resolve(readableProfile)
    )

    const { runSyncPass } = await import('../../server/utils/accountSync')

    // Pass one: the five unreadable characters, and only them.
    const first = await runSyncPass('timer', 5)
    expect(first).toEqual({ checked: 5, updated: 0, skipped: 0, errors: 5 })

    // Pass two - the very next tick, three minutes later: the character that was behind them is finally read.
    // Before the retry state existed this pass selected the same five, for ever, and `good1` was never reached.
    const second = await runSyncPass('timer', 5)
    expect(second).toEqual({ checked: 1, updated: 1, skipped: 0, errors: 0 })

    // Pass three: the readable character now has a reading, so it is no longer due, and the five parked ones are
    // still waiting - a pass that examines nobody, rather than a pass that fails five times over again.
    const third = await runSyncPass('timer', 5)
    expect(third).toEqual({ checked: 0, updated: 0, skipped: 0, errors: 0 })

    expect(parkedCharacters(memory)).toHaveLength(5)
  })

  it('does not read again a character it has just read when its figures did not move', async () => {
    // The production incident: a character whose newest snapshot is two days old, and whose figures have not
    // changed since. A read files no new snapshot (nothing moved), so before the fix the character stayed "due"
    // and was read again on every pass - ten characters, a hundred and twenty Blizzard calls, every three minutes.
    const memory = withDueCharacters([{ name: 'steady', level: 80 }])
    const id = (memory.db.prepare('SELECT id FROM characters').get() as { id: number }).id
    memory.addSnapshot({
      characterId: id,
      takenAt: Math.floor(Date.now() / 1000) - 2 * 86400,
      mplus: 2500,
      achievements: 11000,
      mounts: 1200,
      pets: 1400,
      toys: 900,
      decor: 90,
      reputations: 50,
      titles: 5,
      quests: 100,
      recipes: 30,
      transmogs: 0,
      honorableKills: 0,
      honorLevel: 0
    })

    getCharacter.mockResolvedValue(readableProfile)
    const { runSyncPass, countDueCharacters } = await import('../../server/utils/accountSync')

    // The first pass reads it, and the reading says what the site already had.
    expect(await runSyncPass('timer', 5)).toEqual({ checked: 1, updated: 0, skipped: 1, errors: 0 })
    expect(memory.db.prepare('SELECT COUNT(*) AS count FROM snapshots').get()).toEqual({ count: 1 })

    // The next tick: the character was read a moment ago, so it is not due - and the panel's estimate agrees.
    expect(countDueCharacters()).toBe(0)
    expect(await runSyncPass('timer', 5)).toEqual({ checked: 0, updated: 0, skipped: 0, errors: 0 })
    expect(getCharacter).toHaveBeenCalledTimes(1)
  })

  it('reads a character again once its last read is a day old', async () => {
    const memory = withDueCharacters([{ name: 'stale', level: 80 }])
    memory.db.prepare('UPDATE characters SET stats_read_at = ?').run(Math.floor(Date.now() / 1000) - 86400 - 60)

    getCharacter.mockResolvedValue(readableProfile)
    const { runSyncPass } = await import('../../server/utils/accountSync')

    expect((await runSyncPass('timer', 5))?.checked).toBe(1)
  })

  it('keeps reading the rest of the batch after one character fails', async () => {
    withDueCharacters([
      { name: 'bad1', level: 80 },
      { name: 'good1', level: 70 },
      { name: 'good2', level: 60 }
    ])

    getCharacter.mockImplementation((_realm: string, name: string) =>
      unreadable(name) ? Promise.reject(notFound()) : Promise.resolve(readableProfile)
    )

    const { runSyncPass } = await import('../../server/utils/accountSync')

    const counters = await runSyncPass('timer', 5)

    // The failure is one row of the report; the two readable characters are still read.
    expect(counters).toEqual({ checked: 3, updated: 2, skipped: 0, errors: 1 })
  })

  it('counts one attempt per character it really tried to read', async () => {
    withDueCharacters([{ name: 'good1', level: 80 }, { name: 'good2', level: 70 }, { name: 'good3', level: 60 }])

    getCharacter.mockResolvedValue(readableProfile)

    const { runSyncPass } = await import('../../server/utils/accountSync')
    const counters = await runSyncPass('timer', 2)

    // Two characters asked for, two reads made: the counters are the attempts, not the arithmetic.
    expect(counters?.checked).toBe(2)
    expect(getCharacter).toHaveBeenCalledTimes(2)
  })

  it('forgets a characterâ€™s failures the moment a read works again', async () => {
    const memory = withDueCharacters([{ name: 'bad1', level: 80 }])

    getCharacter.mockRejectedValue(notFound())
    const { runSyncPass } = await import('../../server/utils/accountSync')

    expect(await runSyncPass('timer', 5)).toEqual({ checked: 1, updated: 0, skipped: 0, errors: 1 })
    expect(parkedCharacters(memory)).toHaveLength(1)

    // The wait is over (or the reason for it went away), the address answers, and the state goes with it.
    memory.db.prepare('UPDATE characters SET sync_retry_at = ?').run(Math.floor(Date.now() / 1000) - 1)
    getCharacter.mockResolvedValue(readableProfile)

    expect(await runSyncPass('timer', 5)).toEqual({ checked: 1, updated: 1, skipped: 0, errors: 0 })

    const row = memory.db.prepare('SELECT sync_failures, sync_retry_at, sync_error FROM characters').get()
    expect(row).toEqual({ sync_failures: 0, sync_retry_at: null, sync_error: null })
  })
})
