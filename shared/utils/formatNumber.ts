/**
 * How a figure is written on the site - one rule, in one place.
 *
 * Every count the site prints goes through `formatNumber`, and a page and the card drawn for it
 * agree on what a figure looks like because this module is the only spelling of the rule: thousands
 * are grouped by a space - `1 200`, `44 720`, `1 235 700` - never by a comma and never run together.
 * It sits on the shared side of the project rather than in a component because both ends need it -
 * the pages print figures in the browser, and the card draws them into its own raster on the server -
 * and a second implementation is a second answer, which is how `4,589` came to stand on an English
 * page beside `4 589` on a Russian one.
 *
 * Two things about it are deliberate:
 *
 *   - **The separator is a plain space (`U+0020`).** A locale-aware formatter writes a non-breaking
 *     space in Russian and a comma in English, and a glyph a face does not carry is a box on a shared
 *     picture: the card is drawn by `resvg` in a font the site ships, and a space is in every face. A
 *     figure that must not break across two lines is kept whole by `whitespace-nowrap` where it
 *     stands, which is a decision about that layout rather than about the number.
 *   - **The language being read is not consulted.** A count is a count: the same figure reads the
 *     same on the Russian page, on the English page and on the picture both of them share. The
 *     thousands separator is the only thing that would differ between the two, and the site spells
 *     it one way - which is also why there is one function here and not two.
 *
 * It is written for the whole figures the site deals in: counts, ratings and shares. A fractional
 * value is rounded to the nearest whole one - nothing on the site prints a fraction, and a
 * percentage arrives already rounded (see `collectionPercent` in `./wow-quality`) - and a value that
 * is absent or not a number reads as nothing at all rather than as `NaN`, because a row that does
 * not know a figure prints a dash of its own beside it.
 */
export function formatNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''

  const whole = Math.round(value)
  const digits = String(Math.abs(whole))

  return `${whole < 0 ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}
