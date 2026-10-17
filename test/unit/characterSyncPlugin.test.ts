/**
 * The wiring that starts the scanner, and what happens when it cannot be started.
 *
 * The timer itself is the scheduler's (`characterScanScheduler.test.ts`); this is the one thing a Nitro plugin
 * body can do - read the stored settings and hand them to the scheduler as the process comes up. A failure here
 * is a site that serves pages but does not scan, so it is *filed* rather than thrown: a plugin that throws during
 * startup is a site that does not start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boot = vi.hoisted(() => ({ startCharacterScan: vi.fn(), recordDiagnostic: vi.fn() }))

/** A fresh copy of the plugin, whose body runs as it is imported (that is what `defineNitroPlugin` is). */
async function loadPlugin(): Promise<void> {
  vi.resetModules()

  const globals = globalThis as Record<string, unknown>
  globals.defineNitroPlugin = (body: () => void) => body()
  globals.startCharacterScan = boot.startCharacterScan
  globals.recordDiagnostic = boot.recordDiagnostic

  await import('../../server/plugins/characterSync')
}

beforeEach(() => {
  boot.startCharacterScan.mockReset()
  boot.recordDiagnostic.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('starting the scanner', () => {
  it('hands the stored settings to the scheduler, once', async () => {
    await loadPlugin()

    expect(boot.startCharacterScan).toHaveBeenCalledTimes(1)
    expect(boot.recordDiagnostic).not.toHaveBeenCalled()
  })

  it('files a failed start instead of taking the process down with it', async () => {
    boot.startCharacterScan.mockImplementation(() => {
      throw new Error('the settings table is unreadable')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The plugin body must not throw: a site that cannot start its scanner still has to serve its pages.
    await expect(loadPlugin()).resolves.toBeUndefined()

    expect(boot.recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', category: 'sync', message: 'character scanner did not start' })
    )
    // And the host's own log says so too, without anything of the settings in it.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('the character scanner did not start'))
  })
})
