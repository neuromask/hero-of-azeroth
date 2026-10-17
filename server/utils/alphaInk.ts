/**
 * The ink of a picture, read off the pixels a decoder has already produced.
 *
 * The card measures text by drawing it, and finds a character render inside Blizzard's 1600x1200 canvas by looking
 * at where its alpha is - in both cases the pixels are *already* there: the rasteriser hands its own RGBA back
 * (`RenderedImage#pixels`) and `sharp` extracts an alpha channel. This used to go through a PNG (`asPng`, then a
 * hand-written decoder: an inflate of the whole image, an un-filter of every row and a second buffer of the same
 * size) which was several megabytes of heap per pass and a second over every pixel, for a number this can read
 * straight off the buffer it was given.
 *
 * The three arguments that matter are the *layout*: how many bytes a pixel takes (`channels`) and at which of them
 * its alpha sits (`alphaOffset`, `0` for a one-channel plane). Blizzard's renders are RGBA, an extracted channel is
 * one byte, and both are read here.
 */
export interface InkBounds {
  /** The width and height of the picture the ink was read from, in its own pixels. */
  width: number
  height: number
  /** The box the ink covers, in the picture's own pixels. */
  x: number
  y: number
  w: number
  h: number
}

export interface InkLayout {
  /** Bytes per pixel: 4 for RGBA, 1 for an alpha plane. */
  channels: number
  /** Which byte of a pixel is its alpha. */
  alphaOffset?: number
  /** An alpha at or below this is empty canvas. */
  threshold?: number
}

/** The ink of the rows `[fromY, toY)`, or `null` when that strip holds none. */
export function inkBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  layout: InkLayout,
  fromY = 0,
  toY = height
): InkBounds | null {
  const { channels, alphaOffset = channels - 1, threshold = 24 } = layout
  const stride = width * channels
  const firstY = Math.max(0, Math.floor(fromY))
  const lastY = Math.min(height, Math.ceil(toY))

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = firstY; y < lastY; y++) {
    const row = y * stride

    for (let x = 0; x < width; x++) {
      if (pixels[row + x * channels + alphaOffset]! <= threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) return null

  return { width, height, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** A horizontal strip of a picture, measured on its own. */
export interface InkBand {
  top: number
  height: number
}

/**
 * The ink of each of `bands`, read from a single pass over the pixels.
 *
 * Text is measured by drawing every run a card needs in one document - one band each - so that one rasteriser pass
 * answers all of them. Each band is measured where it lies, so a run reads the same width here as it would have
 * rendered on its own, and the bands never overlap, so neither reads the other's ink.
 */
export function inkBandBounds(
  pixels: Uint8Array,
  width: number,
  height: number,
  layout: InkLayout,
  bands: InkBand[]
): (InkBounds | null)[] {
  return bands.map((band) => inkBounds(pixels, width, height, layout, band.top, band.top + band.height))
}
