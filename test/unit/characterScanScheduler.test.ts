/**
 * The one timer: that there is one, that it obeys the settings in force, and that stopping it stops the future
 * rather than the work already done.
 *
 * The clock is faked and the pass is stubbed, so what is under test is the *scheduling* - the part that used to be
 * a `setInterval` nobody could reach. The `getTimerCount()` assertions are the point of the file: an interval
 * change that left the old chain running is exactly the bug this module exists to make impossible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'
import { SCAN_INTERVAL_OPTIONS_MS } from '../../shared/data/automationSettings'

const sync = vi.hoisted(() => ({
  runSyncPass: vi.fn(),
  recordTimerTick: vi.fn(),
  recordDiagnostic: vi.fn()
}))

// The scheduler imports these two from the diagnostics module rather than calling globals, so the module is
// mocked - the counters themselves are tested in `adminDiagnostics.test.ts`.
vi.mock('../../server/utils/adminDiagnostics', () => ({
  recordTimerTick: sync.recordTimerTick,
  recordDiagnostic: sync.recordDiagnostic
}))

const THREE = SCAN_INTERVAL_OPTIONS_MS[0]
const TEN = SCAN_INTERVAL_OPTIONS_MS[2]

/** A fresh copy of the scheduler per test, so no timer and no setting leaks between them. */
async function loadScheduler() {
  vi.resetModules()
  return await import('../../server/utils/characterScanScheduler')
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))

  const globals = globalThis as Record<string, unknown>
  globals.runSyncPass = sync.runSyncPass
  globals.recordTimerTick = sync.recordTimerTick
  globals.recordDiagnostic = sync.recordDiagnostic

  sync.runSyncPass.mockReset()
  sync.recordTimerTick.mockReset()
  sync.recordDiagnostic.mockReset()
  sync.runSyncPass.mockResolvedValue({ checked: 5, updated: 1, skipped: 4, errors: 0 })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the scanner timer', () => {
  it('is armed once, at the interval in force, and says when it will run', async () => {
    const { applyCharacterScan } = await loadScheduler()

    const state = applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })

    expect(state).toMatchObject({ enabled: true, armed: true, intervalMs: THREE, batchSize: 5 })
    expect(state.nextRunAt).toBe(Math.floor(Date.now() / 1000) + THREE / 1000)
    // Exactly one pending timeout: a second one would be a second chain of passes.
    expect(vi.getTimerCount()).toBe(1)
  })

  it('runs one pass per interval, at the batch it was given', async () => {
    const { applyCharacterScan } = await loadScheduler()
    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 4 })

    await vi.advanceTimersByTimeAsync(THREE)

    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)
    expect(sync.runSyncPass).toHaveBeenCalledWith('timer', 4)
    expect(sync.recordTimerTick).toHaveBeenLastCalledWith(false)

    await vi.advanceTimersByTimeAsync(THREE)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(2)
    // And still one timer: the tick re-arms rather than stacking.
    expect(vi.getTimerCount()).toBe(1)
  })

  it('replaces the interval rather than adding one', async () => {
    const { applyCharacterScan } = await loadScheduler()

    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })
    await vi.advanceTimersByTimeAsync(THREE)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)

    // A slower cadence, applied while the site is running.
    const state = applyCharacterScan({ enabled: true, intervalMs: TEN, batchSize: 5 })
    expect(state.nextRunAt).toBe(Math.floor(Date.now() / 1000) + TEN / 1000)
    expect(vi.getTimerCount()).toBe(1)

    // Three minutes later - the old cadence - nothing has fired: the old timer is gone, not merely ignored.
    await vi.advanceTimersByTimeAsync(THREE)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)

    // Seven minutes more: the new one.
    await vi.advanceTimersByTimeAsync(TEN - THREE)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('arms nothing, and fires nothing, while it is disabled', async () => {
    const { applyCharacterScan, characterScanState } = await loadScheduler()

    const state = applyCharacterScan({ enabled: false, intervalMs: THREE, batchSize: 5 })

    expect(state).toMatchObject({ enabled: false, armed: false, nextRunAt: null })
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(THREE * 5)
    expect(sync.runSyncPass).not.toHaveBeenCalled()
    // Paused is not "no settings": the card still shows what it would run with.
    expect(characterScanState()).toMatchObject({ enabled: false, intervalMs: THREE, batchSize: 5 })
  })

  it('stops the future without cancelling the pass already running', async () => {
    const { applyCharacterScan } = await loadScheduler()

    // A pass that is still reading when the scanner is switched off.
    let finish: (counters: unknown) => void = () => {}
    sync.runSyncPass.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )

    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })
    // Fire one tick, so the pass is genuinely in flight.
    await vi.advanceTimersByTimeAsync(THREE)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)

    const paused = applyCharacterScan({ enabled: false, intervalMs: THREE, batchSize: 5 })
    expect(paused.armed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    // The pass that was already reading finishes, and its outcome is still counted.
    finish({ checked: 5, updated: 2, skipped: 3, errors: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.recordTimerTick).toHaveBeenLastCalledWith(false)

    // And nothing new starts, however long the clock runs.
    await vi.advanceTimersByTimeAsync(THREE * 10)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)
  })

  it('counts a tick that found a pass already running as a skipped tick', async () => {
    const { applyCharacterScan } = await loadScheduler()

    // `null` is what the pass answers when the claim is already held - the timer's own mark that this tick did
    // nothing.
    sync.runSyncPass.mockResolvedValue(null)

    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })
    await vi.advanceTimersByTimeAsync(THREE)

    expect(sync.recordTimerTick).toHaveBeenLastCalledWith(true)
  })

  it('files a pass that could not be started, and keeps the timer running', async () => {
    const { applyCharacterScan } = await loadScheduler()
    sync.runSyncPass.mockRejectedValue(new Error('the pass blew up'))

    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })
    await vi.advanceTimersByTimeAsync(THREE * 2)

    // A rejection nobody handles would kill the process; this one is filed, and the next tick still fires.
    expect(sync.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', category: 'sync' }))
    expect(sync.runSyncPass).toHaveBeenCalledTimes(2)
  })

  it('counts every tick it took, once per interval', async () => {
    const { applyCharacterScan } = await loadScheduler()
    applyCharacterScan({ enabled: true, intervalMs: THREE, batchSize: 5 })

    await vi.advanceTimersByTimeAsync(THREE * 3)

    expect(sync.runSyncPass).toHaveBeenCalledTimes(3)
    expect(sync.recordTimerTick).toHaveBeenCalledTimes(3)
  })
})

describe('a restart', () => {
  it('starts from the settings the store holds, not from the defaults', async () => {
    const memory = createMemoryDb()
    installUseDb(memory.db)

    const { saveAutomationSettings } = await import('../../server/utils/siteSettings')
    saveAutomationSettings({ characterScan: { enabled: false, intervalMs: TEN, batchSize: 2 } })

    // A new process: the module is loaded again; the settings are the store's.
    const { startCharacterScan, characterScanState } = await loadScheduler()
    const state = startCharacterScan()

    expect(state).toMatchObject({ enabled: false, armed: false, intervalMs: TEN, batchSize: 2 })
    expect(vi.getTimerCount()).toBe(0)
    expect(characterScanState().enabled).toBe(false)
  })
})
