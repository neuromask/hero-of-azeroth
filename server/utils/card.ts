import { Resvg } from '@resvg/resvg-js'
import jpeg from 'jpeg-js'
import { mPlusQualityHex, wowQualityHex } from '#shared/utils/wow-quality'
// The class colours are shared with the page and the search history, so a card, a page and a
// remembered name all read one table (see `shared/utils/wow-class.ts`).
import { classColorHex } from '#shared/utils/wow-class'
import type { CharacterData, CharacterStat } from './blizzard'
import { pngAlphaBandBounds, pngAlphaBounds } from './png'
import type { PngBand, PngBounds } from './png'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

/**
 * The type the card is set in: what every `<text>` inherits, and what `measuredTextWidth`
 * renders its probe with, so a width measured there is the width the card draws. Gilroy leads
 * it - the faces themselves are registered with the rasteriser below - and the system faces
 * after it are what a card falls back to if the font files are ever missing, so a deployment
 * that lost them still draws a card rather than a blank one.
 */
const FONT_FAMILY = 'Gilroy, Segoe UI, Arial, Helvetica, sans-serif'

/**
 * Where the character is drawn: a waist-up portrait filling the right of the card.
 *
 * `RENDER_BODY_HEIGHT` is the height the model's bounding box ends up with on the
 * card, and it is the whole figure most of which sits below the visible area:
 * `RENDER_CUT` gives the part hanging over the bottom edge, which is what turns the
 * full body into a waist-up portrait. The hips of a World of Warcraft model sit at
 * roughly 57% of its height, so cutting 46% off leaves them just above the edge.
 *
 * `RENDER_MAX_WIDTH` is generous on purpose: a wide silhouette - a draenei's tail, a
 * demon hunter's wings - may reach past the right edge, where the card's clip takes
 * it, rather than being scaled down into a smaller figure than everybody else's.
 */
const RENDER_BODY_HEIGHT = 1000
const RENDER_MAX_WIDTH = 1100
const RENDER_CENTER_X = 962
const RENDER_CUT = 0.46

/**
 * Blizzard's character renders and Armoury artwork are always drawn on a
 * 1600x1200 canvas.
 */
const SOURCE_WIDTH = 1600
const SOURCE_HEIGHT = 1200

/**
 * Fallback crop used when the render cannot be decoded: the model is anchored
 * so its feet sit at ~82% of the canvas height, which is the area this box
 * covers.
 */
const DEFAULT_RENDER_BOX = { x: 560, y: 190, w: 480, h: 830 }

/** Class colours live in `#shared/utils/wow-class`, shared with the page and the history. */

const LABELS: Record<string, Record<string, string>> = {
  ru_RU: {
    achievements: 'Достижения',
    itemLevel: 'Уровень предметов',
    mPlus: 'Рейтинг M+',
    mounts: 'Маунты',
    pets: 'Питомцы',
    toys: 'Игрушки',
    decor: 'Декор',
    reputations: 'Репутации',
    level: 'Ур.'
  },
  en_US: {
    achievements: 'Achievs',
    itemLevel: 'Item Level',
    mPlus: 'M+ Score',
    mounts: 'Mounts',
    pets: 'Pets',
    toys: 'Toys',
    decor: 'Decor',
    reputations: 'Reputations',
    level: 'Lv.'
  }
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The widest letters of the two alphabets the card prints, one per alphabet: SVG has no
 * text metrics to read back, so `textWidth` estimates by glyph and this is the bucket
 * that keeps a run of `Ж`/`M`/`W` from running into whatever sits beside it.
 */
const WIDE_GLYPHS = /[ЖШЩМЮЫФДЦжшщмюыфдцMWmw@%№&]/

/**
 * The width a run of text takes at the given font size, in the units the card is drawn
 * in. Two buckets - wide and ordinary - are close enough to keep every label inside its
 * box, and this only ever decides how much text survives.
 */
function textWidth(value: string, fontSize: number): number {
  let width = 0

  for (const char of value) {
    width += fontSize * (WIDE_GLYPHS.test(char) ? 0.72 : 0.54)
  }

  return width
}

/**
 * `value` cut to what fits into `maxWidth`, with an ellipsis when something was dropped.
 * A name, a guild and a race-spec-class line all arrive at a length the card cannot
 * know in advance, and every one of them has a fixed place to sit in.
 *
 * `measure` is how a letter is counted: the estimate of `textWidth` by default, and a width
 * read back from the renderer in `measuredTextWidth` where a guess is not good enough.
 */
function fitText(
  value: unknown,
  maxWidth: number,
  fontSize: number,
  measure: (text: string, fontSize: number) => number = textWidth
): string {
  const text = String(value ?? '')
  if (measure(text, fontSize) <= maxWidth) return text

  let kept = ''

  for (const char of text) {
    if (measure(`${kept}${char}…`, fontSize) > maxWidth) break
    kept += char
  }

  return `${kept}…`
}

/**
 * Where the Gilroy faces the card is set in live, and which of them the rasteriser is handed.
 *
 * The browser is served the same family as `.woff2` (`public/fonts/gilroy`, declared in
 * `app/assets/css/main.css`), but the rasteriser reads its fonts through the machine's own
 * `fontdb`, which knows TrueType and OpenType and nothing at all about WOFF: a `.woff2` passed to
 * `fontFiles` is one it silently draws no glyphs for. The `.ttf` beside each `.woff2` is what is
 * registered here, and they are the four weights the card asks for - 400 and 600 in the small
 * print and the plates, 700 for the names and the figures.
 *
 * `public/` is where they live because it is the one directory a deployment always has:
 * `npm run deploy` uploads `.output` alone and Nitro copies `public/` into it, so the folder sits
 * beside `server/index.mjs` whether the server runs from the checkout or from a build. The
 * directory is looked for under the working directory and the two levels above it, which is what
 * covers a server started from the deploy root, from the checkout, or from inside `.output`.
 */
const FONT_DIR = 'public/fonts/gilroy'
const FONT_FILES = ['Gilroy-Regular.ttf', 'Gilroy-SemiBold.ttf', 'Gilroy-Bold.ttf', 'Gilroy-ExtraBold.ttf']

function loadFontFiles(): string[] {
  for (const root of [process.cwd(), join(process.cwd(), '..'), join(process.cwd(), '..', '..')]) {
    const dir = join(root, FONT_DIR)
    if (!existsSync(join(dir, FONT_FILES[0]!))) continue

    return FONT_FILES.map((file) => join(dir, file)).filter((file) => existsSync(file))
  }

  // No faces found, so the rasteriser is left with the machine's own fonts and every `<text>`
  // falls back to the system family named in `FONT_FAMILY`.
  return []
}

/**
 * The renderer the card and its measurement probes are both drawn with, at the card's own width.
 * Rasterising a document is the whole of what the two share - a probe is then read back for its
 * ink, and the card is written out as a picture. Gilroy is named as the default family and handed
 * over as the files it is drawn from, so a card is set in the typeface its page is; the machine's
 * fonts stay loaded underneath it as the fallback for whatever the family has not got.
 */
const RESVG_OPTIONS = {
  font: { loadSystemFonts: true, defaultFontFamily: 'Gilroy', fontFiles: loadFontFiles() },
  fitTo: { mode: 'width' as const, value: CARD_WIDTH }
}

/** Rasterises a document to pixels, the way the card is rasterised. */
function rasterise(svg: string) {
  return new Resvg(svg, RESVG_OPTIONS).render()
}

/**
 * A document rendered to PNG bytes, which is what a measurement probe is: the ink of that
 * render is what a width of text is read from.
 */
function renderSvg(svg: string): Buffer {
  return rasterise(svg).asPng()
}

/**
 * `sharp`, read on first use.
 *
 * Its encoder is a native library, and a native library has to match the machine that loads it:
 * `sharp` ships one build per platform, and the `.output` that `npm run deploy` uploads holds only
 * the ones the building machine had - which is what the `@img/sharp-linux-x64` pair in
 * `devDependencies` is for, exactly as `@resvg/resvg-js-linux-x64-gnu` is there for the
 * rasteriser. A build that reaches the host without the matching pair throws as its module is
 * read, so it is read late and the failure is caught here; read at the top of the file it would
 * bring the whole route down before a card could be asked for.
 */
let sharpModule: Promise<typeof import('sharp').default | null> | null = null

function loadSharp() {
  sharpModule ??= import('sharp').then((module) => module.default).catch(() => null)
  return sharpModule
}

/**
 * The quality the card is written at, on the JPEG scale of 1 to 100.
 *
 * A card is finished with photographs - the class artwork behind it and the character's own
 * render over it - which a PNG stores losslessly, and that is where the megabyte of the old
 * picture came from. A JPEG of the same card at this setting is a fifth of that, and at the size
 * a chat window shows it in the two cannot be told apart.
 *
 * The weight is the reason for the setting rather than a side effect of it: an `og:image` is
 * fetched by the crawler of a chat network under a deadline of a couple of seconds, and how many
 * bytes it has to pull inside that deadline is part of whether the preview appears at all.
 */
const JPEG_QUALITY = 80

/**
 * The finished card as JPEG bytes.
 *
 * The rasteriser hands over its raw RGBA (`pixels`), which is what `sharp` takes as its `raw`
 * input, so the picture goes from the rasteriser into the encoder and never exists as a PNG on
 * the way out - the intermediate copy of the old pipeline, and the second pass over every pixel
 * that came with it.
 */
async function encodeCard(svg: string): Promise<Buffer> {
  const image = rasterise(svg)
  const lib = await loadSharp()

  if (lib) {
    return lib(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
  }

  // The pure-JS encoder, for a host whose native one cannot load: a card a little heavier than it
  // should be beats no card at all.
  return jpeg.encode({ data: image.pixels, width: image.width, height: image.height }, JPEG_QUALITY).data
}

/**
 * The width a run of text draws at, read back from the renderer that draws the card.
 *
 * `textWidth` above is a guess, and a good enough one to decide how much of a line survives:
 * a heading centred on it, though, lands visibly off, because a run of capitals is up to a
 * fifth wider than its two buckets say. SVG has no text metrics to query, so the run is drawn -
 * in the card's own font, size, weight and letter spacing - and the ink of that render is
 * measured. It is what puts a summary number under the caps of its heading.
 *
 * A width is measured once and kept, because rendering a card is a hot path.
 */
const measuredWidths = new Map<string, number>()

/** A run of text whose drawn width the card needs, and the type it is set in. */
interface MeasureRequest {
  value: string
  size: number
  letterSpacing?: number
}

function widthKey(value: string, size: number, letterSpacing: number): string {
  return `${size}/${letterSpacing}/${value}`
}

/**
 * How tall the band a run is measured in is, and how far down that band the run's baseline sits,
 * as multiples of the run's own size.
 *
 * A line drawn on a canvas of its own is given three times its size in height and takes up about a
 * third of it, and the canvas is what the rasteriser is paid for. These two hold everything a line
 * reaches with: a capital above the baseline, the accents that sit over one, and the descenders
 * that hang below. Measured against probes of their own, the widths do not move.
 */
const MEASURE_BAND_HEIGHT = 1.8
const MEASURE_BAND_BASELINE = 1.3

/**
 * Measures every run in `requests` that has no width yet, in one rasteriser pass.
 *
 * A card needs about twenty widths. Measured one at a time, each costs what drawing the whole
 * card costs, and almost all of it is not the line: a rasteriser pass loads the machine's fonts
 * for the sake of whatever is drawn in it, and that is about 97 of the 98 milliseconds a
 * single-line probe took when this was timed - the pixels of the line itself are a millisecond or
 * two. Twenty of those, one per string, was 1.9 seconds of a cold card, and the largest cost the
 * card had.
 *
 * Drawn as one document instead, one band per run, the same widths come out of one pass in about
 * a tenth of the time. What a width depends on is horizontal: the card's own width, the run
 * centred on it, and the run drawn in the same font, size, weight and letter spacing. A band
 * keeps all of that and gives up only the empty canvas a probe of its own carried, which was two
 * thirds of it: how tall a band is, and where down it the baseline sits, are below.
 *
 * The widths are the widths a probe of its own would return, run for run - checked against 57 of
 * them, descenders, wide capitals, accents and both alphabets among the cases - because nothing
 * about the ink changed, only the amount of blank canvas the ink is drawn on.
 */
async function measureBatch(requests: MeasureRequest[]): Promise<void> {
  const missing: Required<MeasureRequest>[] = []
  const planned = new Set<string>()

  for (const request of requests) {
    const letterSpacing = request.letterSpacing || 0
    const key = widthKey(request.value, request.size, letterSpacing)
    if (measuredWidths.has(key) || planned.has(key)) continue

    planned.add(key)
    missing.push({ value: request.value, size: request.size, letterSpacing })
  }

  if (!missing.length) return

  const bands: PngBand[] = []
  const texts: string[] = []
  let height = 0

  for (const request of missing) {
    const band = Math.ceil(request.size * MEASURE_BAND_HEIGHT)
    bands.push({ top: height, height: band })
    texts.push(`<text x="${CARD_WIDTH / 2}" y="${height + request.size * MEASURE_BAND_BASELINE}" font-size="${request.size}" font-weight="700" letter-spacing="${request.letterSpacing}" text-anchor="middle" fill="#ffffff">${esc(request.value)}</text>`)
    height += band
  }

  const document = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" font-family="${FONT_FAMILY}">${texts.join('')}</svg>`

  let bounds: (PngBounds | null)[] = missing.map(() => null)

  try {
    bounds = pngAlphaBandBounds(rasterise(document).asPng(), bands)
  } catch {
    // A document the rasteriser will not draw is not worth failing a card over: the widths below
    // fall back to the estimate, which is what `measuredTextWidth` does for a run it cannot draw.
  }

  missing.forEach((request, index) => {
    const ink = bounds[index]
    measuredWidths.set(
      widthKey(request.value, request.size, request.letterSpacing),
      ink ? ink.w : textWidth(request.value, request.size)
    )
  })
}

function measuredTextWidth(value: string, fontSize: number, letterSpacing = 0): number {
  const key = widthKey(value, fontSize, letterSpacing)
  const cached = measuredWidths.get(key)
  if (cached !== undefined) return cached

  const height = Math.ceil(fontSize * 3)
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" font-family="${FONT_FAMILY}"><text x="${CARD_WIDTH / 2}" y="${fontSize * 2}" font-size="${fontSize}" font-weight="700" letter-spacing="${letterSpacing}" text-anchor="middle" fill="#ffffff">${esc(value)}</text></svg>`
  const bounds = value ? pngAlphaBounds(renderSvg(probe)) : null
  const width = bounds ? bounds.w : textWidth(value, fontSize)

  measuredWidths.set(key, width)
  return width
}

function percent(count: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)))
}

function toDataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * Where the icon artwork lives in the checkout, plus the files that have already
 * been read: rendering a card is a hot path, so every `<name>.svg` is parsed once
 * and reused.
 */
const ICON_DIR = 'app/assets/icons'

interface Icon {
  viewBox: string
  ratio: number
  body: string
}

const iconCache = new Map<string, Icon>()

/** Strips `<name>.svg` down to the shapes that can be nested into the card. */
function prepareIcon(raw: string): Icon {
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] || '0 0 512 512'
  const [, , boxWidth, boxHeight] = viewBox.split(/[\s,]+/).map(Number)

  return {
    viewBox,
    ratio: boxWidth && boxHeight ? boxWidth / boxHeight : 1,
    // The artwork paints itself white from a <style> block and names its layers;
    // neither survives being nested into the card, where the colour is set on
    // the `<svg>` that wraps these paths instead.
    body: raw
      .replace(/<\?xml[^?]*\?>/, '')
      .replace(/<defs[\s\S]*?<\/defs>/, '')
      .replace(/\s(?:id|data-name|class)="[^"]*"/g, '')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>[\s\S]*$/, '')
      .trim()
  }
}

/** The text a `getItemRaw` hands back, whichever storage driver answered. */
function iconText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(new Uint8Array(raw)).toString('utf8')
  return ''
}

/**
 * Reads every icon once. `nuxt.config.ts` lists `app/assets/icons` as a Nitro
 * server asset, so the artwork is bundled into the build and reaches a host that
 * only receives `.output`; the icons are read through the `assets:icons` storage
 * for that reason. A server started from the checkout as `nuxt dev` does reaches
 * the same folder through the filesystem fallback in `loadIcon`.
 */
let iconsLoaded: Promise<void> | null = null

function loadIcons(): Promise<void> {
  if (!iconsLoaded) {
    iconsLoaded = (async () => {
      const storage = useStorage()
      const keys = await storage.getKeys('assets:icons').catch(() => [] as string[])

      await Promise.all(keys.map(async (key) => {
        const name = key.split(/[/:]/).pop()?.replace(/\.svg$/, '')
        if (!name) return

        const text = iconText(await storage.getItemRaw(key).catch(() => ''))
        if (text) iconCache.set(name, prepareIcon(text))
      }))
    })()
  }

  return iconsLoaded
}

/** Reads `<name>.svg` from `~/assets/icons` and strips it down to its shapes. */
function loadIcon(name: string): Icon | null {
  if (iconCache.has(name)) return iconCache.get(name)!

  // Only reached for an icon that is not part of the build: the server normally
  // runs from the project root, and the parent directory is tried as well, for a
  // server started from inside `.output`.
  for (const root of [process.cwd(), join(process.cwd(), '..')]) {
    const file = join(root, ICON_DIR, `${name}.svg`)
    if (!existsSync(file)) continue

    const icon = prepareIcon(readFileSync(file, 'utf8'))
    iconCache.set(name, icon)
    return icon
  }

  return null
}

/**
 * `<name>` drawn at `x`/`y` with the given height, as a nested `<svg>` so it keeps
 * the proportions the artwork was drawn in. A missing file yields an empty
 * string, which lets the caller fall back to plain text.
 */
function iconElement(name: string, x: number, y: number, height: number, fill: string): string {
  const icon = loadIcon(name)
  if (!icon) return ''

  const width = +(height * icon.ratio).toFixed(2)
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${icon.viewBox}" fill="${fill}" overflow="visible">${icon.body}</svg>`
}

/** The width `<name>` is drawn at for a given height, which is what centres it in a box. */
function iconWidth(name: string, height: number): number {
  const icon = loadIcon(name)
  return icon ? height * icon.ratio : 0
}

/** Rounds a coordinate to the hundredth the rest of the card's geometry is drawn at. */
function round2(value: number): number {
  return +value.toFixed(2)
}

/**
 * A heading: the glyph in its rounded box with the uppercase label beside it, the two lined
 * up on the cap height of the label. Every tile is titled with one of these, which is what
 * keeps the card's headings the same size and weight.
 *
 * `x` is the left edge of the box, `y` the baseline of the label and `width` the room the
 * whole heading has: the label is cut to what is left of that after the box, so a long one
 * ends in an ellipsis rather than running into whatever sits beside it.
 */
function headingSvg(icon: string, label: string, x: number, y: number, width: number): string {
  const top = headingBoxTop(y)
  // The glyph is centred in its box on both axes; every icon file is drawn on a square.
  const glyph = iconElement(
    icon,
    round2(x + (HEADING_ICON_BOX - iconWidth(icon, HEADING_ICON_GLYPH)) / 2),
    top + (HEADING_ICON_BOX - HEADING_ICON_GLYPH) / 2,
    HEADING_ICON_GLYPH,
    '#e2e8f0'
  )
  return `<rect x="${round2(x)}" y="${top}" width="${HEADING_ICON_BOX}" height="${HEADING_ICON_BOX}" rx="9" fill="#0b1220" stroke="#1e293b" stroke-width="1.5"/>
  ${glyph}
  <text x="${round2(x + HEADING_ICON_BOX + HEADING_ICON_GAP)-6}" y="${round2(y)}" font-size="${HEADING_LABEL_SIZE}" font-weight="700" letter-spacing="${HEADING_LETTER_SPACING}" fill="#e2e8f0">${esc(headingLabel(label, width))}</text>`
}

/** One collection of the tile grid. */
interface Tile {
  label: string
  icon: string
  count: number
  total: number
  /** The count's fill, which is the tier its collection has reached (see `wowQualityHex`). */
  color: string
}

/**
 * One tile: its heading, the count under it, and the bar along the bottom edge.
 *
 * `numberSize` is the size every tile's count is set at (`tileNumberSize`); it is handed in
 * rather than picked here because all six have to hold the same one, and it is what places the
 * count between the heading and the bar. The count is set in the tier colour its collection has
 * reached - the same ladder the page's tiles set theirs in - and the bar's fill is the share of
 * the collection that is complete. The count is written as plain digits, with no thousands
 * separator, so it reads the same here as it does on the page and in the game. The tile carries
 * no small print: at this width there is no room for the total and the percentage beside the
 * label, which is what the bar is for.
 */
function tileSvg(tile: Tile, x: number, y: number, width: number, numberSize: number): string {
  const inset = width - TILE_PAD * 2
  const barX = round2(x + TILE_PAD)
  const barWidth = round2(inset)
  const filled = round2((barWidth * percent(tile.count, tile.total)) / 100)
  const barY = y + TILE_BAR_Y
  // The dark track with its hairline edge, then the fill twice: blurred underneath for the
  // bloom the bars have on the page, and crisp on top of it so the fill keeps its edges.
  return `<rect x="${round2(x)}" y="${y}" width="${round2(width)}" height="${TILE_HEIGHT}" rx="14" fill="#05070b" fill-opacity="0.6" stroke="#1e293b" stroke-width="2"/>
  ${headingSvg(tile.icon, tile.label, x + TILE_PAD, y + TILE_LABEL_Y, inset)}
  <text x="${round2(x + width / 2)}" y="${round2(y + tileNumberY(numberSize))}" font-size="${numberSize}" font-weight="700" fill="${tile.color}" text-anchor="middle">${tile.count}</text>
  <rect x="${barX}" y="${barY}" width="${barWidth}" height="${TILE_BAR_HEIGHT}" rx="4" fill="#0b1220" stroke="#334155" stroke-width="1"/>
  <rect x="${barX}" y="${barY}" width="${filled}" height="${TILE_BAR_HEIGHT}" rx="4" fill="url(#barGrad)" filter="url(#barGlow)"/>
  <rect x="${barX}" y="${barY}" width="${filled}" height="${TILE_BAR_HEIGHT}" rx="4" fill="url(#barGrad)"/>`
}

/** Downloads the Armoury class backdrop (JPEG) used behind the character. */
async function loadBackground(url: string): Promise<string> {
  if (!url) return ''
  try {
    const image = await $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' })
    if (!image || !image.byteLength) return ''
    const data = toDataUri(Buffer.from(image), url.endsWith('.png') ? 'image/png' : 'image/jpeg')
    // The class artwork is a character-free scene, so it simply covers the card:
    // `slice` crops the vertical overflow and leaves the floor line of the scene
    // where the feet of the render end up. `bgPop` restores the punch the art has
    // on the Armoury before the scrim dims it for the text.
    return `<image href="${data}" x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" filter="url(#bgPop)"/>`
  } catch {
    return ''
  }
}

/**
 * Downloads the character render and builds the `<image>` element drawing it.
 *
 * Blizzard ships a 1600x1200 canvas with the model floating in the middle, so
 * the alpha bounding box is measured and the image is scaled and offset until the
 * character fills the card instead of being a tiny figure in empty space. The box
 * bottom is the model's feet, which is what the cut below the card is measured from.
 */
async function loadRender(url: string): Promise<string> {
  if (!url) return ''
  try {
    const image = Buffer.from(await $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' }))
    const bounds = pngAlphaBounds(image)
    const box = bounds || DEFAULT_RENDER_BOX

    const scale = Math.min(RENDER_BODY_HEIGHT / box.h, RENDER_MAX_WIDTH / box.w)
    const drawWidth = SOURCE_WIDTH * scale
    const drawHeight = SOURCE_HEIGHT * scale
    const x = RENDER_CENTER_X - (box.x + box.w / 2) * scale
    const y = CARD_HEIGHT + RENDER_CUT * box.h * scale - (box.y + box.h) * scale

    return `<image href="${toDataUri(image, 'image/png')}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${drawWidth.toFixed(2)}" height="${drawHeight.toFixed(2)}" preserveAspectRatio="none"/>`
  } catch {
    return ''
  }
}

/** The sizes the name is set in before it is cut: it is the one line worth shrinking. */
const NAME_SIZES = [46, 40, 34]

/**
 * The left column: the three summary numbers on a panel, the collection tiles beneath it
 * and the foot band with the address. The tiles are what the card is read for, so they
 * take the room the portrait leaves over - a row spans the width of the column - and the
 * panel and the band are inset from the column's edges.
 */
const COLUMN_X = 44
const COLUMN_WIDTH = 712
const COLUMN_RIGHT = COLUMN_X + COLUMN_WIDTH

/**
 * The header: the name against the left edge, and the character's own details - the level, the
 * race, the spec and class, the guild and the realm - as the rounded plates the character page
 * prints them on, in a band under the name. The wordmark keeps the top-right corner.
 *
 * The name is set in plain white, so the eye reads it first and the plates after it; the class
 * gold it used to wear is now worn by the spec-and-class plate alone. The name has the band to
 * itself - the character's title is not drawn on the card - so it may run most of the width
 * before it is set any smaller, and the plates wait on the row under it either way.
 *
 * The plates flow left to right from the one left guide, and a row below centres on the row above
 * it, so a set of details too long for one line reads as a block rather than as a ragged second
 * row. A row reaching for the wordmark stops short of it; a row below the wordmark may run to the
 * card's own padding.
 */
const LOGO_X = 964
/** The size the wordmark is drawn at in the corner, 52 below the top edge. */
const LOGO_SIZE = 52
/** The one left guide every block is set on: the name, the plates, the tiles and the foot band. */
const LEFT_PAD = 44
const BADGE_X = LEFT_PAD
const BADGE_TOP = 102
/** As far as a row of plates may run: the card's own padding, mirrored. */
const BADGE_RIGHT = CARD_WIDTH - LEFT_PAD
/** As far as a row may run while it is up beside the wordmark. */
const BADGE_RIGHT_UNDER_WORDMARK = LOGO_X - 20
/** The bottom edge of the wordmark, under which a row has the full width. */
const BADGE_WORDMARK_BOTTOM = 52 + LOGO_SIZE
const BADGE_HEIGHT = 32
const BADGE_PAD_X = 12
const BADGE_GAP = 8
const BADGE_ROW_GAP = 5
/** The air a block of rows keeps above the grid when it has to be lifted to clear it. */
const BADGE_CLEAR = 4
const BADGE_TEXT_SIZE = 16
const BADGE_RADIUS = 9
/** The room the name has before the wordmark begins. */
const NAME_WIDTH = LOGO_X - 24 - LEFT_PAD

/**
 * The two headline figures - the item level and the Mythic+ rating - and the plates they sit on.
 *
 * They used to stand in the header, past a rule; they now sit strictly under the collection grid,
 * on plates cut from the same frame the grid's tiles are, because the pair is read after the
 * collections the card is opened for. The item level is set in plain white and the rating in the
 * tier its band has reached (`mPlusQualityHex`), the pair of colours the page sets the same two in.
 *
 * `STATS_LABEL_SIZE` is the size of a figure's uppercase label, and a figure is centred on its
 * plate as one group - the glyph stands with the number and is part of the group - so the number
 * sits under the label over it whatever size it is set at.
 */
const STATS_LABEL_SIZE = 15
const STATS_LETTER_SPACING = 1
const STATS_NUMBER_SIZES = [40, 36, 32]
/** The glyph beside a figure is drawn in the number's own colour, at this share of its size. */
const STATS_ICON_RATIO = 0.85
const STATS_ICON_GAP_RATIO = 0.3

/**
 * The band the address line sits in. It is anchored to the card's own foot rather than to a fixed
 * number - the band's bottom edge is `FOOTER_BOTTOM_PAD` above it - and the plates and the grid
 * above the band are measured off it.
 */
const FOOTER_HEIGHT = 32
/** The room the address line keeps under it, so the band is framed by the card's own edge. */
const FOOTER_BOTTOM_PAD = 36
const FOOTER_TOP = CARD_HEIGHT - FOOTER_BOTTOM_PAD - FOOTER_HEIGHT

/**
 * The two plates the headline figures sit on, under the grid: the item level in the left half of
 * the column and the Mythic+ rating in the right, each the full half less the gap between them.
 * `PLATES_TOP` is anchored to the foot band the way the grid is, so the plates, the grid and the
 * band keep their distances to each other. `PLATE_LABEL_Y` and `PLATE_NUMBER_Y` are the baselines
 * of a figure's label and of its number, off the top edge of its plate, and a plate is taller than
 * that pair needs: a figure sits at the top of its plate and the plate runs on below it.
 */
const PLATES_COLUMNS = 2
const PLATES_GAP = 16
const PLATE_WIDTH = (COLUMN_WIDTH - (PLATES_COLUMNS - 1) * PLATES_GAP) / PLATES_COLUMNS
const PLATES_HEIGHT = 84
const PLATES_GAP_BELOW = 14
const PLATES_TOP = FOOTER_TOP - PLATES_GAP_BELOW - PLATES_HEIGHT
const PLATE_RADIUS = 12
const PLATE_LABEL_Y = 28
const PLATE_NUMBER_Y = 64

/**
 * The grid the collection tiles are drawn in: six collections, three across and two down, and
 * a last row that shares the room it has left over, so the block ends on the column's right
 * edge whatever the number of stats rather than leaving a hole where the next tile would have
 * been.
 *
 * `TILE_TOP` is the room the header leaves under it - the header carries the name and the plates
 * of detail now, not the two headline figures - and `TILE_HEIGHT` is the room between the header
 * and the plates split over the rows, so the header, the grid and the plates keep their distances
 * to each other.
 */
const TILE_GAP = 16
const TILE_COLUMNS = 3
const TILE_ROWS = 2
const TILE_TOP = 166
const PLATES_GAP_ABOVE = 12
const TILE_HEIGHT = (PLATES_TOP - PLATES_GAP_ABOVE - TILE_TOP - (TILE_ROWS - 1) * TILE_GAP) / TILE_ROWS

/**
 * The sizes a tile's count is set in. All six counts take the largest one of these that still
 * fits the room a tile has for it, so the numbers are as large as the boxes allow and every
 * tile holds the same size - a grid of numbers set at different sizes would read as an
 * accident, and the count is what the card is read for.
 */
const TILE_NUMBER_SIZES = [64, 60, 56, 52, 48]

function tileNumberSize(values: string[], maxWidth: number): number {
  const size = TILE_NUMBER_SIZES.find(candidate =>
    values.every(value => measuredTextWidth(value, candidate) <= maxWidth)
  )

  return size || TILE_NUMBER_SIZES[TILE_NUMBER_SIZES.length - 1]
}

/**
 * The heading the panel over the tiles and every tile are titled with: the glyph in its
 * rounded box with the uppercase label beside it. One set of measurements for both is what
 * keeps them the same size and weight, and a heading is placed by the left edge of its box
 * and the baseline of its label, so a caller only has to know where its line is set.
 *
 * `HEADING_ICON_GLYPH` sits in `HEADING_ICON_BOX` with the same padding on every side, and
 * `HEADING_CAP_HEIGHT` is the part of the label size a capital rises above the baseline -
 * which is what `headingBoxTop` centres the box on, rather than the label's line box.
 * `HEADING_LETTER_SPACING` is what airs a run of capitals out, and it is part of the width
 * one of them draws at.
 *
 * The label is set one step smaller than the room of a tile would take, because a tile is
 * titled with the name of a collection and the longest of those - achievements - has to sit
 * whole beside the glyph rather than end in an ellipsis.
 */
const HEADING_ICON_BOX = 32
const HEADING_ICON_GLYPH = 24
const HEADING_ICON_GAP = 11
const HEADING_LABEL_SIZE = 20
const HEADING_LETTER_SPACING = 0.8
const HEADING_CAP_HEIGHT = 0.72

/** The top edge of the icon box centred on the cap of a label whose baseline is `baselineY`. */
function headingBoxTop(baselineY: number): number {
  return round2(baselineY - (HEADING_LABEL_SIZE * HEADING_CAP_HEIGHT) / 2 - HEADING_ICON_BOX / 2)
}

/**
 * The label of a heading as it is drawn: uppercased, and cut to the room that is left of the
 * icon box. It is measured rather than guessed at, because a heading is placed by the width it
 * draws at and a label that gets cut has to be measured as it is drawn.
 */
function headingLabel(label: string, width: number): string {
  return fitText(label.toUpperCase(), width - HEADING_ICON_BOX - HEADING_ICON_GAP, HEADING_LABEL_SIZE, (text, size) =>
    measuredTextWidth(text, size, HEADING_LETTER_SPACING)
  )
}

/** One plate of a character's own details, drawn to the right of the name. */
interface Badge {
  text: string
  /** The text's fill: gold for the level, the class colour for the spec and class, the rest grey. */
  color: string
}

/**
 * The character's own details, in the order the header plates them: the level, then the race,
 * then the spec and class as one plate, then the guild and the realm. A detail the character does
 * not have - a guildless character, a spec the API did not send - is left out rather than plated
 * empty, and the spec-and-class plate wears the class's own colour, the way the game prints it.
 */
function characterBadges(data: CharacterData, classColor: string): Badge[] {
  const specClass = [data.spec, data.class].filter(Boolean).join(' ')
  return [
    { text: String(data.level), color: '#f8b700' },
    { text: data.race, color: '#e2e8f0' },
    { text: specClass, color: classColor },
    { text: data.guild ? `<${data.guild}>` : '', color: '#e2e8f0' },
    { text: data.realm, color: '#e2e8f0' }
  ].filter((badge) => badge.text)
}

/**
 * The plates of detail as the header draws them, left to right from the one left guide: each a
 * rounded box with an amber hairline - the frame the character page plates the same details on -
 * sized to the text inside it, with its own colour on that text.
 *
 * A plate that would pass the edge of its row wraps to the row under it, so a long guild name
 * drops to a second row instead of running into the wordmark or the portrait: a row beside the
 * wordmark stops short of it and a row below the wordmark may run to the card's own padding. The
 * rows are then centred on the widest of them, which is what makes two rows read as one block of
 * detail rather than as a line with a remainder under it, and the whole block is lifted when it
 * would reach the grid under it. The text of a plate is the only thing that measures it, so its box
 * never crowds what is written on it.
 */
function badgeFlow(badges: Badge[]): string {
  const baseline = (top: number) => round2(top + BADGE_HEIGHT / 2 + (BADGE_TEXT_SIZE * HEADING_CAP_HEIGHT) / 2)
  const widths = badges.map((badge) => round2(measuredTextWidth(badge.text, BADGE_TEXT_SIZE) + BADGE_PAD_X * 2))
  const rows: { top: number; from: number; to: number; width: number }[] = []

  badges.forEach((badge, index) => {
    const last = rows[rows.length - 1]
    const grown = last ? last.width + BADGE_GAP + widths[index] : widths[index]
    const limit = !last || last.top < BADGE_WORDMARK_BOTTOM ? BADGE_RIGHT_UNDER_WORDMARK : BADGE_RIGHT

    if (last && BADGE_X + grown <= limit) {
      last.to = index
      last.width = grown
      return
    }

    rows.push({
      top: last ? last.top + BADGE_HEIGHT + BADGE_ROW_GAP : BADGE_TOP,
      from: index,
      to: index,
      width: widths[index]
    })
  })

  // A block that would reach into the grid is lifted just far enough to clear it: the header is
  // laid out for the one row a character usually has, and a row of plates running under a tile
  // reads as a mistake rather than as a tighter header.
  const foot = rows.length ? rows[rows.length - 1].top + BADGE_HEIGHT : BADGE_TOP
  const lift = Math.max(0, foot + BADGE_CLEAR - TILE_TOP)
  const widest = rows.reduce((max, row) => Math.max(max, row.width), 0)
  const plates: string[] = []

  for (const row of rows) {
    const top = round2(row.top - lift)
    let x = round2(BADGE_X + (widest - row.width) / 2)
    for (let index = row.from; index <= row.to; index++) {
      plates.push(`<rect x="${round2(x)}" y="${top}" width="${widths[index]}" height="${BADGE_HEIGHT}" rx="${BADGE_RADIUS}" fill="#0b1220" fill-opacity="0.55" stroke="#f59e0b" stroke-opacity="0.5" stroke-width="1.5"/>
  <text x="${round2(x + BADGE_PAD_X)}" y="${baseline(top)}" font-size="${BADGE_TEXT_SIZE}" font-weight="600" fill="${badges[index].color}">${esc(badges[index].text)}</text>`)
      x = round2(x + widths[index] + BADGE_GAP)
    }
  }

  return plates.join('\n  ')
}

/**
 * The width a headline figure draws at: its glyph, the gap and the number. A figure is centred
 * on this rather than placed by its number, which is what puts the number under the label over
 * it, and it is what `buildCardSvg` fits against when it picks the size of the pair.
 */
function statWidth(icon: string, value: string, numberSize: number): number {
  return iconWidth(icon, numberSize * STATS_ICON_RATIO) + numberSize * STATS_ICON_GAP_RATIO + measuredTextWidth(value, numberSize)
}

/**
 * What one tile holds: its heading, the count under it, and the bar along the bottom edge. All of
 * it is measured from the tile's own corner, so a tile is drawn the same at any width in the grid,
 * and the heading keeps its air at the top: `TILE_LABEL_Y` is the baseline of the label and
 * `headingBoxTop` turns it into the icon box drawn above it.
 *
 * `tileNumberY` places the count off that heading rather than off the middle of the room under
 * it: a line of a given size rises `HEADING_CAP_HEIGHT` of its size above the baseline, so the
 * air the count keeps under the icon box is what its baseline is measured from.
 */
const TILE_PAD = 14
const TILE_LABEL_Y = 29
const TILE_BAR_HEIGHT = 8
const TILE_BAR_Y = TILE_HEIGHT - TILE_PAD - TILE_BAR_HEIGHT
/** The air the count keeps under its heading: the icon box's bottom edge to the cap of the number. */
const TILE_NUMBER_GAP = 9

/**
 * The baseline a count of a given size sits on, measured off the heading above it rather than off
 * the middle of the room between the two: the heading and its top padding are placed first - a
 * tile is read by its label before its number - and the count takes the room left above the bar.
 */
function tileNumberY(numberSize: number): number {
  return headingBoxTop(TILE_LABEL_Y) + HEADING_ICON_BOX + TILE_NUMBER_GAP + numberSize * HEADING_CAP_HEIGHT
}

/**
 * The runs of text whose width the card is certain to ask for, listed before it is drawn.
 *
 * `measureBatch` can only draw what it is told about in advance, and what the card asks for is
 * decided as the card is drawn - which size a number ends up at is the very thing being measured
 * - so this is every run of every choice the card may make: both headline numbers and all six
 * counts at each size their box may set them in, and the labels and captions that go beside them.
 *
 * A run the card asks for that is not listed is measured on its own, exactly as all of them were
 * before, so a call site added later costs a rasteriser pass rather than drawing anything wrong.
 */
function measurementPlan(tiles: Tile[], data: CharacterData, L: Record<string, string>, classColor: string): MeasureRequest[] {
  const plan: MeasureRequest[] = []
  const counts = tiles.map(tile => String(tile.count))

  for (const size of TILE_NUMBER_SIZES) {
    for (const count of counts) plan.push({ value: count, size })
  }

  for (const size of STATS_NUMBER_SIZES) {
    plan.push({ value: String(data.ilvl), size })
    plan.push({ value: String(data.mPlusScore), size })
  }

  for (const tile of tiles) {
    plan.push({ value: tile.label.toUpperCase(), size: HEADING_LABEL_SIZE, letterSpacing: HEADING_LETTER_SPACING })
  }

  for (const label of [L.itemLevel, L.mPlus]) {
    plan.push({ value: String(label ?? '').toUpperCase(), size: STATS_LABEL_SIZE, letterSpacing: STATS_LETTER_SPACING })
  }

  // The plates of detail beside the name are measured too: `badgeFlow` sizes each box to its
  // text, so every one of them is a width the card asks for as it is drawn.
  for (const badge of characterBadges(data, classColor)) {
    plan.push({ value: badge.text, size: BADGE_TEXT_SIZE })
  }

  return plan
}

export async function renderCharacterCard(data: CharacterData, locale = 'ru_RU'): Promise<Buffer> {
  await loadIcons()

  const L = LABELS[locale] || LABELS.ru_RU!
  const classColor = classColorHex({ classId: data.classId, class: data.class })

  const [backgroundEl, renderEl] = await Promise.all([
    loadBackground(data.backgroundUrl),
    loadRender(data.renderUrl)
  ])

  /**
   * The six collections in the order the card reads them, each count coloured by the share of
   * its collection that is complete. The ladder is the shared one the page colours the same
   * numbers with (`shared/utils/wow-quality.ts`), so a card and its page agree on every tier.
   */
  const tile = (label: string, icon: string, stat: CharacterStat): Tile => ({
    label,
    icon,
    count: stat.count,
    total: stat.total,
    color: wowQualityHex(stat.count, stat.total)
  })

  const tiles: Tile[] = [
    tile(L.mounts, 'mounts', data.stats.mounts),
    tile(L.pets, 'pets', data.stats.pets),
    tile(L.achievements, 'achievments', data.stats.achievements),
    tile(L.decor, 'decor', data.stats.decor),
    tile(L.reputations, 'exalted-rep', data.stats.reputations),
    tile(L.toys, 'toys', data.stats.toys)
  ]

  // Every width the card is about to ask for, measured in one pass before it is drawn: the number
  // of rasteriser passes is the whole cost of measuring, so they are spent here rather than one
  // per string as the card is laid out.
  await measureBatch(measurementPlan(tiles, data, L, classColor))

  // All six counts are set at one size - the largest that fits a tile's room - and every column
  // of the grid is the same width, so the room is the column less the padding on either side.
  const tileWidth = (COLUMN_WIDTH - (TILE_COLUMNS - 1) * TILE_GAP) / TILE_COLUMNS
  const numberSize = tileNumberSize(tiles.map(tile => String(tile.count)), tileWidth - TILE_PAD * 2)

  /**
   * The grid, drawn row by row. A last row holding fewer tiles than the grid is wide shares
   * the room left over between its tiles, so it ends flush with the column's right edge
   * instead of leaving a hole where the next tile would have been.
   */
  const tilesSvg = Array.from({ length: Math.ceil(tiles.length / TILE_COLUMNS) }, (_, row) => {
    const inRow = tiles.slice(row * TILE_COLUMNS, (row + 1) * TILE_COLUMNS)
    const width = (COLUMN_WIDTH - (inRow.length - 1) * TILE_GAP) / inRow.length
    const y = TILE_TOP + row * (TILE_HEIGHT + TILE_GAP)

    return inRow.map((tile, column) => tileSvg(tile, COLUMN_X + column * (width + TILE_GAP), y, width, numberSize)).join('\n  ')
  }).join('\n  ')

  // The character's own details, as the plates the header prints them on, left to right.
  const badges = characterBadges(data, classColor)
  return buildCardSvg(data, L, classColor, backgroundEl, renderEl, tilesSvg, badges)
}

async function buildCardSvg(
  data: CharacterData,
  L: Record<string, string>,
  classColor: string,
  backgroundEl: string,
  renderEl: string,
  tilesSvg: string,
  badges: Badge[]
): Promise<Buffer> {
  /**
   * A headline figure on its plate: the item level or the Mythic+ rating, set as the page sets
   * them - the uppercase label over the glyph and the number, the whole group centred on the
   * plate. `column` picks the plate's half of the column, and `color` is the number's fill:
   * plain white for the item level, the tier colour for the rating.
   */
  const plateSvg = (icon: string, label: string, value: string, color: string, column: number, numberSize: number) => {
    const left = round2(LEFT_PAD + column * (PLATE_WIDTH + PLATES_GAP))
    const center = round2(left + PLATE_WIDTH / 2)
    const glyphHeight = round2(numberSize * STATS_ICON_RATIO)
    const glyphWidth = round2(iconWidth(icon, glyphHeight))
    const gap = round2(numberSize * STATS_ICON_GAP_RATIO)
    const groupLeft = round2(center - statWidth(icon, value, numberSize) / 2)
    // The label is measured rather than guessed at, so a long one is cut to its own plate
    // instead of running past the plate's edge.
    const caption = fitText(label.toUpperCase(), PLATE_WIDTH - 24, STATS_LABEL_SIZE, (text, size) =>
      measuredTextWidth(text, size, STATS_LETTER_SPACING)
    )

    return `<rect x="${left}" y="${PLATES_TOP}" width="${round2(PLATE_WIDTH)}" height="${PLATES_HEIGHT}" rx="${PLATE_RADIUS}" fill="#05070b" fill-opacity="0.6" stroke="#1e293b" stroke-width="2"/>
  <text x="${center}" y="${round2(PLATES_TOP + PLATE_LABEL_Y)}" font-size="${STATS_LABEL_SIZE}" font-weight="700" letter-spacing="${STATS_LETTER_SPACING}" text-anchor="middle" fill="#94a3b8">${esc(caption)}</text>
  ${iconElement(icon, groupLeft, round2(PLATES_TOP + PLATE_NUMBER_Y - (numberSize * HEADING_CAP_HEIGHT) / 2 - glyphHeight / 2), glyphHeight, color)}
  <text x="${round2(groupLeft + glyphWidth + gap)}" y="${round2(PLATES_TOP + PLATE_NUMBER_Y)}" font-size="${numberSize}" font-weight="700" fill="${color}">${esc(value)}</text>`
  }

  /**
   * Both figures are set at the same size - the largest one that fits either plate - because a
   * pair of numbers set at two sizes reads as an accident.
   */
  const statSize = STATS_NUMBER_SIZES.find(size =>
    statWidth('item-level', String(data.ilvl), size) <= PLATE_WIDTH - 24
    && statWidth('key', String(data.mPlusScore), size) <= PLATE_WIDTH - 24
  ) || STATS_NUMBER_SIZES[STATS_NUMBER_SIZES.length - 1]

  /**
   * A name that does not fit at 46px is set smaller before it is cut. It is the only line of the
   * header - the character's title is not drawn on the card - so it may run to the wordmark before
   * it is set any smaller, and the plates of detail wait on the row under it.
   */
  const nameSize = NAME_SIZES.find(size => textWidth(data.name, size) <= NAME_WIDTH) || NAME_SIZES[NAME_SIZES.length - 1]

  // The plates of detail under the name, left to right, wrapping and centring as they go.
  const badgesSvg = badgeFlow(badges)

  /**
   * The wordmark sits in the top-right corner at twice the height it used to have
   * in the footer (52 instead of 26), so it keeps a 56px margin like the rest of
   * the card. The artwork is 3.45:1, giving a 179.6x52 box. The plain text is
   * kept for a server that cannot read the icon.
   */
  const logotype = iconElement('hoa-logotype', LOGO_X, 52, LOGO_SIZE, '#94a3b8')
    || '<text font-size="26" fill="#94a3b8" x="1144" y="88" text-anchor="end">HeroOfAzeroth</text>'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" font-family="${FONT_FAMILY}">
  <defs>
    <!-- The artwork is a very dark scene, so the shadows are lifted with a gamma
         curve (which keeps the candles from clipping) before the colours are
         pushed. Saturate 1.7 / slope 1.3 is measured to land on the colour of the
         same art on the character page (saturate-[1.5] brightness-[1.45]), where
         no scrim covers the right-hand side. -->
    <filter id="bgPop" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feComponentTransfer>
        <feFuncR type="gamma" amplitude="1" exponent="0.82" offset="0"/>
        <feFuncG type="gamma" amplitude="1" exponent="0.82" offset="0"/>
        <feFuncB type="gamma" amplitude="1" exponent="0.82" offset="0"/>
      </feComponentTransfer>
      <feColorMatrix type="saturate" values="1.7"/>
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.3"/>
        <feFuncG type="linear" slope="1.3"/>
        <feFuncB type="linear" slope="1.3"/>
      </feComponentTransfer>
    </filter>
    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#059669"/>
      <stop offset="1" stop-color="#34d399"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.73" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${classColor}" stop-opacity="0.09"/>
      <stop offset="1" stop-color="${classColor}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#05070b" stop-opacity="0.68"/>
      <stop offset="0.42" stop-color="#05070b" stop-opacity="0.5"/>
      <stop offset="0.55" stop-color="#05070b" stop-opacity="0.28"/>
      <stop offset="0.66" stop-color="#05070b" stop-opacity="0.04"/>
      <stop offset="0.78" stop-color="#05070b" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.4"/>
    </linearGradient>
    <filter id="barGlow" x="-10%" y="-120%" width="120%" height="340%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    <clipPath id="cardClip"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}"/></clipPath>
  </defs>

  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#05070b"/>
  ${backgroundEl ? `<g clip-path="url(#cardClip)">${backgroundEl}</g>` : ''}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#scrim)"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>
  ${renderEl ? `<g clip-path="url(#cardClip)">${renderEl}</g>` : ''}
  <rect y="430" width="${CARD_WIDTH}" height="200" fill="url(#bottomFade)"/>
  <rect x="0" y="0" width="12" height="${CARD_HEIGHT}" fill="${classColor}" fill-opacity="0.9"/>

  <!-- The name is set in plain white and given the whole header, with the character's own details
       as the plates the header prints them on, on the row under it. -->
  <text x="${LEFT_PAD}" y="78" font-size="${nameSize}" font-weight="700" fill="#ffffff">${esc(fitText(data.name, NAME_WIDTH, nameSize))}</text>
  ${badgesSvg}
  ${logotype}

  ${tilesSvg}

  <!-- The two headline figures, strictly under the grid: the item level is a plain white number,
       with no ladder to be read against, and the rating wears the tier its band has reached, off
       the same bands the page colours it with. -->
  ${plateSvg('item-level', L.itemLevel, String(data.ilvl), '#ffffff', 0, statSize)}
  ${plateSvg('key', L.mPlus, String(data.mPlusScore), mPlusQualityHex(data.mPlusScore), 1, statSize)}

  <rect x="${COLUMN_X}" y="${FOOTER_TOP}" width="${COLUMN_WIDTH}" height="${FOOTER_HEIGHT}" rx="10" fill="#05070b" fill-opacity="0.6"/>
  <text x="${COLUMN_X + 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="#94a3b8">heroofazeroth.com</text>
  <text x="${COLUMN_RIGHT - 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="${classColor}" text-anchor="end">${esc(fitText(data.class, 260, 15))}</text>
</svg>`

  return encodeCard(svg)
}
