/**
 * The address of a metric leaderboard, and the place a link asks it to open at.
 *
 * There is no browser in this suite, so what is pinned here is the part of the pages that is not a browser: the
 * three addresses a scope has, the slug whitelist a route refuses an unknown figure with (a 404), and the
 * arithmetic that turns `?rank=46` into the page that holds the forty-sixth member. Those are the pieces a page
 * and a link have to agree on - a link that named a place in one scope, and a page that opened somewhere else,
 * would be a broken navigation that no amount of rendering would fix.
 *
 * The component-level half - a row is highlighted, the table scrolls to it, the row markup does not break on a
 * phone - is covered where it can be: the reveal itself is `useMetricLeaderboardView`'s own `highlighted`/`stale`,
 * and the scrolling is one `scrollIntoView` in an `onMounted`. The suite has no DOM environment and no
 * `@nuxt/test-utils` (`vitest.config.ts`), so a component test would be a second test runner rather than a test;
 * the rendering is checked by running the site, and the rules it is rendered from are checked here.
 */
import { describe, expect, it } from 'vitest'
import {
  METRIC_LEADERBOARD_PAGE_PARAM,
  METRIC_LEADERBOARD_RANK_PARAM,
  metricLeaderboardPageForRank,
  metricLeaderboardPageFromQuery,
  metricLeaderboardPageQuery,
  metricLeaderboardPath,
  metricLeaderboardRankFromQuery,
  metricLeaderboardRankQuery
} from '../../app/composables/metricLeaderboard'
import { LEADERBOARD_PER_PAGE } from '../../shared/data/leaderboardSchema'
import { METRIC_LEADERBOARDS, metricLeaderboardOf } from '#shared/data/leaderboardSchema'

describe('the address of a metric leaderboard', () => {
  it('gives every one of the thirteen figures a world, a region and a realm address', () => {
    for (const entry of METRIC_LEADERBOARDS) {
      expect(metricLeaderboardPath(entry.slug)).toBe(`/leaderboards/${entry.slug}`)
      expect(metricLeaderboardPath(entry.slug, { region: 'eu' })).toBe(`/leaderboards/${entry.slug}/eu`)
      expect(metricLeaderboardPath(entry.slug, { region: 'eu', realm: 'gordunni' })).toBe(
        `/leaderboards/${entry.slug}/eu/gordunni`
      )
    }

    // The two figures with a hyphen in their slug keep it in the address, and the region segment is never spelled
    // `region-eu` here: these are the site's own rankings rather than character pages.
    expect(metricLeaderboardPath('honorable-kills', { region: 'us' })).toBe('/leaderboards/honorable-kills/us')
    expect(metricLeaderboardPath('honor-level', { region: 'eu', realm: 'gordunni' })).toBe(
      '/leaderboards/honor-level/eu/gordunni'
    )
  })

  it('never spells a realm without the region that identifies it', () => {
    // A realm slug alone names no realm, because the same slug exists in more than one region - so a scope that
    // carries one without the other is drawn as the world it really is (`MetricLeaderboardScope`).
    expect(metricLeaderboardPath('mounts', { realm: 'gordunni' })).toBe('/leaderboards/mounts')
    expect(metricLeaderboardPath('mounts', { region: '  EU ', realm: ' Gordunni ' })).toBe(
      '/leaderboards/mounts/eu/gordunni'
    )
  })

  it('refuses a figure this build does not serve, which is what turns an address into a 404', () => {
    for (const entry of METRIC_LEADERBOARDS) expect(metricLeaderboardOf(entry.slug)).not.toBeNull()

    // The two figures the site ranks nowhere of their own: the item level (which no page draws a history of) and
    // the Mythic+ rating (which belongs to the front door's table). Plus a slug that is not a slug at all.
    expect(metricLeaderboardOf('mplus')).toBeNull()
    expect(metricLeaderboardOf('item-level')).toBeNull()
    expect(metricLeaderboardOf('Mounts')).toBeNull()
    expect(metricLeaderboardOf('')).toBeNull()
    expect(metricLeaderboardOf(undefined)).toBeNull()
    expect(metricLeaderboardOf(42)).toBeNull()
  })
})

describe('the place a link asks a ranking to open at', () => {
  it('reads a place only out of a positive whole number', () => {
    expect(metricLeaderboardRankFromQuery('46')).toBe(46)
    expect(metricLeaderboardRankFromQuery(['46', '99'])).toBe(46)
    expect(metricLeaderboardRankFromQuery(46)).toBe(46)

    // Everything a reader may have typed, or a link may have carried: none of it is a place, and all of it opens
    // the ranking at the top rather than at a row nobody named.
    for (const value of ['0', '-1', '1.5', 'abc', '', '  ', '1 200', '12,002', '1e3', undefined, null, {}, []]) {
      expect(metricLeaderboardRankFromQuery(value)).toBeNull()
    }
  })

  it('turns a place into the page that holds it, in both directions', () => {
    expect(metricLeaderboardPageForRank(1)).toBe(1)
    expect(metricLeaderboardPageForRank(LEADERBOARD_PER_PAGE)).toBe(1)
    expect(metricLeaderboardPageForRank(LEADERBOARD_PER_PAGE + 1)).toBe(2)
    expect(metricLeaderboardPageForRank(46)).toBe(2)
    expect(metricLeaderboardPageForRank(1_200_002)).toBe(Math.ceil(1_200_002 / LEADERBOARD_PER_PAGE))

    // The property the two share: the page a place is turned into is the page whose range holds that place, which
    // is what makes the highlighted row the row the link named.
    for (const rank of [1, 24, 25, 26, 46, 100, 9_999]) {
      const page = metricLeaderboardPageForRank(rank)
      const first = (page - 1) * LEADERBOARD_PER_PAGE + 1
      const last = page * LEADERBOARD_PER_PAGE

      expect(rank).toBeGreaterThanOrEqual(first)
      expect(rank).toBeLessThanOrEqual(last)
    }
  })

  it('reads a page number out of an address, and answers the top of the ranking for anything else', () => {
    expect(metricLeaderboardPageFromQuery('3')).toBe(3)
    expect(metricLeaderboardPageFromQuery(['3'])).toBe(3)

    for (const value of ['0', '-2', 'x', '', undefined, null, '2.5']) {
      expect(metricLeaderboardPageFromQuery(value)).toBe(1)
    }
  })

  it('writes the two parameters as the address of one state rather than of two', () => {
    // A link names a place, and the page follows from it - which is what keeps a link from having to know how many
    // rows a page holds.
    expect(metricLeaderboardRankQuery(46)).toEqual({ [METRIC_LEADERBOARD_RANK_PARAM]: '46' })
    expect(metricLeaderboardRankQuery(46.7)).toEqual({ [METRIC_LEADERBOARD_RANK_PARAM]: '46' })
    expect(metricLeaderboardRankQuery(-3)).toEqual({ [METRIC_LEADERBOARD_RANK_PARAM]: '1' })

    // The first page says nothing at all, so an address nobody has paged through is the ranking's own address
    // rather than an address with `?page=1` on the end of it.
    expect(metricLeaderboardPageQuery(1)).toEqual({})
    expect(metricLeaderboardPageQuery(3)).toEqual({ [METRIC_LEADERBOARD_PAGE_PARAM]: '3' })

    // And the parameter the place travels in is a plain whole number, while the label a page prints is grouped: the
    // two are written from one number and read by two different readers (`MetricRankLinks.vue`).
    expect(metricLeaderboardRankQuery(12_002)).toEqual({ rank: '12002' })
  })
})
