/**
 * The automation settings: what may be saved, what an old installation gets, and that a save outlives the process.
 *
 * Two things are pinned here and they are the reason the model exists. The first is that a cadence is *refused*
 * rather than rounded - an interval the scanner was not built for spends the site's Blizzard quota quietly for
 * ever - and the second is that a copy of the site that has never stored this setting runs exactly as it did
 * before the setting existed, because the defaults are the floor of the store (`#shared/data/automationSettings`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import {
  AUTOMATION_DEFAULTS,
  SCAN_BATCH_MAX,
  SCAN_INTERVAL_OPTIONS_MS,
  normaliseAutomationSettings,
  validateAutomationPatch
} from '../../shared/data/automationSettings'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

const good = () => ({ characterScan: { enabled: true, intervalMs: SCAN_INTERVAL_OPTIONS_MS[1], batchSize: 4 } })

describe('what the form may save', () => {
  it('accepts a body that names the values the scanner can actually run with', () => {
    expect(validateAutomationPatch(good())).toEqual({ ok: true, value: good() })
  })

  it('refuses an interval the site does not offer, rather than rounding it', () => {
    for (const intervalMs of [0, 60_000, 120_000, 3_600_001, -180_000, Number.NaN]) {
      const result = validateAutomationPatch({ characterScan: { enabled: true, intervalMs, batchSize: 4 } })
      expect(result, String(intervalMs)).toEqual({ ok: false, errors: ['intervalMs'] })
    }
  })

  it('refuses a batch the pass was not built for', () => {
    for (const batchSize of [0, -1, 1.5, SCAN_BATCH_MAX + 1]) {
      const result = validateAutomationPatch({ characterScan: { enabled: true, intervalMs: 180_000, batchSize } })
      expect(result, String(batchSize)).toEqual({ ok: false, errors: ['batchSize'] })
    }
  })

  it('refuses a body that is not the shape of the setting at all', () => {
    expect(validateAutomationPatch(null)).toEqual({ ok: false, errors: ['body'] })
    expect(validateAutomationPatch([])).toEqual({ ok: false, errors: ['body'] })
    expect(validateAutomationPatch('enabled')).toEqual({ ok: false, errors: ['body'] })
    expect(validateAutomationPatch({})).toEqual({ ok: false, errors: ['characterScan'] })
    expect(validateAutomationPatch({ characterScan: { enabled: 'yes', intervalMs: 180_000, batchSize: 4 } })).toEqual({
      ok: false,
      errors: ['enabled']
    })
  })

  it('refuses a field the panel does not draw, rather than storing it', () => {
    expect(validateAutomationPatch({ ...good(), extra: 1 })).toEqual({ ok: false, errors: ['unknown-field'] })
    expect(
      validateAutomationPatch({ characterScan: { ...good().characterScan, cron: '* * * * *' } })
    ).toEqual({ ok: false, errors: ['unknown-field'] })
  })
})

describe('what a stored row is read as', () => {
  it('is the shipped defaults when nothing was ever stored', () => {
    expect(normaliseAutomationSettings(null)).toEqual(AUTOMATION_DEFAULTS)
  })

  it('falls back field by field, so a hand-edited row cannot leave the site unscanned', () => {
    expect(normaliseAutomationSettings({ characterScan: { enabled: false, intervalMs: 'soon', batchSize: 900 } })).toEqual({
      characterScan: { enabled: false, intervalMs: AUTOMATION_DEFAULTS.characterScan.intervalMs, batchSize: SCAN_BATCH_MAX }
    })
  })
})

describe('the store', () => {
  /** A fresh copy of the store, which is what a restart looks like to a module. */
  async function loadStore() {
    vi.resetModules()
    return await import('../../server/utils/siteSettings')
  }

  it('answers the defaults on an installation that has never stored the setting', async () => {
    const store = await loadStore()

    expect(store.getAutomationSettings()).toEqual(AUTOMATION_DEFAULTS)
    // Nothing was written to make that true: the row is simply absent.
    expect(memory.db.prepare('SELECT COUNT(*) AS count FROM settings').get()).toEqual({ count: 0 })
  })

  it('keeps a saved setting across a restart', async () => {
    const before = await loadStore()
    const saved = before.saveAutomationSettings({
      characterScan: { enabled: false, intervalMs: SCAN_INTERVAL_OPTIONS_MS[4], batchSize: 3 }
    })

    expect(saved).toEqual({ characterScan: { enabled: false, intervalMs: SCAN_INTERVAL_OPTIONS_MS[4], batchSize: 3 } })

    // A new process: the module is loaded again, the database is the same file.
    const after = await loadStore()
    expect(after.getAutomationSettings()).toEqual({
      characterScan: { enabled: false, intervalMs: SCAN_INTERVAL_OPTIONS_MS[4], batchSize: 3 }
    })
  })

  it('is not part of the public settings answer', async () => {
    const store = await loadStore()
    store.saveAutomationSettings({ characterScan: { enabled: true, intervalMs: 180_000, batchSize: 2 } })

    // `/api/settings` is public because the comparison board is drawn from it; how often the site scans its
    // roster is not a stranger's business, and is not in that answer.
    expect(Object.keys(store.getSiteSettings())).toEqual(['metricMaxima', 'content'])
  })
})
