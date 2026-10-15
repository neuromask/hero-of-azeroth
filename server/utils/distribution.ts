/**
 * How a distribution is cut into buckets.
 *
 * One population draws every chart now - the site's own readings (`./characterReading`) - and its histogram is
 * grouped in SQL, so what this module really holds is the *scale*: the number of buckets a histogram has, and
 * the empty buckets of one, which the SQL's own arithmetic has to agree with (`readSnapshotDistribution` casts
 * a figure into the same index).
 *
 * The shape below is deliberately about a *range* rather than a list of figures: the caller walks its population
 * once to learn its lowest and highest figure and asks for the empty scale. That is what lets a population of
 * two hundred thousand cost twenty-four buckets of memory rather than two hundred thousand figures - nothing
 * here ever holds a copy of the population to draw a histogram of it.
 */
import type { DistributionBin } from '#shared/data/historySchema'

/** How many buckets a histogram is cut into. */
export const DISTRIBUTION_BINS = 24

/**
 * The empty scale of one histogram: `DISTRIBUTION_BINS` equal widths from `lo` to `hi`, rounded the way the
 * chart prints its labels.
 *
 * A population that never moved - every figure the same - is one bucket rather than a row of zero-width ones,
 * which is also what keeps the SQL's division from a span of nothing.
 *
 * The counts come back zeroed: this cuts the scale, and whoever walked the figures fills them in.
 */
export function binEdges(lo: number, hi: number): DistributionBin[] {
  if (lo === hi) return [{ from: lo, to: hi, count: 0 }]

  const width = (hi - lo) / DISTRIBUTION_BINS
  return Array.from({ length: DISTRIBUTION_BINS }, (_, index) => ({
    from: Math.round(lo + index * width),
    to: Math.round(index === DISTRIBUTION_BINS - 1 ? hi : lo + (index + 1) * width),
    count: 0
  }))
}
