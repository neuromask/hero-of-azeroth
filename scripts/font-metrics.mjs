/**
 * Derives the metric overrides of the site's fallback typeface, for `app/assets/css/main.css`.
 *
 * Gilroy arrives a moment after the first paint, and the browser paints the fallback until then - so the two
 * have to *measure* the same, or every line of text moves when the real face swaps in. That is what the
 * `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` descriptors of a fallback
 * `@font-face` are for: they scale and shift a system face until it occupies the box Gilroy would have
 * occupied. The numbers are ratios of the two fonts' own tables, so they are derived here rather than guessed,
 * and this script prints the block to paste (or to diff against what is in the stylesheet).
 *
 * Both files are read the same way, which is what makes the ratios meaningful:
 *
 *   - `unitsPerEm` (head), the em every other number is expressed in;
 *   - the ascender, descender and line gap (hhea), which decide where the baseline sits in a line box;
 *   - the average advance width (hmtx over every glyph), which decides how wide a run of text comes out.
 *
 * The vertical metrics are the same in every weight of a family; only the advances differ, so a face is paired
 * with the fallback the browser would actually pick for its weight - Arial Regular for 400 and 600, Arial Bold
 * for 700 and 800 - and the same face is measured for both.
 *
 * Usage: node scripts/font-metrics.mjs [fallback-regular.ttf] [fallback-bold.ttf]
 * Default fallbacks are Arial on Windows; anywhere else, pass a path (the deploy host has no fonts in common
 * with a reader's machine, which is why the values are committed to the stylesheet rather than computed there).
 */
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url)
const GILROY = new URL('public/fonts/gilroy/', ROOT)

/** The weights the site sets text in, and the file each one is served from. */
const FACES = [
  { weight: 400, file: 'Gilroy-Medium.woff2', fallback: 'regular' },
  { weight: 600, file: 'Gilroy-SemiBold.woff2', fallback: 'regular' },
  { weight: 700, file: 'Gilroy-Bold.woff2', fallback: 'bold' },
  { weight: 800, file: 'Gilroy-ExtraBold.woff2', fallback: 'bold' }
]

const FALLBACKS = {
  regular: process.argv[2] || 'C:/Windows/Fonts/arial.ttf',
  bold: process.argv[3] || 'C:/Windows/Fonts/arialbd.ttf'
}

/** The tag names a WOFF2 table directory indexes by number, in the order the specification lists them. */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'
]

/** A WOFF2 unsigned integer of one to five bytes, which is how its table directory is written. */
function readBase128(buffer, offset) {
  let value = 0

  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[offset + i]
    if (byte === undefined) throw new Error('a WOFF2 length ran off the end of the file')
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) return { value, size: i + 1 }
  }

  throw new Error('a WOFF2 length is longer than five bytes')
}

/**
 * One WOFF2 file as its tables, decompressed.
 *
 * Only the directory is walked here - the tags, the lengths and the order the tables are stored in - because
 * nothing this script reads (`head`, `hhea`, `maxp`, `hmtx`) is ever transformed: WOFF2 rewrites `glyf` and
 * `loca` and leaves the rest alone, so a table is its slice of the decompressed stream.
 */
function woff2Tables(file) {
  const buffer = readFileSync(file)
  if (buffer.toString('ascii', 0, 4) !== 'wOF2') throw new Error(`${file} is not a WOFF2 file`)

  const numTables = buffer.readUInt16BE(12)
  const tables = []
  let offset = 48

  for (let i = 0; i < numTables; i += 1) {
    const flags = buffer[offset]
    const index = flags & 0x3f
    const transform = (flags >> 6) & 0x03
    offset += 1

    let tag
    if (index === 0x3f) {
      tag = buffer.toString('ascii', offset, offset + 4)
      offset += 4
    } else {
      tag = WOFF2_TAGS[index]
    }

    const orig = readBase128(buffer, offset)
    offset += orig.size

    let stored = orig.value
    if ((tag === 'glyf' || tag === 'loca') && transform === 0) {
      const transformed = readBase128(buffer, offset)
      offset += transformed.size
      stored = transformed.value
    }

    tables.push({ tag, stored })
  }

  const stream = brotliDecompressSync(buffer.subarray(offset))
  const slices = new Map()
  let at = 0

  for (const table of tables) {
    slices.set(table.tag, stream.subarray(at, at + table.stored))
    at += table.stored
  }

  return slices
}

/** A TrueType file as the same table map, read straight out of its own directory. */
function sfntTables(file) {
  const buffer = readFileSync(file)
  const numTables = buffer.readUInt16BE(4)
  const slices = new Map()

  for (let i = 0; i < numTables; i += 1) {
    const at = 12 + i * 16
    const tag = buffer.toString('ascii', at, at + 4)
    const offset = buffer.readUInt32BE(at + 8)
    const length = buffer.readUInt32BE(at + 12)
    slices.set(tag, buffer.subarray(offset, offset + length))
  }

  return slices
}

/** The three numbers the overrides are ratios of, plus the average advance a run of text comes out at. */
function metrics(tables) {
  const head = tables.get('head')
  const hhea = tables.get('hhea')
  const maxp = tables.get('maxp')
  const hmtx = tables.get('hmtx')

  const unitsPerEm = head.readUInt16BE(18)
  const ascender = hhea.readInt16BE(4)
  const descender = hhea.readInt16BE(6)
  const lineGap = hhea.readInt16BE(8)
  const numHMetrics = hhea.readUInt16BE(34)
  const numGlyphs = maxp.readUInt16BE(4)

  // The advances are a run of (advance, side bearing) pairs, and the last one is repeated for every glyph the
  // table does not list - which is how a font says "everything after this one is as wide as this one".
  let total = 0
  for (let i = 0; i < numHMetrics; i += 1) total += hmtx.readUInt16BE(i * 4)
  if (numGlyphs > numHMetrics) total += hmtx.readUInt16BE((numHMetrics - 1) * 4) * (numGlyphs - numHMetrics)

  return { unitsPerEm, ascender, descender, lineGap, average: total / numGlyphs }
}

const fallbackMetrics = {}
for (const [key, file] of Object.entries(FALLBACKS)) {
  try {
    fallbackMetrics[key] = metrics(sfntTables(file))
  } catch (error) {
    console.error(`could not read the fallback face ${file}: ${error.message}`)
    process.exit(1)
  }
}

// A zero is printed as `0%` rather than `0.00%`, so what this prints is what the stylesheet carries and a re-run
// diffs as nothing rather than as noise.
const percent = (value) => (value === 0 ? '0%' : `${(value * 100).toFixed(2)}%`)

console.log('/* The fallback face, scaled and shifted until it measures what Gilroy measures. */')
for (const face of FACES) {
  const gilroy = metrics(woff2Tables(new URL(face.file, GILROY)))
  const local = fallbackMetrics[face.fallback]

  const sizeAdjust = (gilroy.average / gilroy.unitsPerEm) / (local.average / local.unitsPerEm)
  const ascent = (gilroy.ascender / gilroy.unitsPerEm) / sizeAdjust
  const descent = (Math.abs(gilroy.descender) / gilroy.unitsPerEm) / sizeAdjust
  const lineGap = (gilroy.lineGap / gilroy.unitsPerEm) / sizeAdjust

  console.log('')
  console.log(`@font-face { /* ${face.file}, weight ${face.weight} */`)
  console.log("  font-family: 'Gilroy Fallback';")
  console.log("  src: local('Arial'), local('Helvetica Neue'), local('Liberation Sans');")
  console.log(`  font-weight: ${face.weight};`)
  console.log('  font-style: normal;')
  console.log(`  size-adjust: ${percent(sizeAdjust)};`)
  console.log(`  ascent-override: ${percent(ascent)};`)
  console.log(`  descent-override: ${percent(descent)};`)
  console.log(`  line-gap-override: ${percent(lineGap)};`)
  console.log('}')
}
