/**
 * The sitemap index: written once per character, and only again when something changed.
 *
 * `rememberCharacter` feeds the index on every profile view. The write used to happen on every one of
 * those views - the whole JSON read back, one record rebuilt, the whole JSON written out again - even
 * when a character a reader had already opened had not changed a single figure. The skip below pins the
 * rule that replaced it: a record that already says everything the profile does is left alone, while a
 * changed figure is written down.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlizzardRegion } from '../../server/utils/params'

let dir = ''
const writeFileSpy = vi.fn()
const renameSpy = vi.fn()

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      writeFileSpy(...args)
      return actual.writeFile(...args)
    },
    rename: (...args: Parameters<typeof actual.rename>) => {
      renameSpy(...args)
      return actual.rename(...args)
    }
  }
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hoa-index-'))
  process.env.NUXT_DATA_DIR = dir
  vi.resetModules()
  writeFileSpy.mockClear()
  renameSpy.mockClear()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.NUXT_DATA_DIR
})

describe('rememberCharacter', () => {
  const character: { region: BlizzardRegion; realm: string; name: string; level?: number; ilvl?: number } = {
    region: 'eu',
    realm: 'gordunni',
    name: 'neuromask',
    level: 80,
    ilvl: 600
  }

  it('writes a new character once, and does not rewrite it unchanged', async () => {
    const { rememberCharacter } = await import('../../server/utils/characterIndex')

    await rememberCharacter(character)
    expect(writeFileSpy).toHaveBeenCalledTimes(1)

    await rememberCharacter(character)
    expect(writeFileSpy).toHaveBeenCalledTimes(1)
  })

  it('writes again when a figure changed', async () => {
    const { rememberCharacter } = await import('../../server/utils/characterIndex')

    await rememberCharacter(character)
    await rememberCharacter({ ...character, level: 81 })

    expect(writeFileSpy).toHaveBeenCalledTimes(2)
  })
})
