import { Resvg } from '@resvg/resvg-js'
import type { CharacterData } from './blizzard'
import { pngAlphaBounds } from './png'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

/**
 * The type the card is set in: what every `<text>` inherits, and what `measuredTextWidth`
 * renders its probe with, so a width measured there is the width the card draws.
 */
const FONT_FAMILY = 'Segoe UI, Arial, Helvetica, sans-serif'

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

const CLASS_COLORS: Record<string, string> = {
  'Rogue': '#FFF468', 'Разбойник': '#FFF468',
  'Mage': '#3FC7EB', 'Маг': '#3FC7EB',
  'Paladin': '#F48CBA', 'Паладин': '#F48CBA',
  'Warrior': '#C69B6D', 'Воин': '#C69B6D',
  'Warlock': '#8788EE', 'Чернокнижник': '#8788EE',
  'Priest': '#FFFFFF', 'Жрец': '#FFFFFF',
  'Hunter': '#AAD372', 'Охотник': '#AAD372',
  'Druid': '#FF7D0A', 'Друид': '#FF7D0A',
  'Shaman': '#0070DD', 'Шаман': '#0070DD',
  'Monk': '#00FF98', 'Монах': '#00FF98',
  'Demon Hunter': '#A330C9', 'Охотник на демонов': '#A330C9',
  'Death Knight': '#C41E3A', 'Рыцарь смерти': '#C41E3A',
  'Evoker': '#33937F', 'Пробудитель': '#33937F'
}

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
    achievements: 'Achievements',
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

/** Renders a document the way the card is rendered: system fonts, at the card's own width. */
function renderSvg(svg: string): Buffer {
  return new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    fitTo: { mode: 'width', value: CARD_WIDTH }
  }).render().asPng()
}

/**
 * The width a run of text draws at, read back from the renderer that draws the card.
 *
 * `textWidth` above is a guess, and a good enough one to decide how much of a line survives:
 * a heading centred on it, though, lands visibly off, because a run of capitals is up to a
 * fifth wider than its two buckets say. SVG has no text metrics to query, so the run is drawn
 * on its own - in the card's own font, size, weight and letter spacing - and the ink of that
 * render is measured. It is what puts a summary number under the caps of its heading.
 *
 * The probe is a 1200px-wide render of a label, and rendering a card is a hot path, so a
 * width is measured once and kept.
 */
const measuredWidths = new Map<string, number>()

function measuredTextWidth(value: string, fontSize: number, letterSpacing = 0): number {
  const key = `${fontSize}/${letterSpacing}/${value}`
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
  <text x="${round2(x + HEADING_ICON_BOX + HEADING_ICON_GAP)}" y="${round2(y)}" font-size="${HEADING_LABEL_SIZE}" font-weight="700" letter-spacing="${HEADING_LETTER_SPACING}" fill="#e2e8f0">${esc(headingLabel(label, width))}</text>`
}

/** One collection of the tile grid. */
interface Tile {
  label: string
  icon: string
  count: number
  total: number
  color: string
}

/**
 * One tile: its heading, the count centred in the room under it, and the bar along the
 * bottom edge.
 *
 * `numberSize` is the size every tile's count is set at (`tileNumberSize`); it is handed in
 * rather than picked here because all six have to hold the same one, and it is what the count
 * is centred on between the heading and the bar. The count is set in the stat's own colour, the
 * way the page's tiles set theirs, and the bar's fill is the share of the collection that is
 * complete. The tile carries no small print: at this width there is no room for the total and
 * the percentage beside the label, which is what the bar is for.
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
  <text x="${round2(x + width / 2)}" y="${round2(y + tileNumberY(numberSize))}" font-size="${numberSize}" font-weight="700" fill="${tile.color}" text-anchor="middle">${tile.count.toLocaleString('en-US')}</text>
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
 * The header: the name and the title against the left edge, then a rule, and past it the two
 * headline figures - the item level and the Mythic+ rating - with a second rule between them.
 * The wordmark sits in the top-right corner, and the figures are spread over the room that is
 * left of it, one centred in each half, which is how the character page sets the same pair.
 *
 * `STATS_LABEL_Y` and `STATS_NUMBER_Y` are the baselines of a figure's label and of its number.
 * A figure is centred on `STATS_CENTER` as one group - the glyph that stands with the number is
 * part of the group - so the number sits under the label over it whatever size it is set at.
 */
const DIVIDER_X = 372
const NAME_WIDTH = DIVIDER_X - 76
const LOGO_X = 964
const STATS_X = DIVIDER_X + 26
const STATS_RIGHT = LOGO_X - 20
const STATS_WIDTH = STATS_RIGHT - STATS_X
const STATS_COLUMNS = 2
const STATS_COLUMN_WIDTH = STATS_WIDTH / STATS_COLUMNS
const STATS_CENTER = Array.from(
  { length: STATS_COLUMNS },
  (_, column) => STATS_X + STATS_COLUMN_WIDTH * (column + 0.5)
)
const STATS_LABEL_Y = 62
const STATS_LABEL_SIZE = 15
const STATS_LETTER_SPACING = 1
const STATS_NUMBER_Y = 108
const STATS_NUMBER_SIZES = [40, 36, 32]
/** The glyph beside a figure is drawn in the number's own colour, at this share of its size. */
const STATS_ICON_RATIO = 0.85
const STATS_ICON_GAP_RATIO = 0.3

/** Every rule of the card is a two-pixel hairline that fades out at both ends, as `#rule` is. */
const RULE_WIDTH = 2

/**
 * The rule after the name stands the height of the name and the title; the one between the two
 * figures stands the height of a label and a number.
 */
const HEADER_RULE_TOP = 40
const HEADER_RULE_HEIGHT = 92
const STATS_RULE_X = STATS_X + STATS_COLUMN_WIDTH
const STATS_RULE_TOP = STATS_LABEL_Y - STATS_LABEL_SIZE - 3
const STATS_RULE_HEIGHT = STATS_NUMBER_Y + 6 - STATS_RULE_TOP

/**
 * The description under the name: the level, race, spec and class line and, beneath it, the
 * guild and realm line. Both are set off the name's own left edge and measured to end before
 * the portrait.
 */
const DESC_X = 56
const DESC_WIDTH = 660
const DESC_SIZE = 24
const DESC_LINE1_Y = 162
const DESC_LINE2_Y = 198

/** The band the address line sits in. */
const FOOTER_TOP = 572
const FOOTER_HEIGHT = 32

/**
 * The grid the collection tiles are drawn in: six collections, three across and two down, and
 * a last row that shares the room it has left over, so the block ends on the column's right
 * edge whatever the number of stats rather than leaving a hole where the next tile would have
 * been.
 *
 * `TILE_TOP` leaves the gap under the description and `TILE_HEIGHT` is the room between it and
 * the foot band split over the rows, so the description, the grid and the band keep their
 * distances to each other.
 */
const TILE_GAP = 16
const TILE_COLUMNS = 3
const TILE_ROWS = 2
const TILE_TOP = 236
const TILE_HEIGHT = (FOOTER_TOP - TILE_GAP - TILE_TOP - (TILE_ROWS - 1) * TILE_GAP) / TILE_ROWS

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
const HEADING_ICON_GLYPH = 22
const HEADING_ICON_GAP = 11
const HEADING_LABEL_SIZE = 18
const HEADING_LETTER_SPACING = 1
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

/**
 * A rule of the card, drawn down the middle of a column boundary: it fades out at both ends,
 * which is what the `#rule` gradient is for, and `RULE_WIDTH` is what keeps it a hairline.
 */
function ruleSvg(x: number, top: number, height: number): string {
  return `<rect x="${round2(x - RULE_WIDTH / 2)}" y="${round2(top)}" width="${RULE_WIDTH}" height="${round2(height)}" fill="url(#rule)"/>`
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
 * What one tile holds: its heading, the count centred in the room under it, and the bar along
 * the bottom edge. All of it is measured from the tile's own corner, so a tile is drawn the
 * same at any width in the grid.
 *
 * `TILE_NUMBER_CENTER` is the middle of the room between the bottom of the heading's icon box
 * and the top of the bar, and `tileNumberY` turns it into the baseline a count of a given size
 * has to sit on to be centred in that room - a line of that size has a cap height of about
 * 0.72em, so the baseline goes half a cap below the middle.
 */
const TILE_PAD = 14
const TILE_LABEL_Y = 36
const TILE_BAR_HEIGHT = 8
const TILE_BAR_Y = TILE_HEIGHT - TILE_PAD - TILE_BAR_HEIGHT
const TILE_NUMBER_CENTER = round2((headingBoxTop(TILE_LABEL_Y) + HEADING_ICON_BOX + TILE_BAR_Y) / 2)

function tileNumberY(numberSize: number): number {
  return TILE_NUMBER_CENTER + (numberSize * HEADING_CAP_HEIGHT) / 2
}

export async function renderCharacterCard(data: CharacterData, locale = 'ru_RU'): Promise<Buffer> {
  await loadIcons()

  const L = LABELS[locale] || LABELS.ru_RU
  const classColor = CLASS_COLORS[data.class] || '#f8b700'

  const [backgroundEl, renderEl] = await Promise.all([
    loadBackground(data.backgroundUrl),
    loadRender(data.renderUrl)
  ])

  /**
   * The six collections in the order the card reads them, each in the colour its tile has on
   * the character page: the amber the page sets most of them in, the purple of the pets and the
   * gold of the achievements.
   */
  const tiles: Tile[] = [
    { label: L.mounts, icon: 'mounts', count: data.stats.mounts.count, total: data.stats.mounts.total, color: '#f59e0b' },
    { label: L.pets, icon: 'pets', count: data.stats.pets.count, total: data.stats.pets.total, color: '#c084fc' },
    { label: L.achievements, icon: 'achievments', count: data.stats.achievements.count, total: data.stats.achievements.total, color: '#f8b700' },
    { label: L.decor, icon: 'decor', count: data.stats.decor.count, total: data.stats.decor.total, color: '#f59e0b' },
    { label: L.reputations, icon: 'exalted-rep', count: data.stats.reputations.count, total: data.stats.reputations.total, color: '#f59e0b' },
    { label: L.toys, icon: 'toys', count: data.stats.toys.count, total: data.stats.toys.total, color: '#f59e0b' }
  ]

  // All six counts are set at one size - the largest that fits a tile's room - and every column
  // of the grid is the same width, so the room is the column less the padding on either side.
  const tileWidth = (COLUMN_WIDTH - (TILE_COLUMNS - 1) * TILE_GAP) / TILE_COLUMNS
  const numberSize = tileNumberSize(tiles.map(tile => tile.count.toLocaleString('en-US')), tileWidth - TILE_PAD * 2)

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

  // Both lines are measured and cut in `buildCardSvg`, where the boxes they sit in are.
  const metaLine = [data.race, data.spec, data.class].filter(Boolean).join(' · ')
  const guildLine = [data.guild ? `<${data.guild}>` : '', data.realm].filter(Boolean).join(' · ')
  return buildCardSvg(data, L, classColor, backgroundEl, renderEl, tilesSvg, metaLine, guildLine)
}

function buildCardSvg(
  data: CharacterData,
  L: Record<string, string>,
  classColor: string,
  backgroundEl: string,
  renderEl: string,
  tilesSvg: string,
  metaLine: string,
  guildLine: string
): Buffer {
  /**
   * A headline figure of the header: its label in small caps over the number, which is set
   * beside the glyph the page puts with it. The glyph, the gap and the number are centred on
   * the figure's own half of the header as one group, which is what puts the number under the
   * label over it whatever size it is set at.
   */
  const statSvg = (icon: string, label: string, value: string, color: string, column: number, numberSize: number) => {
    const glyphHeight = round2(numberSize * STATS_ICON_RATIO)
    const glyphWidth = round2(iconWidth(icon, glyphHeight))
    const gap = round2(numberSize * STATS_ICON_GAP_RATIO)
    const center = STATS_CENTER[column]
    const left = round2(center - statWidth(icon, value, numberSize) / 2)
    // The label is measured rather than guessed at, so a long one is cut to its own half of
    // the header instead of running into the rule beside it.
    const caption = fitText(label.toUpperCase(), STATS_COLUMN_WIDTH - 16, STATS_LABEL_SIZE, (text, size) =>
      measuredTextWidth(text, size, STATS_LETTER_SPACING)
    )

    return `<text x="${round2(center)}" y="${STATS_LABEL_Y}" font-size="${STATS_LABEL_SIZE}" font-weight="700" letter-spacing="${STATS_LETTER_SPACING}" text-anchor="middle" fill="#94a3b8">${esc(caption)}</text>
  ${iconElement(icon, left, round2(STATS_NUMBER_Y - (numberSize * HEADING_CAP_HEIGHT) / 2 - glyphHeight / 2), glyphHeight, color)}
  <text x="${round2(left + glyphWidth + gap)}" y="${STATS_NUMBER_Y}" font-size="${numberSize}" font-weight="700" fill="${color}">${esc(value)}</text>`
  }

  /**
   * Both figures are set at the same size - the largest one that fits either half - because a
   * pair of numbers set at two sizes reads as an accident.
   */
  const statSize = STATS_NUMBER_SIZES.find(size =>
    statWidth('item-level', String(data.ilvl), size) <= STATS_COLUMN_WIDTH - 16
    && statWidth('key', String(data.mPlusScore), size) <= STATS_COLUMN_WIDTH - 16
  ) || STATS_NUMBER_SIZES[STATS_NUMBER_SIZES.length - 1]

  const levelLine = `${L.level} ${data.level} · ${metaLine}`

  /**
   * A name that does not fit at 46px is set smaller before it is cut, and the title line
   * follows the name down so the two keep their spacing.
   */
  const nameSize = NAME_SIZES.find(size => textWidth(data.name, size) <= NAME_WIDTH) || NAME_SIZES[NAME_SIZES.length - 1]
  const titleSize = nameSize >= 40 ? 21 : 18
  const titleY = 80 + (nameSize >= 40 ? 28 : 24)

  /**
   * The wordmark sits in the top-right corner at twice the height it used to have
   * in the footer (52 instead of 26), so it keeps a 56px margin like the rest of
   * the card. The artwork is 3.45:1, giving a 179.6x52 box. The plain text is
   * kept for a server that cannot read the icon.
   */
  const logotype = iconElement('hoa-logotype', LOGO_X, 52, 52, '#94a3b8')
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
      <stop offset="0" stop-color="#05070b" stop-opacity="0.92"/>
      <stop offset="0.42" stop-color="#05070b" stop-opacity="0.78"/>
      <stop offset="0.55" stop-color="#05070b" stop-opacity="0.36"/>
      <stop offset="0.66" stop-color="#05070b" stop-opacity="0.04"/>
      <stop offset="0.78" stop-color="#05070b" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070b" stop-opacity="0"/>
      <stop offset="1" stop-color="#05070b" stop-opacity="0.4"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#94a3b8" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#94a3b8" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#94a3b8" stop-opacity="0"/>
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
  <rect x="0" y="0" width="6" height="${CARD_HEIGHT}" fill="${classColor}" fill-opacity="0.9"/>

  ${ruleSvg(DIVIDER_X, HEADER_RULE_TOP, HEADER_RULE_HEIGHT)}
  <text x="56" y="80" font-size="${nameSize}" font-weight="700" fill="#f8b700">${esc(fitText(data.name, NAME_WIDTH, nameSize))}</text>
  ${data.title ? `<text x="56" y="${titleY}" font-size="${titleSize}" font-style="italic" fill="#ffe395">${esc(fitText(data.title, NAME_WIDTH, titleSize))}</text>` : ''}
  ${ruleSvg(STATS_RULE_X, STATS_RULE_TOP, STATS_RULE_HEIGHT)}
  ${statSvg('item-level', L.itemLevel, String(data.ilvl), '#c084fc', 0, statSize)}
  ${statSvg('key', L.mPlus, String(data.mPlusScore), '#fbbf24', 1, statSize)}
  ${logotype}

  <text x="${DESC_X}" y="${DESC_LINE1_Y}" font-size="${DESC_SIZE}" fill="#cbd5e1">${esc(fitText(levelLine, DESC_WIDTH, DESC_SIZE))}</text>
  <text x="${DESC_X}" y="${DESC_LINE2_Y}" font-size="${DESC_SIZE}" fill="#94a3b8">${esc(fitText(guildLine, DESC_WIDTH, DESC_SIZE))}</text>

  ${tilesSvg}

  <rect x="${COLUMN_X}" y="${FOOTER_TOP}" width="${COLUMN_WIDTH}" height="${FOOTER_HEIGHT}" rx="10" fill="#05070b" fill-opacity="0.6"/>
  <text x="${COLUMN_X + 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="#94a3b8">heroofazeroth.com</text>
  <text x="${COLUMN_RIGHT - 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="${classColor}" text-anchor="end">${esc(fitText(data.class, 260, 15))}</text>
</svg>`

  return renderSvg(svg)
}
