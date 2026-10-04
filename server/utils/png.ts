import zlib from 'node:zlib'

export interface PngBounds {
  width: number
  height: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * Computes the bounding box of the non-transparent pixels of an 8-bit,
 * non-interlaced PNG (RGB or RGBA).
 *
 * Blizzard's character renders are 1600x1200 canvases with a lot of empty
 * space around the model, so cropping to this box is what makes the character
 * fill the frame instead of looking tiny.
 *
 * Returns null when the image is not a PNG we can decode.
 */
export function pngAlphaBounds(input: Buffer | ArrayBuffer, alphaThreshold = 24): PngBounds | null {
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

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
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
