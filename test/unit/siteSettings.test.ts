/**
 * The settings an administrator edits, and the one question the panel turns on: who may write them.
 *
 * Two rules are pinned here and they are the reason this store exists rather than a constant. The first is that
 * a maximum is *optional*: a metric the operator has cleared must come back as a metric without one, because a
 * bar measured against an invented end is a lie (see the note in `shared/data/siteSettings`) - and a metric that
 * was never touched must keep the value the site ships with. The second is that the defaults are the *floor* of
 * the admin list, so a host that configures nobody cannot lock the panel's owner out of it.
 *
 * Everything runs against the in-memory database (`test/helpers/memoryDb.ts`) through the store's own queries,
 * so the merge of defaults and stored rows is exercised where the site runs it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'
import {
  adminBattletags,
  getMetricMaxima,
  getSiteSettings,
  isAdmin,
  saveSiteSettings
} from '../../server/utils/siteSettings'
import { METRIC_MAXIMA_DEFAULTS } from '../../shared/data/siteSettings'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
  delete process.env.NUXT_ADMIN_BATTLETAGS
})

afterEach(() => {
  delete process.env.NUXT_ADMIN_BATTLETAGS
})

describe('the maxima', () => {
  it('answers the values the site ships with when nothing has been stored', () => {
    expect(getMetricMaxima()).toEqual(METRIC_MAXIMA_DEFAULTS)
    expect(getSiteSettings().content).toEqual({})
  })

  it('serves a stored maximum over the shipped one and leaves the untouched metrics alone', () => {
    saveSiteSettings({ metricMaxima: { transmogs: 61_000 } })

    const maxima = getMetricMaxima()
    expect(maxima.transmogs).toBe(61_000)
    // The patch named one metric inside the namespace, so the other two keep the site's own defaults rather than
    // gaining a value from the request - which is what makes a partial save harmless.
    expect(maxima.quests).toBe(METRIC_MAXIMA_DEFAULTS.quests)
    expect(maxima.recipes).toBe(METRIC_MAXIMA_DEFAULTS.recipes)
  })

  it('takes a maximum away when a field is cleared, rather than falling back to the default', () => {
    saveSiteSettings({ metricMaxima: { recipes: null } })

    const maxima = getMetricMaxima()
    // Absent, not zero and not the shipped value: the board draws no bar for a figure whose end nobody states.
    expect('recipes' in maxima).toBe(false)
    expect(maxima.transmogs).toBe(METRIC_MAXIMA_DEFAULTS.transmogs)
  })

  it('drops a metric the panel does not own, and a value that is not a positive number', () => {
    saveSiteSettings({
      metricMaxima: { mounts: 1_000, transmogs: -5, quests: 0, nonsense: 10 } as Record<string, number | null>
    })

    const maxima = getMetricMaxima()
    // A mount's total travels with its own reading (`server/utils/blizzard`) and is never stated by hand, so the
    // row is not the panel's to write - and the rest are not numbers the board could measure anything against.
    expect('mounts' in maxima).toBe(false)
    expect('nonsense' in maxima).toBe(false)
    expect(maxima.transmogs).toBe(METRIC_MAXIMA_DEFAULTS.transmogs)
    expect(maxima.quests).toBe(METRIC_MAXIMA_DEFAULTS.quests)
  })

  it('rounds a figure that arrives with a fraction', () => {
    saveSiteSettings({ metricMaxima: { quests: 27_500.6 } })
    expect(getMetricMaxima().quests).toBe(27_501)
  })
})

describe('the paper copy', () => {
  it('stores a key per page and reads it back in one answer', () => {
    saveSiteSettings({ content: { 'about.intro': 'Hello', 'legal.body': 'Terms' } })

    expect(getSiteSettings().content).toEqual({ 'about.intro': 'Hello', 'legal.body': 'Terms' })
  })

  it('leaves the copy alone when a patch names only the maxima', () => {
    saveSiteSettings({ content: { 'about.intro': 'Hello' } })
    saveSiteSettings({ metricMaxima: { recipes: 12_000 } })

    expect(getSiteSettings().content).toEqual({ 'about.intro': 'Hello' })
  })

  it('drops a key that is not a slug, so a stored row can never be a header or a query', () => {
    saveSiteSettings({ content: { 'about.intro': 'kept', '<script>': 'dropped', 'a b': 'dropped' } })

    expect(Object.keys(getSiteSettings().content)).toEqual(['about.intro'])
  })
})

describe('who may open the panel', () => {
  it('names the account the site ships with, without regard to the case it is spelled in', () => {
    expect(adminBattletags()).toContain('neuromask#2809')
    expect(isAdmin('neuromask#2809')).toBe(true)
    expect(isAdmin('NEUROMASK#2809')).toBe(true)
    expect(isAdmin('stranger#1234')).toBe(false)
    expect(isAdmin(null)).toBe(false)
    expect(isAdmin(undefined)).toBe(false)
  })

  it('adds to that list from the environment rather than replacing it', () => {
    process.env.NUXT_ADMIN_BATTLETAGS = 'someone#1111, another#2222'

    expect(isAdmin('someone#1111')).toBe(true)
    expect(isAdmin('another#2222')).toBe(true)
    // The environment names an addition, so the account the site ships with cannot be configured away.
    expect(isAdmin('neuromask#2809')).toBe(true)
  })
})
