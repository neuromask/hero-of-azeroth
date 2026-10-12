/**
 * The overall rating: the one formula, and the contract that keeps it in step with its weights.
 *
 * A rating is the number the hall of fame ranks by and every page prints, so it is the figure the
 * site can least afford to have two of. These tests pin the arithmetic, the handling of a figure
 * that is missing or nonsensical (a record backfilled from a thinner source must score low rather
 * than break), and the one structural promise the module makes: the six figures the formula sums are
 * exactly the six the weights table names.
 */
import { describe, expect, it } from 'vitest'
import { calculatePlayerScore, scoreFigures, totalCollectables } from '../../server/utils/playerScore'
import { SCORE_WEIGHTS } from '../../shared/utils/leaderboardScore'

const SIX = { achievements: 1, mounts: 1, toys: 1, decor: 1, pets: 1, reputations: 1 }

describe('calculatePlayerScore', () => {
  it('weighs each figure by its multiplier and adds them up', () => {
    expect(calculatePlayerScore({ achievements: 1000, mounts: 10, toys: 4, decor: 20, pets: 6, reputations: 2 })).toBe(
      1000 * 1 + 10 * 25 + 4 * 15 + 20 * 5 + 6 * 5 + 2 * 50
    )
  })

  it('counts a missing or nonsensical figure as nought rather than poisoning the sum', () => {
    expect(
      calculatePlayerScore({
        achievements: Number.NaN,
        mounts: -5,
        toys: 0,
        decor: Number.POSITIVE_INFINITY,
        pets: null as unknown as number,
        reputations: undefined as unknown as number
      })
    ).toBe(0)
  })

  it('returns a whole number', () => {
    expect(calculatePlayerScore({ ...SIX, achievements: 0, mounts: 3, toys: 0, decor: 0, pets: 0, reputations: 0 })).toBe(75)
  })
})

describe('the weights and the formula agree', () => {
  it('names exactly the six figures the formula sums', () => {
    expect(Object.keys(SCORE_WEIGHTS).sort()).toEqual(Object.keys(SIX).sort())
  })

  it('totals the multipliers for a character holding one of each', () => {
    expect(calculatePlayerScore(SIX)).toBe(Object.values(SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0))
  })
})

describe('scoreFigures', () => {
  it('reads the six counts off a profile stats shape', () => {
    const stats = {
      achievements: { count: 7 },
      mounts: { count: 1 },
      pets: { count: 2 },
      toys: { count: 3 },
      decor: { count: 4 },
      reputations: { count: 5 }
    }
    expect(scoreFigures(stats)).toEqual({ achievements: 7, mounts: 1, pets: 2, toys: 3, decor: 4, reputations: 5 })
  })
})

describe('totalCollectables', () => {
  it('adds the four collected kinds and leaves reputations out', () => {
    expect(totalCollectables({ mounts: 1, pets: 2, toys: 3, decor: 4 })).toBe(10)
  })

  it('treats a missing figure as nought', () => {
    expect(totalCollectables({ mounts: null as unknown as number, pets: undefined as unknown as number, toys: 3, decor: 4 })).toBe(7)
  })
})
