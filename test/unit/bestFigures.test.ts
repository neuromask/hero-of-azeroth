/**
 * The merge rule every account figure is read through: `bestFigures`.
 *
 * A WoW collection is shared across a Battle.net account, so the site holds two lower bounds of the
 * account's own figure - a live character's reading, and the account's pool - and the rule is the
 * higher of the two, never the sum (two views of one mount are not two mounts). Reputations are the
 * one exception, and these tests pin both halves of it, because that exception is exactly where a
 * stale number once survived to be printed beside its own corrected copy.
 */
import { describe, expect, it } from 'vitest'
import { bestFigures } from '../../server/utils/accountPool'

/** The smallest an account's totals can be and still be one: the six figures plus the extras. */
function account(overrides: Record<string, number> = {}) {
  return {
    achievements: 0,
    mounts: 0,
    pets: 0,
    toys: 0,
    decor: 0,
    reputations: 0,
    mplus: null,
    score: 0,
    accountWide: [],
    ...overrides
  } as Parameters<typeof bestFigures>[1]
}

describe('bestFigures', () => {
  it('takes the higher of the two figures for a collection, never the sum', () => {
    const merged = bestFigures(
      { achievements: 1000, mounts: 100, pets: 50, toys: 40, decor: 30, reputations: 5 },
      account({ achievements: 2000, mounts: 150, pets: 20, toys: 60, decor: 10 })
    )

    expect(merged.mounts).toBe(150)
    expect(merged.pets).toBe(50)
    expect(merged.toys).toBe(60)
    expect(merged.decor).toBe(30)
    expect(merged.achievements).toBe(2000)
    // Not the sum: 100 + 150 would be two views of one account counted twice.
    expect(merged.mounts).not.toBe(250)
  })

  it('keeps the live reading when the account has nothing to say', () => {
    const merged = bestFigures(
      { achievements: 5, mounts: 7, pets: 8, toys: 9, decor: 10, reputations: 11 },
      account()
    )
    expect(merged).toEqual({ achievements: 5, mounts: 7, pets: 8, toys: 9, decor: 10, reputations: 11 })
  })

  it('lets the account\'s own figure win for reputations even when the reading is larger', () => {
    const merged = bestFigures(
      { achievements: 0, mounts: 0, pets: 0, toys: 0, decor: 0, reputations: 999 },
      account({ reputations: 5 })
    )
    expect(merged.reputations).toBe(5)
  })

  it('keeps the reading\'s reputation figure where the account\'s pool holds none', () => {
    const merged = bestFigures(
      { achievements: 0, mounts: 0, pets: 0, toys: 0, decor: 0, reputations: 42 },
      account({ reputations: 0 })
    )
    expect(merged.reputations).toBe(42)
  })
})
