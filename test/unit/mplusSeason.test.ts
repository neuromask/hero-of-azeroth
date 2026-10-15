/**
 * The season a stored Mythic+ rating is counted in (`server/utils/mplus`).
 *
 * Blizzard zeroes a character's rating when a season ends, and the site keeps every reading it took - so the rule
 * saying which of them count is the one thing that keeps a table from printing a score nobody has any more. The
 * season the site records is `0` until one is set (no season recorded means every reading counts), so these tests
 * hold the rule to a season they name themselves.
 */
import { describe, expect, it } from 'vitest'
import { isCurrentSeason, seasonRating, seasonRatingSql } from '../../server/utils/mplus'

/** A season's own start, and two moments on either side of it. */
const SEASON = 1_700_000_000
const BEFORE = SEASON - 86_400
const AFTER = SEASON + 86_400

describe('a stored Mythic+ rating, read in a season', () => {
  it('counts a rating read in the season, and zeroes one read before it', () => {
    expect(seasonRating(3000, AFTER, SEASON)).toBe(3000)
    expect(seasonRating(3000, BEFORE, SEASON)).toBe(0)
  })

  it('leaves a rating nobody has read alone, and counts everything when no season is recorded', () => {
    // "Not read" and "nothing yet this season" are different answers, and a site that has only ever known one
    // season wants its readings counted as they stand.
    expect(seasonRating(null, BEFORE, SEASON)).toBeNull()
    expect(seasonRating(3000, BEFORE, 0)).toBe(3000)
    expect(isCurrentSeason(BEFORE, 0)).toBe(true)
    expect(isCurrentSeason(null, SEASON)).toBe(false)
  })

  it('writes the same rule as SQL, and writes nothing at all when no season is recorded', () => {
    expect(seasonRatingSql('mplus_score', 'taken_at', 0)).toBe('mplus_score')

    const clause = seasonRatingSql('mplus_score', 'taken_at', SEASON)
    expect(clause).toContain('mplus_score IS NULL')
    expect(clause).toContain(`>= ${SEASON}`)
    expect(clause).toContain('ELSE 0 END')
  })
})
