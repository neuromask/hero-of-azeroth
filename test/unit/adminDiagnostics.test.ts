/**
 * What the process tells the panel about itself, and what it refuses to tell it.
 *
 * The module is a small pile of process-wide counters, so every rule in it is a rule about honesty rather than
 * about logic: a figure is a count that really happened, a file that cannot be read is told apart from a file
 * that is not there, a message that carried a token is *not* stored with the token, and the log cannot grow
 * past its ceiling. These tests are those rules, run against a throwaway database and a throwaway data
 * directory, with the module's own state cleared between them.
 *
 * Nothing here touches a real database, a real data directory or Blizzard.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A `statSync` that can be told to fail, so the one branch a test cannot produce on every platform - a file
 * that is *there* and cannot be read - can still be exercised. Everything else is the real thing.
 */
const fsState = vi.hoisted(() => ({ fail: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statSync: (path: string) => {
      if (fsState.fail) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      return actual.statSync(path)
    }
  }
})

import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import {
  beginSyncPass,
  buildAdminDiagnostics,
  chargeManualRefresh,
  claimManualOperation,
  clearAdminDiagnostics,
  finishSyncPass,
  MEMORY_WARN_BYTES,
  manualOperationRunning,
  manualRefreshCoolingDown,
  readAdminDiagnostics,
  readDiagnosticBuffers,
  recordBlizzardCall,
  recordDiagnostic,
  recordManualRefresh,
  recordTimerTick,
  recordToleratedAbsence,
  releaseManualOperation
} from '../../server/utils/adminDiagnostics'
import { nowSec } from '../../server/utils/db'
import { BLIZZARD_BUCKET_COUNT, DIAGNOSTIC_LOG_LIMIT, SYNC_INTERVAL_MS } from '../../shared/data/adminDiagnostics'

let memory: MemoryDb
let dataDir = ''

/** How many times the module reached for a database connection, so a cache can be seen to be a cache. */
let queries = 0

beforeEach(() => {
  memory = createMemoryDb()
  // The one table the throwaway schema does not carry, and whose absence would be a *recorded* failure of its
  // own rather than a figure the panel simply does not have.
  memory.db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')

  installUseDb(memory.db)
  queries = 0

  const real = globalThis as Record<string, unknown>
  real.useDb = () => {
    queries += 1
    return memory.db
  }

  dataDir = mkdtempSync(join(tmpdir(), 'hoa-diag-'))
  process.env.NUXT_DATA_DIR = dataDir

  fsState.fail = false
  clearAdminDiagnostics()
})

afterEach(() => {
  delete process.env.NUXT_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

describe('the Blizzard counters', () => {
  it('counts what the process actually asked for, and tells the kinds of failure apart', () => {
    recordBlizzardCall({ ok: true, durationMs: 100 })
    recordBlizzardCall({ ok: true, durationMs: 200 })
    recordBlizzardCall({ ok: false, durationMs: 50, status: 429 })
    recordBlizzardCall({ ok: false, durationMs: 30, timeout: true })
    recordBlizzardCall({ ok: false, durationMs: 40, status: 503 })

    const report = readDiagnosticBuffers().blizzardApi

    expect(report.total).toBe(5)
    expect(report.ok).toBe(2)
    expect(report.failed).toBe(3)
    expect(report.rateLimited).toBe(1)
    expect(report.timeouts).toBe(1)
    expect(report.serverErrors).toBe(1)
    expect(report.lastMs).toBe(40)
    // The mean of 100, 200, 50, 30 and 40.
    expect(report.averageMs).toBe(84)
    expect(report.lastErrorCategory).toBe('blizzard')
  })

  it('spreads the last hour over a fixed number of slots rather than one entry per call', () => {
    for (let call = 0; call < 500; call += 1) recordBlizzardCall({ ok: true, durationMs: 10 })

    const report = readDiagnosticBuffers().blizzardApi

    expect(report.buckets).toHaveLength(BLIZZARD_BUCKET_COUNT)
    expect(report.buckets[report.buckets.length - 1]!.calls).toBe(500)
    // Oldest first, each slot naming its own start.
    expect(report.buckets[0]!.at).toBeLessThan(report.buckets[report.buckets.length - 1]!.at)
  })
})

describe('the log', () => {
  it('cannot grow past its ceiling, and keeps the newest entries', () => {
    for (let entry = 0; entry < DIAGNOSTIC_LOG_LIMIT + 50; entry += 1) {
      recordDiagnostic({ level: 'warn', category: 'sync', message: `entry ${entry}` })
    }

    const { errors } = readDiagnosticBuffers()

    expect(errors).toHaveLength(DIAGNOSTIC_LOG_LIMIT)
    expect(errors[0]!.message).toBe(`entry ${DIAGNOSTIC_LOG_LIMIT + 49}`)
  })

  it('files an unknown category as `other` rather than printing whatever arrived', () => {
    recordDiagnostic({ level: 'error', category: '<script>alert(1)</script>', message: 'x' })
    expect(readDiagnosticBuffers().errors[0]!.category).toBe('other')
  })

  it('takes a status only when it is a real one', () => {
    recordDiagnostic({ level: 'error', category: 'blizzard', message: 'a', status: 503 })
    recordDiagnostic({ level: 'error', category: 'blizzard', message: 'b', status: 99_999 })

    const { errors } = readDiagnosticBuffers()

    expect(errors[1]!.status).toBe(503)
    expect('status' in errors[0]!).toBe(false)
  })

  it('strips the things that must not leave the process: URLs, tokens and BattleTags', () => {
    recordDiagnostic({
      level: 'error',
      category: 'blizzard',
      message:
        'GET https://eu.api.blizzard.com/profile/wow/character/gordunni/bob?namespace=profile-eu failed for neuromask#2809 with Authorization: Bearer 0123456789abcdefghijklmnopqrstuvwxyz'
    })

    const [entry] = readDiagnosticBuffers().errors
    const stored = JSON.stringify(entry)

    expect(stored).not.toContain('blizzard.com')
    expect(stored).not.toContain('namespace')
    expect(stored).not.toContain('neuromask')
    expect(stored).not.toContain('0123456789abcdefghijklmnopqrstuvwxyz')
    expect(entry!.message).toContain('[url]')
    expect(entry!.message).toContain('[battletag]')
  })

  it('bounds the message itself, so one long line cannot fill the buffer', () => {
    recordDiagnostic({ level: 'warn', category: 'other', message: 'x'.repeat(2000) })
    expect(readDiagnosticBuffers().errors[0]!.message.length).toBeLessThanOrEqual(200)
  })
})

describe('the background pass', () => {
  it('is claimed once at a time, and reports what it did rather than what it might do', () => {
    expect(beginSyncPass('timer')).toBe(true)
    // A page asking while the timer is mid-pass gets nothing: there is one claim, and one pass.
    expect(beginSyncPass('on-demand')).toBe(false)

    const running = readDiagnosticBuffers().sync
    expect(running.running).toBe(true)
    expect(running.source).toBe('timer')

    finishSyncPass('timer', { checked: 10, updated: 3, skipped: 6, errors: 1 })

    const finished = readDiagnosticBuffers().sync
    expect(finished.running).toBe(false)
    expect(finished.checked).toBe(10)
    expect(finished.updated).toBe(3)
    expect(finished.skipped).toBe(6)
    expect(finished.errors).toBe(1)
    expect(finished.passes).toBe(1)
    expect(finished.lastFinishAt).not.toBeNull()
    expect(finished.lastDurationMs).toBeGreaterThanOrEqual(0)
    expect(finished.lastErrorCategory).toBe('sync')
  })

  it('has no queue to report, because there is no queue', () => {
    const report = readDiagnosticBuffers().sync

    expect(Object.keys(report)).not.toContain('queue')
    expect(Object.keys(report)).not.toContain('pending')
    expect(Object.keys(report)).not.toContain('queueLength')
  })

  it('counts an administrator’s own refresh apart from the passes', () => {
    recordManualRefresh('updated')

    const report = readDiagnosticBuffers().sync
    expect(report.manual.count).toBe(1)
    expect(report.manual.lastOutcome).toBe('updated')
    expect(report.passes).toBe(0)
  })

  it('holds one manual operation at a time, and a cooldown between presses', () => {
    expect(manualOperationRunning()).toBeNull()
    expect(claimManualOperation('character-refresh')).toBe(true)
    expect(claimManualOperation('database-optimize')).toBe(false)
    expect(manualOperationRunning()).toBe('character-refresh')

    releaseManualOperation('character-refresh')
    expect(manualOperationRunning()).toBeNull()

    expect(manualRefreshCoolingDown()).toBe(0)
    chargeManualRefresh()
    expect(manualRefreshCoolingDown()).toBeGreaterThan(0)
  })
})

describe('the answer the endpoint serves', () => {
  it('is the sections the panel reads, with the measurements in them', () => {
    const answer = buildAdminDiagnostics()

    expect(Object.keys(answer).sort()).toEqual(
      ['blizzardApi', 'cached', 'database', 'durationMs', 'errors', 'generatedAt', 'sync', 'system'].sort()
    )

    expect(answer.system.node).toBe(process.version)
    expect(answer.system.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(answer.system.memory.rssBytes).toBeGreaterThan(0)
    expect(answer.system.memory.heapUsedBytes).toBeGreaterThan(0)
    expect(answer.system.memory.externalBytes).toBeGreaterThanOrEqual(0)
    expect(answer.durationMs).toBeGreaterThanOrEqual(0)
    expect(answer.cached).toBe(false)
  })

  it('measures the database files, reading an absent one as zero rather than as a failure', () => {
    writeFileSync(join(dataDir, 'hoa.db'), Buffer.alloc(4096))

    const files = buildAdminDiagnostics().database.files

    expect(files.db.bytes).toBe(4096)
    expect(files.db.error).toBe(false)
    // A WAL that has never been written is not a WAL that failed: it is zero bytes.
    expect(files.wal.bytes).toBe(0)
    expect(files.wal.error).toBe(false)
    expect(files.shm.bytes).toBe(0)
    expect(files.shm.error).toBe(false)
  })

  it('tells a file it cannot read apart from a file that is not there', () => {
    // A file that is there and refuses to be read is not an empty database, and the panel must not draw it as
    // one: the size is unknown, and the entry says so.
    fsState.fail = true

    const files = buildAdminDiagnostics().database.files

    for (const file of [files.db, files.wal, files.shm]) {
      expect(file.bytes).toBeNull()
      expect(file.error).toBe(true)
    }
  })

  it('counts the tables, and keeps the counts that are not the same count apart', () => {
    memory.addUser(1)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Main', isMain: true })
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Alt' })
    memory.addGuestCharacter({ region: 'eu', realm: 'Gordunni', name: 'Stranger' })

    const answer = buildAdminDiagnostics()

    expect(answer.database.rows.characters).toBe(3)
    expect(answer.database.accountCharacters).toBe(2)
    expect(answer.database.guests).toBe(1)
    expect(answer.database.rows.users).toBe(1)
    expect(answer.database.rows.settings).toBe(0)
  })

  it('answers a moment already built from its own short cache, without asking the database again', () => {
    readAdminDiagnostics()
    const asked = queries

    const again = readAdminDiagnostics()

    expect(again.cached).toBe(true)
    expect(queries).toBe(asked)
  })

  it('forgets everything, which is what a test needs to start from a known state', () => {
    recordDiagnostic({ level: 'error', category: 'sync', message: 'x' })
    expect(readDiagnosticBuffers().errors).toHaveLength(1)

    clearAdminDiagnostics()

    expect(readDiagnosticBuffers().errors).toHaveLength(0)
    expect(readDiagnosticBuffers().blizzardApi.total).toBe(0)
    expect(readDiagnosticBuffers().sync.passes).toBe(0)
  })
})

describe('a failure that keeps happening', () => {
  it('is one line with a count, not a line per attempt', () => {
    const first = recordDiagnostic({
      level: 'warn',
      category: 'sync',
      message: 'character read failed (missing)',
      status: 404,
      context: { characterId: 7, region: 'eu', realm: 'gordunni', stage: 'profile', attempts: 1 }
    })

    recordDiagnostic({
      level: 'warn',
      category: 'sync',
      message: 'character read failed (missing)',
      status: 404,
      context: { characterId: 7, region: 'eu', realm: 'gordunni', stage: 'profile', attempts: 2 }
    })

    const { errors } = readDiagnosticBuffers()

    // One entry - and it is the newest attempt's own facts that stand, so the count and the wait are current.
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ count: 2, message: 'character read failed (missing)', status: 404 })
    expect(errors[0]!.context).toMatchObject({ characterId: 7, attempts: 2 })
    expect(errors[0]!.lastAt).toBeGreaterThanOrEqual(first.at)
  })

  it('keeps two characters apart, so a shared message is not one anonymous line', () => {
    recordDiagnostic({ level: 'warn', category: 'sync', message: 'x', context: { characterId: 1 } })
    recordDiagnostic({ level: 'warn', category: 'sync', message: 'x', context: { characterId: 2 } })

    expect(readDiagnosticBuffers().errors).toHaveLength(2)
  })

  it('still cannot grow past its ceiling when every line is a different character', () => {
    for (let id = 1; id <= DIAGNOSTIC_LOG_LIMIT + 20; id += 1) {
      recordDiagnostic({ level: 'warn', category: 'sync', message: 'x', context: { characterId: id } })
    }

    expect(readDiagnosticBuffers().errors).toHaveLength(DIAGNOSTIC_LOG_LIMIT)
  })

  it('carries only what may be printed: an id, an address, a stage word', () => {
    recordDiagnostic({
      level: 'warn',
      category: 'sync',
      message: 'x',
      context: {
        characterId: 3,
        region: 'eu',
        realm: 'gordunni',
        stage: 'profile',
        // Anything that is not one of those shapes is dropped rather than stored.
        ...({ token: 'secret-value', battletag: 'someone#1234' } as Record<string, never>)
      }
    })

    const [entry] = readDiagnosticBuffers().errors

    expect(entry!.context).toEqual({ characterId: 3, region: 'eu', realm: 'gordunni', stage: 'profile' })
    expect(JSON.stringify(entry)).not.toContain('secret-value')
    expect(JSON.stringify(entry)).not.toContain('someone')
  })

  it('drops a region or a realm that is not one of the site’s own, rather than storing what arrived', () => {
    recordDiagnostic({
      level: 'warn',
      category: 'sync',
      message: 'x',
      context: { region: 'https://evil.example/?x=1', realm: '<script>', characterId: -5 }
    })

    expect(readDiagnosticBuffers().errors[0]!.context).toBeUndefined()
  })
})

describe('the breakdown of what was asked of Blizzard', () => {
  it('counts by the kind of endpoint, never by the address that was called', () => {
    for (let call = 0; call < 4; call += 1) {
      recordBlizzardCall({ ok: false, durationMs: 20, status: 404, category: 'collections' })
    }
    recordBlizzardCall({ ok: false, durationMs: 30, status: 404, category: 'mythic-keystone' })
    recordBlizzardCall({ ok: true, durationMs: 100, category: 'profile' })
    // A category nobody ever used does not appear, and a made-up one is filed as `other`.
    recordBlizzardCall({ ok: true, durationMs: 10, category: 'not-a-category' })

    const report = readDiagnosticBuffers().blizzardApi

    expect(report.byCategory.map((row) => row.category)).toEqual([
      'collections',
      'profile',
      'mythic-keystone',
      'other'
    ])
    expect(report.byCategory[0]).toMatchObject({ calls: 4, ok: 0, failed: 4, averageMs: 20 })
    expect(report.byCategory[1]).toMatchObject({ calls: 1, ok: 1, failed: 0, averageMs: 100 })
    // The breakdown adds up to the totals: nothing is counted twice and nothing is lost.
    expect(report.byCategory.reduce((sum, row) => sum + row.calls, 0)).toBe(report.total)
    expect(report.byCategory.reduce((sum, row) => sum + row.failed, 0)).toBe(report.failed)
  })

  it('counts by status, with an answered call as a 2xx and an unanswered one as a zero', () => {
    recordBlizzardCall({ ok: true, durationMs: 10, category: 'profile' })
    recordBlizzardCall({ ok: false, durationMs: 10, status: 404, category: 'profile' })
    recordBlizzardCall({ ok: false, durationMs: 10, timeout: true, category: 'profile' })
    recordBlizzardCall({ ok: false, durationMs: 10, status: 429, category: 'profile' })

    const report = readDiagnosticBuffers().blizzardApi

    expect(report.byStatus).toContainEqual({ status: 200, calls: 1 })
    expect(report.byStatus).toContainEqual({ status: 404, calls: 1 })
    expect(report.byStatus).toContainEqual({ status: 0, calls: 1 })
    expect(report.byStatus).toContainEqual({ status: 429, calls: 1 })
    expect(report.byStatus.reduce((sum, row) => sum + row.calls, 0)).toBe(report.total)
    // And the kinds of failure are still told apart from the statuses.
    expect(report).toMatchObject({ rateLimited: 1, timeouts: 1, failed: 3, ok: 1 })
  })

  it('counts an expected absence apart from a failure, without turning it into a success', () => {
    // A failed request - a document Blizzard does not have for this character...
    recordBlizzardCall({ ok: false, durationMs: 10, status: 404, category: 'mythic-keystone' })
    // ...that the profile read tolerated: the operation survived, and the panel says so without hiding the 404.
    recordToleratedAbsence()

    const report = readDiagnosticBuffers().blizzardApi

    expect(report.failed).toBe(1)
    expect(report.ok).toBe(0)
    expect(report.toleratedAbsences).toBe(1)
    // What an operator has to act on is the difference, and it is zero here.
    expect(report.failed - report.toleratedAbsences).toBe(0)
  })
})

describe('the timer, counted apart from the passes it starts', () => {
  it('counts every tick, and every tick that found the pass already running', () => {
    recordTimerTick(false)
    recordTimerTick(false)
    recordTimerTick(true)

    const state = readDiagnosticBuffers().sync

    expect(state.timerTicks).toBe(3)
    expect(state.timerSkipped).toBe(1)
    expect(state.lastTickAt).not.toBeNull()
    // A tick is not a pass, and a pass is not a tick: the two counters answer different questions.
    expect(state.passes).toBe(0)
    expect(state.intervalMs).toBe(SYNC_INTERVAL_MS)
  })
})

describe('the characters the retry state is holding back', () => {
  it('is read from the table, so the panel shows what the next pass will see', () => {
    memory.addUser(1)
    const parked = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Missing', level: 80 })
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Fine', level: 70 })

    const until = nowSec() + 3600
    memory.db.prepare('UPDATE characters SET sync_retry_at = ?, sync_error = ? WHERE id = ?').run(until, 'missing', parked)

    const state = buildAdminDiagnostics().sync

    expect(state.parked).toBe(1)
    expect(state.nextRetryAt).toBe(until)
  })

  it('is nobody, and no wait, when every character is healthy', () => {
    memory.addUser(1)
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Fine' })

    const state = buildAdminDiagnostics().sync

    expect(state.parked).toBe(0)
    expect(state.nextRetryAt).toBeNull()
  })
})

describe('the memory the panel reports', () => {
  it('is handed over in bytes, with a peak and a bounded trend', () => {
    const before = process.memoryUsage().rss
    const memory = buildAdminDiagnostics().system.memory

    // The unit is the point: a figure a factor of 1024 out would fail this, which is exactly the mistake the
    // panel must never make (see `test/unit/formatBytes.test.ts` for the other half of that contract).
    expect(memory.rssBytes).toBeGreaterThan(before / 2)
    expect(memory.rssBytes).toBeLessThan(before * 2)
    expect(Number.isInteger(memory.rssBytes)).toBe(true)

    expect(memory.heapUsedBytes).toBeGreaterThan(0)
    expect(memory.heapTotalBytes).toBeGreaterThanOrEqual(memory.heapUsedBytes)
    expect(memory.arrayBuffersBytes).toBeGreaterThanOrEqual(0)
    expect(memory.peakRssBytes).toBeGreaterThanOrEqual(memory.rssBytes)

    // A trend in a fixed number of slots: one reading per diagnostics window, never one per request.
    expect(memory.samples.length).toBeGreaterThanOrEqual(1)
    expect(memory.samples.length).toBeLessThanOrEqual(BLIZZARD_BUCKET_COUNT)
    expect(memory.samples.every((sample) => sample.rssBytes > 0)).toBe(true)
  })

  it('names the process and the isolate it was measured in, so the RSS can be matched to the OS', async () => {
    const system = buildAdminDiagnostics().system

    expect(system.pid).toBe(process.pid)
    expect(system.arch).toBe(process.arch)
    expect(system.platform).toBe(process.platform)
    // vitest runs this file in a worker thread or a child process; either way the answer is a fact about it.
    const { isMainThread } = await import('node:worker_threads')
    expect(system.runtime).toBe(isMainThread ? 'node-server' : 'worker-thread')
    // Nothing private rides along: no path, no command line, no environment.
    expect(JSON.stringify(system)).not.toContain(process.cwd().replace(/\\/g, '\\\\'))
  })

  it('tells a nuxt dev worker apart from the built server', async () => {
    const { runtimeKind } = await import('../../server/utils/adminDiagnostics')
    const { isMainThread } = await import('node:worker_threads')
    const previous = process.env.NITRO_DEV_WORKER_ID
    process.env.NITRO_DEV_WORKER_ID = '1'
    try {
      expect(runtimeKind()).toBe(isMainThread ? 'node-server' : 'nitro-dev-worker')
    } finally {
      if (previous === undefined) delete process.env.NITRO_DEV_WORKER_ID
      else process.env.NITRO_DEV_WORKER_ID = previous
    }
  })

  it('fills one slot per window rather than one per build inside it', () => {
    buildAdminDiagnostics()
    buildAdminDiagnostics()
    buildAdminDiagnostics()

    // The four builds happened inside one five-minute slot, which is one reading.
    expect(buildAdminDiagnostics().system.memory.samples).toHaveLength(1)
  })

  it('files a warning of its own when the process is holding more than the box has', () => {
    const spy = vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: MEMORY_WARN_BYTES + 1,
      heapTotal: 1,
      heapUsed: 1,
      external: 0,
      arrayBuffers: 0
    } as never)

    try {
      buildAdminDiagnostics()
      buildAdminDiagnostics()
    } finally {
      spy.mockRestore()
    }

    const { errors } = readDiagnosticBuffers()

    // One line, with a count: a process that sits above the threshold for an hour says so once, with the number
    // of readings it took - which is the fact an operator needs to correlate with everything else.
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ level: 'warn', message: 'process RSS is above 512 MiB', count: 2 })
  })
})
