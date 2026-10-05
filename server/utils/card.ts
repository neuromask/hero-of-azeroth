import { Resvg } from '@resvg/resvg-js'
import type { CharacterData } from './blizzard'
import { pngAlphaBounds } from './png'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

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
    achievements: 'Очки достижений',
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
 */
function fitText(value: unknown, maxWidth: number, fontSize: number): string {
  const text = String(value ?? '')
  if (textWidth(text, fontSize) <= maxWidth) return text

  let kept = ''

  for (const char of text) {
    if (textWidth(`${kept}${char}…`, fontSize) > maxWidth) break
    kept += char
  }

  return `${kept}…`
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
 * The left column: the three summary numbers on a panel, the five ladders beneath it and
 * the foot band with the address. The ladders are what the card is read for, so they take
 * the room the portrait leaves over - a bar runs the full width of the column - and the
 * panel and the band are inset from the column's edges.
 */
const COLUMN_X = 44
const COLUMN_WIDTH = 712
const COLUMN_RIGHT = COLUMN_X + COLUMN_WIDTH
const COLUMN_PAD = 12

/**
 * Where the first ladder sits, the height of each step, and the height of a bar.
 *
 * A rung is one unit: its label and its number ride `LADDER_LABEL_DROP` below the top of
 * the step and its bar sits `LADDER_BAR_DROP` further down. The two offsets are what tie
 * a label to the bar it belongs to - a label left at the step top reads as a heading of
 * the bar above it, since that is where the gap between two rungs puts it - and the bar
 * was given the room the drop freed.
 */
const LADDER_TOP = 300
const LADDER_STEP = 54
const LADDER_LABEL_DROP = 8
const LADDER_BAR_DROP = 18
const LADDER_BAR_HEIGHT = 12

/** The three summary numbers, one x each, spread over the panel. */
const SUMMARY_X = [76, 312, 548] as const

/**
 * The panel holds a heading with its glyph and the number under it, and the pair is
 * centred in the panel as one block: `SUMMARY_LABEL_Y` and `SUMMARY_NUMBER_Y` are the
 * distances from `PANEL_TOP` to the two baselines of that block.
 */
const SUMMARY_GLYPH_Y = 25
const SUMMARY_LABEL_Y = 38
const SUMMARY_NUMBER_Y = 88

/**
 * The header: the name and the title stand on the left of a vertical rule, the level,
 * race, spec and class line plus the guild across from the wordmark on the right. Both
 * boxes are measured to end before what follows them.
 */
const DIVIDER_X = 372
const NAME_WIDTH = DIVIDER_X - 76
const META_X = DIVIDER_X + 26
const LOGO_X = 964
const META_WIDTH = LOGO_X - 20 - META_X

/** The panel the summary numbers sit on, and the band the address line sits in. */
const PANEL_TOP = 154
const PANEL_HEIGHT = 114
const FOOTER_TOP = 572
const FOOTER_HEIGHT = 32

/** The width of a ladder bar, and of the text line above it. */
const BAR_X = COLUMN_X + COLUMN_PAD
const BAR_WIDTH = COLUMN_WIDTH - 2 * COLUMN_PAD

export async function renderCharacterCard(data: CharacterData, locale = 'ru_RU'): Promise<Buffer> {
  await loadIcons()

  const L = LABELS[locale] || LABELS.ru_RU
  const classColor = CLASS_COLORS[data.class] || '#f8b700'

  const [backgroundEl, renderEl] = await Promise.all([
    loadBackground(data.backgroundUrl),
    loadRender(data.renderUrl)
  ])

  const rows = [
    { label: L.mounts, icon: 'mounts', count: data.stats.mounts.count, total: data.stats.mounts.total, color: '#f59e0b' },
    { label: L.pets, icon: 'pets', count: data.stats.pets.count, total: data.stats.pets.total, color: '#a78bfa' },
    { label: L.toys, icon: 'toys', count: data.stats.toys.count, total: data.stats.toys.total, color: '#38bdf8' },
    { label: L.decor, icon: 'decor', count: data.stats.decor.count, total: data.stats.decor.total, color: '#fbbf24' },
    { label: L.reputations, icon: 'exalted-rep', count: data.stats.reputations.count, total: data.stats.reputations.total, color: '#34d399' }
  ]

  const rowsSvg = rows.map((row, index) => {
    const y = LADDER_TOP + index * LADDER_STEP
    const labelY = y + LADDER_LABEL_DROP
    const barY = y + LADDER_BAR_DROP
    // The glyph is centred on the cap height of the 19px label beside it.
    const glyph = iconElement(row.icon, BAR_X, labelY - 17, 21, '#cbd5e1')
    const labelX = glyph ? BAR_X + 30 : BAR_X
    const barW = Math.round((BAR_WIDTH * percent(row.count, row.total)) / 100)
    // The dark track, then the filled part twice: blurred underneath for the bloom the bars
    // have on the page, and crisp on top of it so the fill keeps its edges.
    return `${glyph}<text x="${labelX}" y="${labelY}" font-size="19" fill="#cbd5e1">${esc(row.label)}</text>
  <text x="${COLUMN_RIGHT - COLUMN_PAD}" y="${labelY}" font-size="21" font-weight="700" fill="${row.color}" text-anchor="end">${row.count} / ${row.total}</text>
  <rect x="${BAR_X}" y="${barY}" width="${BAR_WIDTH}" height="${LADDER_BAR_HEIGHT}" rx="7" fill="#121922"/>
  <rect x="${BAR_X}" y="${barY}" width="${barW}" height="${LADDER_BAR_HEIGHT}" rx="7" fill="url(#barGrad)" filter="url(#barGlow)"/>
  <rect x="${BAR_X}" y="${barY}" width="${barW}" height="${LADDER_BAR_HEIGHT}" rx="7" fill="url(#barGrad)"/>`
  }).join('\n  ')

  // Both lines are measured and cut in `buildCardSvg`, where the boxes they sit in are.
  const metaLine = [data.race, data.spec, data.class].filter(Boolean).join(' · ')
  const guildLine = [data.guild ? `<${data.guild}>` : '', data.realm].filter(Boolean).join(' · ')
  return buildCardSvg(data, L, classColor, backgroundEl, renderEl, rowsSvg, metaLine, guildLine)
}

function buildCardSvg(
  data: CharacterData,
  L: Record<string, string>,
  classColor: string,
  backgroundEl: string,
  renderEl: string,
  rowsSvg: string,
  metaLine: string,
  guildLine: string
): Buffer {
  /**
   * The summary headings carry the glyphs the page shows next to them, on the panel
   * that lifts the three numbers off the artwork behind.
   */
  const glyphFor = (name: string, x: number) => {
    const glyph = iconElement(name, x, PANEL_TOP + SUMMARY_GLYPH_Y, 16, '#94a3b8')
    return { glyph, labelX: glyph ? x + 22 : x }
  }
  const achievementsGlyph = glyphFor('achievments', SUMMARY_X[0])
  const itemLevelGlyph = glyphFor('item-level', SUMMARY_X[1])
  const mPlusGlyph = glyphFor('key', SUMMARY_X[2])
  const levelLine = `${L.level} ${data.level} · ${metaLine}`

  /**
   * A name that does not fit at 46px is set smaller before it is cut, and the title line
   * follows the name down so the two keep their spacing.
   */
  const nameSize = NAME_SIZES.find(size => textWidth(data.name, size) <= NAME_WIDTH) || NAME_SIZES[NAME_SIZES.length - 1]
  const titleSize = nameSize >= 40 ? 21 : 18

  /**
   * The wordmark sits in the top-right corner at twice the height it used to have
   * in the footer (52 instead of 26), so it keeps a 56px margin like the rest of
   * the card. The artwork is 3.45:1, giving a 179.6x52 box. The plain text is
   * kept for a server that cannot read the icon.
   */
  const logotype = iconElement('hoa-logotype', LOGO_X, 52, 52, '#94a3b8')
    || '<text font-size="26" fill="#94a3b8" x="1144" y="88" text-anchor="end">HeroOfAzeroth</text>'

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" font-family="Segoe UI, Arial, Helvetica, sans-serif">
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

  <rect x="${DIVIDER_X}" y="42" width="2" height="86" fill="url(#rule)"/>
  <text x="56" y="80" font-size="${nameSize}" font-weight="700" fill="#f8b700">${esc(fitText(data.name, NAME_WIDTH, nameSize))}</text>
  ${data.title ? `<text x="56" y="108" font-size="${titleSize}" font-style="italic" fill="#ffe395">${esc(fitText(data.title, NAME_WIDTH, titleSize))}</text>` : ''}
  <text x="${META_X}" y="70" font-size="20" fill="#cbd5e1">${esc(fitText(levelLine, META_WIDTH, 19))}</text>
  <text x="${META_X}" y="104" font-size="20" fill="#94a3b8">${esc(fitText(guildLine, META_WIDTH, 17))}</text>
  ${logotype}

  <rect x="${COLUMN_X}" y="${PANEL_TOP}" width="${COLUMN_WIDTH}" height="${PANEL_HEIGHT}" rx="14" fill="#05070b" fill-opacity="0.6" stroke="#1e293b" stroke-width="2"/>
  ${achievementsGlyph.glyph}<text x="${achievementsGlyph.labelX}" y="${PANEL_TOP + SUMMARY_LABEL_Y}" font-size="16" fill="#94a3b8">${esc(L.achievements)}</text>
  <text x="${SUMMARY_X[0]}" y="${PANEL_TOP + SUMMARY_NUMBER_Y}" font-size="40" font-weight="700" fill="#f8b700">${data.ap.toLocaleString('en-US')}</text>
  ${itemLevelGlyph.glyph}<text x="${itemLevelGlyph.labelX}" y="${PANEL_TOP + SUMMARY_LABEL_Y}" font-size="16" fill="#94a3b8">${esc(L.itemLevel)}</text>
  <text x="${SUMMARY_X[1]}" y="${PANEL_TOP + SUMMARY_NUMBER_Y}" font-size="40" font-weight="700" fill="#c084fc">${data.ilvl}</text>
  ${mPlusGlyph.glyph}<text x="${mPlusGlyph.labelX}" y="${PANEL_TOP + SUMMARY_LABEL_Y}" font-size="16" fill="#94a3b8">${esc(L.mPlus)}</text>
  <text x="${SUMMARY_X[2]}" y="${PANEL_TOP + SUMMARY_NUMBER_Y}" font-size="40" font-weight="700" fill="#fbbf24">${data.mPlusScore}</text>

  ${rowsSvg}

  <rect x="${COLUMN_X}" y="${FOOTER_TOP}" width="${COLUMN_WIDTH}" height="${FOOTER_HEIGHT}" rx="10" fill="#05070b" fill-opacity="0.6"/>
  <text x="${COLUMN_X + 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="#94a3b8">heroofazeroth.com</text>
  <text x="${COLUMN_RIGHT - 20}" y="${FOOTER_TOP + 21}" font-size="15" fill="${classColor}" text-anchor="end">${esc(fitText(data.class, 260, 15))}</text>
</svg>`

  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    fitTo: { mode: 'width', value: 1200 }
  })

  return resvg.render().asPng()
}
