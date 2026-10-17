/**
 * The automation endpoints, called the way Nitro calls them.
 *
 * What is stubbed is the framework's plumbing and the *pass* (`runSyncPass`); the store, the scheduler and the
 * validation are the real implementations, so a save here really is the save the site would make - and the
 * `getTimerCount()` assertions are what prove that a settings change replaces the timer rather than adding one.
 *
 * The three refusals the panel has to survive are all here: `401`/`403` before anything is read, `400` with the
 * field named for a value the scanner cannot run with, and `429` for a script that presses too often.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

const session = vi.hoisted(() => ({ requireUser: vi.fn() }))
const passes = vi.hoisted(() => ({ runSyncPass: vi.fn(), countDueCharacters: vi.fn() }))

vi.mock('../../server/utils/session', () => ({ requireUser: session.requireUser }))

import { recordDiagnostic, invalidateDiagnosticsCache, readDiagnosticBuffers } from '../../server/utils/adminDiagnostics'
import {
  applyCharacterScan,
  CHARACTER_READ_REQUESTS,
  characterScanState,
  resetCharacterScanScheduler
} from '../../server/utils/characterScanScheduler'
import { requireAdmin, requireAdminAction } from '../../server/utils/requireAdmin'
import { getAutomationSettings, saveAutomationSettings } from '../../server/utils/siteSettings'
import { SCAN_INTERVAL_OPTIONS_MS } from '../../shared/data/automationSettings'
import type { SessionUser } from '../../server/utils/session'

let memory: MemoryDb
let body: unknown = {}
let originHeader: string | undefined
let hostHeader: string | undefined

/**
 * The clock, moved forward for every test rather than reset.
 *
 * Both POST endpoints refuse a repeat within a few seconds, and their "when was the last one" is a module-level
 * moment that outlives a test. A clock that went *backwards* between tests would look exactly like a burst of
 * presses, so it only ever moves forward.
 */
let clock = new Date('2026-10-16T12:00:00Z').getTime()

function account(battletag: string | null): SessionUser {
  return {
    id: 1,
    bnetSub: 'sub',
    battletag,
    mainCharacterId: null,
    hideFromFame: false,
    authExpired: false,
    accessToken: null,
    refreshToken: null,
    expiresAt: null
  }
}

const admin = () => session.requireUser.mockResolvedValue(account('neuromask#2809'))
const stranger = () => session.requireUser.mockResolvedValue(account('stranger#1234'))
const nobody = () => session.requireUser.mockRejectedValue(Object.assign(new Error('x'), { statusCode: 401 }))

const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) =>
  Object.assign(new Error(input?.statusMessage || 'error'), input)
globals.getRequestHeader = (_event: unknown, name: string) =>
  name === 'origin' ? originHeader : name === 'host' ? hostHeader : undefined
globals.readBody = async () => body
globals.setResponseHeader = () => {}
globals.requireAdmin = requireAdmin
globals.requireAdminAction = requireAdminAction
globals.getAutomationSettings = getAutomationSettings
globals.saveAutomationSettings = saveAutomationSettings
globals.applyCharacterScan = applyCharacterScan
globals.characterScanState = characterScanState
globals.CHARACTER_READ_REQUESTS = CHARACTER_READ_REQUESTS
globals.countDueCharacters = passes.countDueCharacters
globals.runSyncPass = passes.runSyncPass
globals.recordDiagnostic = recordDiagnostic
globals.invalidateDiagnosticsCache = invalidateDiagnosticsCache

type Handler = (event: unknown) => Promise<unknown>

const readAutomation = (await import('../../server/api/admin/automation.get')).default as unknown as Handler
const saveAutomation = (await import('../../server/api/admin/automation.post')).default as unknown as Handler
const runAutomation = (await import('../../server/api/admin/automation/run.post')).default as unknown as Handler

async function statusOf(handler: Handler): Promise<number> {
  try {
    await handler({})
    return 200
  } catch (error) {
    return Number((error as { statusCode?: number }).statusCode || 0)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  // Always forward, so a cooldown left by the previous test has expired and the next one starts clean.
  clock += 120_000
  vi.setSystemTime(clock)

  memory = createMemoryDb()
  installUseDb(memory.db)
  resetCharacterScanScheduler()

  body = {}
  originHeader = undefined
  hostHeader = 'heroofazeroth.com'
  session.requireUser.mockReset()
  passes.runSyncPass.mockReset()
  passes.countDueCharacters.mockReset()

  passes.runSyncPass.mockResolvedValue({ checked: 3, updated: 1, skipped: 2, errors: 0 })
  passes.countDueCharacters.mockReturnValue(7)
})

afterEach(() => {
  resetCharacterScanScheduler()
  vi.useRealTimers()
})

describe('reading the automation panel', () => {
  it('answers 401 without a session and 403 for a signed-in stranger', async () => {
    nobody()
    expect(await statusOf(readAutomation)).toBe(401)

    stranger()
    expect(await statusOf(readAutomation)).toBe(403)
  })

  it('answers an administrator with the settings, the scheduler and what a pass would cost', async () => {
    admin()

    const answer = (await readAutomation({})) as {
      settings: { characterScan: { enabled: boolean; intervalMs: number; batchSize: number } }
      scheduler: { armed: boolean; intervalMs: number }
      limits: { intervalsMs: number[]; batchMax: number }
      estimate: { due: number; batchSize: number; potentialRequests: number }
    }

    expect(answer.settings.characterScan).toEqual({ enabled: true, intervalMs: 180_000, batchSize: 10 })
    expect(answer.scheduler.intervalMs).toBe(180_000)
    expect(answer.limits.intervalsMs).toEqual([...SCAN_INTERVAL_OPTIONS_MS])
    expect(answer.limits.batchMax).toBe(10)

    // Seven due, ten allowed per pass: the whole seven, at twelve documents each.
    expect(answer.estimate).toEqual({ due: 7, batchSize: 10, potentialRequests: 7 * 12 })
  })

  it('costs nothing: no pass is started and no Blizzard call is made by reading the panel', async () => {
    admin()
    await readAutomation({})

    expect(passes.runSyncPass).not.toHaveBeenCalled()
    expect(readDiagnosticBuffers().blizzardApi.total).toBe(0)
  })

  it('never claims to know a remaining quota, and never invents a queue', async () => {
    admin()

    const serialised = JSON.stringify(await readAutomation({}))

    // There is no quota figure this site can read, and no queue it could have a length for - so neither word is
    // in the answer at all, rather than being a zero somebody would read as "plenty left".
    expect(serialised).not.toMatch(/quota|remaining|backlog|queue/i)
  })
})

describe('saving the settings', () => {
  it('is refused to a stranger before anything is written', async () => {
    stranger()
    body = { characterScan: { enabled: false, intervalMs: 180_000, batchSize: 4 } }

    expect(await statusOf(saveAutomation)).toBe(403)
    expect(getAutomationSettings().characterScan.enabled).toBe(true)
  })

  it('is refused to a cross-origin press, even from an administrator', async () => {
    admin()
    originHeader = 'https://evil.example'
    body = { characterScan: { enabled: false, intervalMs: 180_000, batchSize: 4 } }

    expect(await statusOf(saveAutomation)).toBe(403)
    expect(getAutomationSettings().characterScan.batchSize).toBe(10)
  })

  it('refuses an interval the site does not run at, and names the field', async () => {
    admin()
    body = { characterScan: { enabled: true, intervalMs: 120_000, batchSize: 4 } }

    await expect(saveAutomation({})).rejects.toMatchObject({
      statusCode: 400,
      data: { errors: ['intervalMs'] }
    })
    // Nothing was stored: a refused save is a refused save.
    expect(getAutomationSettings().characterScan.intervalMs).toBe(180_000)
  })

  it('refuses a batch beyond the pass ceiling and an unknown field', async () => {
    admin()

    body = { characterScan: { enabled: true, intervalMs: 180_000, batchSize: 500 } }
    await expect(saveAutomation({})).rejects.toMatchObject({ statusCode: 400, data: { errors: ['batchSize'] } })

    body = { characterScan: { enabled: true, intervalMs: 180_000, batchSize: 4 }, cron: '* * * * *' }
    await expect(saveAutomation({})).rejects.toMatchObject({ statusCode: 400, data: { errors: ['unknown-field'] } })
  })

  it('stores the settings and re-arms the one timer, with no restart', async () => {
    admin()
    body = { characterScan: { enabled: true, intervalMs: SCAN_INTERVAL_OPTIONS_MS[3], batchSize: 4 } }

    const answer = (await saveAutomation({})) as { scheduler: { armed: boolean; intervalMs: number; batchSize: number } }

    expect(getAutomationSettings().characterScan).toEqual({
      enabled: true,
      intervalMs: SCAN_INTERVAL_OPTIONS_MS[3],
      batchSize: 4
    })
    expect(answer.scheduler).toMatchObject({ armed: true, intervalMs: SCAN_INTERVAL_OPTIONS_MS[3], batchSize: 4 })
    // One timer, not two: the change replaced the cadence rather than adding a second chain.
    expect(vi.getTimerCount()).toBe(1)
    expect(characterScanState().nextRunAt).toBe(Math.floor(Date.now() / 1000) + SCAN_INTERVAL_OPTIONS_MS[3] / 1000)
  })

  it('stops the timer when the scan is paused, and starts none', async () => {
    admin()
    body = { characterScan: { enabled: false, intervalMs: 180_000, batchSize: 4 } }

    await saveAutomation({})

    expect(getAutomationSettings().characterScan.enabled).toBe(false)
    expect(characterScanState()).toMatchObject({ enabled: false, armed: false, nextRunAt: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a second save a moment later', async () => {
    admin()
    body = { characterScan: { enabled: true, intervalMs: 180_000, batchSize: 4 } }
    await saveAutomation({})

    // The same body again, immediately: a script rather than an operator.
    expect(await statusOf(saveAutomation)).toBe(429)

    // A moment later it is allowed again.
    vi.advanceTimersByTime(2_000)
    expect(await saveAutomation({})).toBeTruthy()
  })
})

describe('running one pass by hand', () => {
  it('is refused to a stranger and to a cross-origin press', async () => {
    stranger()
    expect(await statusOf(runAutomation)).toBe(403)
    expect(passes.runSyncPass).not.toHaveBeenCalled()

    admin()
    originHeader = 'https://evil.example'
    expect(await statusOf(runAutomation)).toBe(403)
    expect(passes.runSyncPass).not.toHaveBeenCalled()
  })

  it('runs exactly one batch, at the saved batch size, and answers what it did', async () => {
    admin()
    // The batch the settings carry - not a number the request could have brought.
    saveAutomationSettings({ characterScan: { enabled: true, intervalMs: 180_000, batchSize: 3 } })

    const answer = (await runAutomation({})) as {
      batchSize: number
      counters: { checked: number; updated: number; skipped: number; errors: number }
      due: number
    }

    expect(passes.runSyncPass).toHaveBeenCalledTimes(1)
    expect(passes.runSyncPass).toHaveBeenCalledWith('manual', 3)
    expect(answer).toEqual({
      batchSize: 3,
      counters: { checked: 3, updated: 1, skipped: 2, errors: 0 },
      due: 7
    })
  })

  it('answers 409 while another pass holds the claim, and starts nothing', async () => {
    admin()
    passes.runSyncPass.mockResolvedValue(null)

    expect(await statusOf(runAutomation)).toBe(409)
    // It was asked once and refused by the claim - there is no queue to put it in.
    expect(passes.runSyncPass).toHaveBeenCalledTimes(1)
  })

  it('refuses a second press a moment later', async () => {
    admin()
    await runAutomation({})

    expect(await statusOf(runAutomation)).toBe(429)

    vi.advanceTimersByTime(4_000)
    await expect(runAutomation({})).resolves.toBeTruthy()
  })

  it('does not arm a timer of its own', async () => {
    admin()
    expect(vi.getTimerCount()).toBe(0)

    await runAutomation({})

    // A manual pass is a pass, not a second schedule: the scanner's timer is the scheduler's alone.
    expect(vi.getTimerCount()).toBe(0)
  })
})
