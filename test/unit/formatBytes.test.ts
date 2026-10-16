/**
 * How a size is written, and the one thing the panel must never get wrong about it.
 *
 * The incident this exists for started with a number nobody could trust: the panel showed `1.9 GiB` beside a
 * hundred-megabyte heap, and the first question was whether the *unit* was wrong. So the rule is pinned here -
 * a reading of `2040109465` bytes is `1.9 GiB`, `1992060` is `1.9 MiB`, a missing figure is a dash and never a
 * zero - and the endpoint's own half of the contract (that it hands over *bytes*) is checked beside it
 * (`test/unit/adminDiagnostics.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { formatBytes } from '../../shared/utils/format-bytes'

describe('a size in bytes', () => {
  it('is read in the largest unit that keeps it readable, with the unit always printed', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1 023 B')
    expect(formatBytes(1024)).toBe('1.0 KiB')
    expect(formatBytes(1992060)).toBe('1.9 MiB')
    expect(formatBytes(2040109465)).toBe('1.9 GiB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MiB')
    expect(formatBytes(512 * 1024 * 1024)).toBe('512 MiB')
  })

  it('keeps the site’s own spelling of a whole figure, and drops a decimal only when it says nothing', () => {
    // A plain space, as `formatNumber` spells every other count on the site.
    expect(formatBytes(1234567)).toBe('1.2 MiB')
    expect(formatBytes(1023)).toContain(' ')
    // Under 10 the decimal matters (`1.9 GiB` is not `2 GiB`); over 10 it does not.
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MiB')
  })

  it('is a dash for a size nobody knows, which is what an unreadable file reports', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})
