import zlib from 'node:zlib'

export interface PngBounds {
  width: number
  height: number
  x: number
  y: number
  w: number
  h: number
}

/** A horizontal strip of an image, measured on its own. */
export interface PngBand {
  top: number
  height: number
}

interface DecodedPng {
  width: number
  height: number
  channels: number
  stride: number
  pixels: Buffer
}

/**
 * Decodes an 8-bit, non-interlaced PNG (RGB or RGBA) to its un-filtered pixels, or null when the
 * image is not one we can decode. What the callers below differ on is only which rows they read,
 * so the decode they share is here.
 */
function decodePng(input: Buffer | ArrayBuffer): DecodedPng | null {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)

  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null

  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []

  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const dataStart = pos + 8

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart)
      height = buf.readUInt32BE(dataStart + 4)
      bitDepth = buf[dataStart + 8] ?? 0
      colorType = buf[dataStart + 9] ?? 0
      interlace = buf[dataStart + 12] ?? 0
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + length))
    } else if (type === 'IEND') {
      break
    }

    pos = dataStart + length + 4
  }

  // Only plain 8-bit RGB/RGBA, non-interlaced images are supported.
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (!channels || !idat.length) return null

  let raw: Buffer
  try {
    raw = zlib.inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }

  const stride = width * channels
  if (raw.length < (stride + 1) * height) return null

  const pixels = Buffer.alloc(height * stride)
  let readPos = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[readPos++]
    const rowOff = y * stride
    const prevOff = rowOff - stride

    for (let x = 0; x < stride; x++) {
      const value = raw[readPos + x]
      const a = x >= channels ? pixels[rowOff + x - channels] : 0
      const b = y > 0 ? pixels[prevOff + x] : 0
      const c = x >= channels && y > 0 ? pixels[prevOff + x - channels] : 0

      let out: number
      switch (filter) {
        case 0:
          out = value
          break
        case 1:
          out = value + a
          break
        case 2:
          out = value + b
          break
        case 3:
          out = value + ((a + b) >> 1)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          out = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          return null
      }

      pixels[rowOff + x] = out & 0xff
    }

    readPos += stride
  }

  return { width, height, channels, stride, pixels }
}

/**
 * The ink of the rows `[fromY, toY)`: the box covered by the pixels above `alphaThreshold` in that
 * strip, in the image's own coordinates, or null when the strip holds nothing.
 */
function scanAlpha(png: DecodedPng, fromY: number, toY: number, alphaThreshold: number): PngBounds | null {
  const { width, height, channels, stride, pixels } = png
  const firstY = Math.max(0, Math.floor(fromY))
  const lastY = Math.min(height, Math.ceil(toY))

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = firstY; y < lastY; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = channels === 4 ? pixels[y * stride + x * channels + 3]! : 255
      if (alpha <= alphaThreshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) return null

  return { width, height, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Computes the bounding box of the non-transparent pixels of an 8-bit, non-interlaced PNG
 * (RGB or RGBA).
 *
 * Blizzard's character renders are 1600x1200 canvases with a lot of empty space around the model,
 * so cropping to this box is what makes the character fill the frame instead of looking tiny.
 *
 * Returns null when the image is not a PNG we can decode, or when it is entirely transparent.
 */
export function pngAlphaBounds(input: Buffer | ArrayBuffer, alphaThreshold = 24): PngBounds | null {
  const png = decodePng(input)

  return png ? scanAlpha(png, 0, png.height, alphaThreshold) : null
}

/**
 * The ink of each of `bands`, read from a single decode of a single image.
 *
 * Text is measured by drawing it and measuring the ink, and what keeps that affordable is drawing
 * every run a card needs in one document - one band each - and decoding that document once. Each
 * band is measured where it lies, so a run reads the same width here as it would have rendered on
 * its own, and the bands never overlap, so neither reads the other's ink.
 */
export function pngAlphaBandBounds(input: Buffer | ArrayBuffer, bands: PngBand[], alphaThreshold = 24): (PngBounds | null)[] {
  const png = decodePng(input)
  if (!png) return bands.map(() => null)

  return bands.map(band => scanAlpha(png, band.top, band.top + band.height, alphaThreshold))
}
