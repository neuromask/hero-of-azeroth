/**
 * The region a query names, in the two ways the site asks for one.
 *
 * A region is either a *place* or a *filter*, and the site refuses the first while forgiving the second, so the two
 * reads have to be pinned apart: an address standing for a region (`/leaderboards/mounts/eu`) is served or refused,
 * because a page the site has no data behind is a page nobody should be handed; a filter (`?region=eu` on the front
 * door's table) is a choice among the chips a reader can see, and a value that is no longer among them leaves the
 * table whole rather than emptying it or breaking the request.
 *
 * Both spellings are read by both: the page's own `region-eu` and the endpoint's bare `eu`, so an address copied out
 * of the browser can be handed to an endpoint unchanged - which is the rule `SUPPORTED_REGIONS` and `isRegion` exist
 * for (`server/utils/params.ts`).
 */
import { describe, expect, it } from 'vitest'
import { SUPPORTED_REGIONS, isRegion, parseRegionFilter } from '../../server/utils/params'

describe('the region a filter names', () => {
  it('reads both spellings of a region the site serves', () => {
    expect(parseRegionFilter('eu')).toBe('eu')
    expect(parseRegionFilter('region-eu')).toBe('eu')
    expect(parseRegionFilter('US')).toBe('us')
    expect(parseRegionFilter('region-us')).toBe('us')
  })

  it('leaves the table whole for a region the site does not serve, and for no region at all', () => {
    // The one that matters: a chip the filter bar no longer offers, or a hand-edited address, must not break the
    // table - and must not be read as a region either.
    for (const value of ['tw', 'region-tw', 'europe', '', null, undefined]) {
      expect(parseRegionFilter(value)).toBeUndefined()
    }
  })

  it('agrees with the list of regions the site serves', () => {
    for (const region of SUPPORTED_REGIONS) {
      expect(parseRegionFilter(region)).toBe(region)
      expect(isRegion(region)).toBe(true)
    }
  })
})
