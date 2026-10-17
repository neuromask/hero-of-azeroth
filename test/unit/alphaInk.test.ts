/**
 * The ink of a picture, read off the pixels a decoder has already produced.
 *
 * The card measures text and finds a character inside Blizzard's canvas by looking at alpha. That used to be done on
 * a PNG - encoded by the rasteriser, then inflated and un-filtered by a hand-written decoder - which was several
 * megabytes of heap and a pass over every pixel for a number this reads straight off the buffer it was given.
 * These tests pin the values, so a card's widths and its crop cannot drift with the reader.
 */
import { describe, expect, it } from 'vitest'
import { inkBandBounds, inkBounds } from '../../server/utils/alphaInk'

/** An RGBA picture of `width` x `height`, transparent except for the box given. */
function rgba(width: number, height: number, box?: { x: number; y: number; w: number; h: number }) {
  const pixels = new Uint8Array(width * height * 4)

  if (box) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) pixels[(y * width + x) * 4 + 3] = 255
    }
  }

  return pixels
}

describe('reading the ink of a picture', () => {
  it('is the box the opaque pixels cover', () => {
    const box = inkBounds(rgba(10, 8, { x: 2, y: 3, w: 4, h: 2 }), 10, 8, { channels: 4 })

    expect(box).toEqual({ width: 10, height: 8, x: 2, y: 3, w: 4, h: 2 })
  })

  it('is nothing at all for a picture with no ink, which is what a failed render looks like', () => {
    expect(inkBounds(rgba(10, 8), 10, 8, { channels: 4 })).toBeNull()
  })

  it('reads a one-channel alpha plane the same way it reads RGBA', () => {
    const plane = new Uint8Array(10 * 8)
    plane[3 * 10 + 2] = 255
    plane[4 * 10 + 5] = 255

    expect(inkBounds(plane, 10, 8, { channels: 1, alphaOffset: 0 })).toEqual({ width: 10, height: 8, x: 2, y: 3, w: 4, h: 2 })
  })

  it('ignores an alpha at or below the threshold, so a soft shadow is not the model', () => {
    const pixels = rgba(6, 4)
    pixels[(1 * 6 + 1) * 4 + 3] = 10
    pixels[(2 * 6 + 4) * 4 + 3] = 200

    expect(inkBounds(pixels, 6, 4, { channels: 4 })?.x).toBe(4)
    expect(inkBounds(pixels, 6, 4, { channels: 4, threshold: 0 })?.w).toBe(4)
  })

  it('measures each band where it lies, and never reads the ink of another band', () => {
    const pixels = rgba(12, 10, { x: 1, y: 1, w: 3, h: 2 })
    pixels[(6 * 12 + 7) * 4 + 3] = 255
    pixels[(7 * 12 + 8) * 4 + 3] = 255

    const bands = inkBandBounds(pixels, 12, 10, { channels: 4 }, [
      { top: 0, height: 4 },
      { top: 5, height: 5 }
    ])

    expect(bands[0]).toMatchObject({ x: 1, y: 1, w: 3, h: 2 })
    expect(bands[1]).toMatchObject({ x: 7, y: 6, w: 2, h: 2 })
  })

  it('is null for a band with nothing in it, which is a run the estimate stands in for', () => {
    const bands = inkBandBounds(rgba(12, 10), 12, 10, { channels: 4 }, [{ top: 0, height: 10 }])

    expect(bands[0]).toBeNull()
  })
})
