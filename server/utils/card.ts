import { Resvg } from '@resvg/resvg-js'
import type { CharacterData } from './blizzard'
import { pngAlphaBounds } from './png'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

/** Where the character render is drawn on the card. */
const RENDER_MAX_HEIGHT = 556
const RENDER_MAX_WIDTH = 540
const RENDER_CENTER_X = 872
const RENDER_BASELINE_Y = 610

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

function truncate(value: string, max: number): string {
  const str = String(value ?? '')
  return str.length > max ? `${str.slice(0, max - 1)}…` : str
}

function percent(count: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((count / total) * 100)))
}

function toDataUri(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * Where the icon artwork lives, relative to the project root, plus the files that
 * have already been read: rendering a card is a hot path, so every `<name>.svg`
 * is parsed once and reused.
 */
const ICON_DIR = 'app/assets/icons'
const iconCache = new Map<string, { viewBox: string; ratio: number; body: string } | null>()

/** Reads `<name>.svg` from `~/assets/icons` and strips it down to its shapes. */
function loadIcon(name: string) {
  if (iconCache.has(name)) return iconCache.get(name)!

  // The server normally runs from the project root; the parent directory is tried
  // as well, for a server started from inside `.output`.
  const roots = [process.cwd(), join(process.cwd(), '..')]
  let prepared: { viewBox: string; ratio: number; body: string } | null = null

  for (const root of roots) {
    const file = join(root, ICON_DIR, `${name}.svg`)
    if (!existsSync(file)) continue

    const raw = readFileSync(file, 'utf8')
    const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1] || '0 0 512 512'
    const [, , boxWidth, boxHeight] = viewBox.split(/[\s,]+/).map(Number)

    prepared = {
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
    break
  }

  iconCache.set(name, prepared)
  return prepared
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
 * the alpha bounding box is measured and the image is scaled and offset until
 * the character fills the card instead of being a tiny figure in empty space.
 */
async function loadRender(url: string): Promise<string> {
  if (!url) return ''
  try {
    const image = Buffer.from(await $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' }))
    const bounds = pngAlphaBounds(image)
    const box = bounds || DEFAULT_RENDER_BOX

    const scale = Math.min(RENDER_MAX_HEIGHT / box.h, RENDER_MAX_WIDTH / box.w)
    const drawWidth = SOURCE_WIDTH * scale
    const drawHeight = SOURCE_HEIGHT * scale
    const x = RENDER_CENTER_X - (box.x + box.w / 2) * scale
    const y = RENDER_BASELINE_Y - (box.y + box.h) * scale

    return `<image href="${toDataUri(image, 'image/png')}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${drawWidth.toFixed(2)}" height="${drawHeight.toFixed(2)}" preserveAspectRatio="none"/>`
  } catch {
    return ''
  }
}

export async function renderCharacterCard(data: CharacterData, locale = 'ru_RU'): Promise<Buffer> {
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
    const y = 374 + index * 44
    // The glyph is centred on the cap height of the 17px label beside it.
    const glyph = iconElement(row.icon, 56, y - 16, 19, '#cbd5e1')
    const labelX = glyph ? 84 : 56
    const barW = Math.round((520 * percent(row.count, row.total)) / 100)
    return `${glyph}<text x="${labelX}" y="${y}" font-size="17" fill="#cbd5e1">${esc(row.label)}</text>
  <text x="576" y="${y}" font-size="17" font-weight="700" fill="${row.color}" text-anchor="end">${row.count} / ${row.total}</text>
  <rect x="56" y="${y + 12}" width="520" height="10" rx="5" fill="#121922"/>
  <rect x="56" y="${y + 12}" width="${barW}" height="10" rx="5" fill="url(#barGrad)"/>`
  }).join('\n  ')

  const metaLine = [data.race, data.spec, data.class].filter(Boolean).map(esc).join(' · ')
  const guildLine = [data.guild ? `&lt;${esc(data.guild)}&gt;` : '', esc(data.realm)].filter(Boolean).join(' · ')
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
  /** The three summary headings carry the glyphs the page shows next to them. */
  const glyphFor = (name: string, x: number) => {
    const glyph = iconElement(name, x, 240, 15, '#94a3b8')
    return { glyph, labelX: glyph ? x + 20 : x }
  }
  const achievementsGlyph = glyphFor('achievments', 56)
  const itemLevelGlyph = glyphFor('item-level', 256)
  const mPlusGlyph = glyphFor('key', 432)

  /**
   * The wordmark sits in the top-right corner at twice the height it used to have
   * in the footer (52 instead of 26), so it keeps a 56px margin like the rest of
   * the card. The artwork is 3.45:1, giving a 179.6x52 box. The plain text is
   * kept for a server that cannot read the icon.
   */
  const logotype = iconElement('hoa-logotype', 964, 52, 52, '#94a3b8')
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
    <clipPath id="cardClip"><rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}"/></clipPath>
  </defs>

  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#05070b"/>
  ${backgroundEl ? `<g clip-path="url(#cardClip)">${backgroundEl}</g>` : ''}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#scrim)"/>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>
  ${renderEl ? `<g clip-path="url(#cardClip)">${renderEl}</g>` : ''}
  <rect y="430" width="${CARD_WIDTH}" height="200" fill="url(#bottomFade)"/>
  <rect x="0" y="0" width="6" height="${CARD_HEIGHT}" fill="${classColor}" fill-opacity="0.9"/>

  <text x="56" y="96" font-size="46" font-weight="700" fill="#f8b700">${esc(truncate(data.name, 22))}</text>
  ${data.title ? `<text x="56" y="132" font-size="21" font-style="italic" fill="#ffe395">${esc(truncate(data.title, 40))}</text>` : ''}
  <text x="56" y="170" font-size="20" fill="#cbd5e1">${esc(L.level)} ${data.level} · ${metaLine}</text>
  <text x="56" y="198" font-size="18" fill="#94a3b8">${guildLine}</text>
  ${logotype}

  ${achievementsGlyph.glyph}<text x="${achievementsGlyph.labelX}" y="252" font-size="13" fill="#94a3b8">${esc(L.achievements)}</text>
  <text x="56" y="292" font-size="30" font-weight="700" fill="#f8b700">${data.ap.toLocaleString('en-US')}</text>
  ${itemLevelGlyph.glyph}<text x="${itemLevelGlyph.labelX}" y="252" font-size="13" fill="#94a3b8">${esc(L.itemLevel)}</text>
  <text x="256" y="292" font-size="30" font-weight="700" fill="#c084fc">${data.ilvl}</text>
  ${mPlusGlyph.glyph}<text x="${mPlusGlyph.labelX}" y="252" font-size="13" fill="#94a3b8">${esc(L.mPlus)}</text>
  <text x="432" y="292" font-size="30" font-weight="700" fill="#fbbf24">${data.mPlusScore}</text>

  ${rowsSvg}

  <rect x="56" y="602" width="520" height="2" fill="#1e293b"/>
  <text x="56" y="620" font-size="15" fill="#94a3b8">heroofazeroth.com</text>
  <text x="576" y="620" font-size="14" fill="${classColor}" text-anchor="end">${esc(data.class)}</text>
</svg>`

  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    fitTo: { mode: 'width', value: 1200 }
  })

  return resvg.render().asPng()
}
