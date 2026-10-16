/**
 * The background timer: that it is one timer, that it starts one pass per tick, and that it counts its ticks.
 *
 * The incident this file is written for showed three finished passes under an uptime of forty-three minutes - and
 * a count of passes alone cannot say whether the timer never fired, or fired and was refused because a pass was
 * still running. Those are different faults with different fixes, so the tick is counted beside the pass.
 *
 * The plugin is loaded for real (through `defineNitroPlugin`) with the clock faked and everything it calls
 * stubbed, so what is under test is the wiring itself rather than a description of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNC_BATCH, SYNC_INTERVAL_MS } from '../../shared/data/adminDiagnostics'

const sync = vi.hoisted(() => ({ runSyncPass: vi.fn(), recordTimerTick: vi.fn(), recordDiagnostic: vi.fn() }))

/** A fresh copy of the plugin, whose body installs the timer as it is imported. */
async function loadPlugin(): Promise<void> {
  vi.resetModules()

  const globals = globalThis as Record<string, unknown>
  globals.defineNitroPlugin = (body: () => void) => body()
  globals.runSyncPass = sync.runSyncPass
  globals.recordTimerTick = sync.recordTimerTick
  globals.recordDiagnostic = sync.recordDiagnostic

  await import('../../server/plugins/characterSync')
}

beforeEach(() => {
  vi.useFakeTimers()
  sync.runSyncPass.mockReset()
  sync.recordTimerTick.mockReset()
  sync.recordDiagnostic.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the timer the site runs on', () => {
  it('starts one pass per tick, and counts every tick it took', async () => {
    sync.runSyncPass.mockResolvedValue({ checked: 5, updated: 0, skipped: 0, errors: 5 })
    await loadPlugin()

    // Nothing happens on its own: the first pass is one interval away.
    expect(sync.runSyncPass).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS)
    expect(sync.runSyncPass).toHaveBeenCalledTimes(1)
    expect(sync.runSyncPass).toHaveBeenCalledWith('timer', SYNC_BATCH)
    // A pass that ran is not a skipped tick.
    expect(sync.recordTimerTick).toHaveBeenLastCalledWith(false)
  })

  it('is exactly one timer: three intervals are three passes, not six', async () => {
    sync.runSyncPass.mockResolvedValue({ checked: 0, updated: 0, skipped: 0, errors: 0 })
    await loadPlugin()

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 3)

    // A second registration of the same plugin would double every one of these - which is one of the ways a
    // pass counter can disagree with the interval it is read against.
    expect(sync.runSyncPass).toHaveBeenCalledTimes(3)
    expect(sync.recordTimerTick).toHaveBeenCalledTimes(3)
  })

  it('counts a tick that found a pass already running as a skipped tick, not as a pass', async () => {
    // `runSyncPass` answers `null` when it is refused the claim - the timer's own mark that this tick did nothing.
    sync.runSyncPass.mockResolvedValue(null)
    await loadPlugin()

    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS)

    expect(sync.recordTimerTick).toHaveBeenLastCalledWith(true)
  })

  it('files a pass that could not even start, and leaves the timer running', async () => {
    sync.runSyncPass.mockRejectedValue(new Error('the pass blew up'))
    await loadPlugin()

    // A rejection nobody handles would kill the process (Node 15 and later), and this is the one promise in the
    // site that nothing awaits - so it is filed, and the next tick still fires.
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2)

    expect(sync.runSyncPass).toHaveBeenCalledTimes(2)
    expect(sync.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', category: 'sync' })
    )
    // No tick was counted as a pass, because no pass ran.
    expect(sync.recordTimerTick).not.toHaveBeenCalledWith(false)
  })
})
