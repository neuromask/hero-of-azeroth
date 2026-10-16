/**
 * A size in bytes, written the way the site writes a figure.
 *
 * The panel has to print the process's own memory, and the one thing that must not happen to it is a unit being
 * guessed: `1.9 GiB` and `1992060 KiB` are the same number, and a reader who cannot tell which one they are
 * looking at cannot tell whether there is a problem at all. So the conversion lives here, once, next to the
 * figure formatting the rest of the site already shares (`./formatNumber`) - and the admin page and its tests
 * are two readers of the same rule rather than two implementations of it.
 *
 * A unit is always printed, a fractional size keeps one decimal only while it would be lost in rounding (a
 * reading of `1.9 GiB` is a reading; `1945 MiB` is noise), and a value that is absent or not a number - which is
 * what an unreadable file reports - is a dash, never a zero.
 */
import { formatNumber } from './formatNumber'

/** The units a size is read in, smallest first. */
const UNITS = ['B', 'KiB', 'MiB', 'GiB'] as const

export function formatBytes(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—'

  let size = value
  let unit = 0

  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit += 1
  }

  // Whole bytes are printed as the site prints every other count; anything larger keeps a decimal while it
  // still says something, so `1.9 GiB` does not become a `2 GiB` that flatters the process.
  if (unit === 0) return `${formatNumber(value)} ${UNITS[0]}`

  return `${size.toFixed(size < 10 ? 1 : 0)} ${UNITS[unit]}`
}
