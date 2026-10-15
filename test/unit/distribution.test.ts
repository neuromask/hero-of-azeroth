/**
 * The scale a histogram is cut by.
 *
 * The bars themselves are grouped in SQL (`readSnapshotDistribution` in `./characterReading`), so this is the
 * half of the rule that the chart and the database have to agree on: the ends are the population's own figures,
 * and the highest of them sits inside the last bar rather than off the end of it.
 */
import { describe, expect, it } from 'vitest'
import { binEdges, DISTRIBUTION_BINS } from '../../server/utils/distribution'

describe('binEdges', () => {
  it('cuts the scale into equal buckets from the lowest figure to the highest', () => {
    const bins = binEdges(0, 240)

    expect(bins).toHaveLength(DISTRIBUTION_BINS)
    expect(bins[0]).toEqual({ from: 0, to: 10, count: 0 })
    expect(bins[DISTRIBUTION_BINS - 1]).toEqual({ from: 230, to: 240, count: 0 })
  })

  it('is one bucket for a population that never moved', () => {
    expect(binEdges(7, 7)).toEqual([{ from: 7, to: 7, count: 0 }])
  })
})
