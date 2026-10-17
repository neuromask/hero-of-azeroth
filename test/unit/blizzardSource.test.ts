/**
 * Which chain asked for which call - the one thing the counters could not say.
 *
 * The wrapper sees a URL and nothing else, so the "why" has to travel with the call chain (`AsyncLocalStorage`).
 * These tests pin the four properties that make that trustworthy: the tag survives awaits, a nested tag is
 * restored afterwards, two concurrent chains never see each other's tag, and an unknown tag becomes `other`
 * rather than being stored as whatever a caller passed.
 */
import { describe, expect, it } from 'vitest'
import { characterReadSource, currentBlizzardSource, runWithBlizzardSource } from '../../server/utils/blizzardSource'
import { BLIZZARD_SOURCES, type BlizzardSource } from '../../shared/data/adminDiagnostics'

const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the source of a Blizzard call', () => {
  it('is `other` when nothing has tagged the call chain', () => {
    expect(currentBlizzardSource()).toBe('other')
  })

  it('is the tag its entry point set, and it survives an await', async () => {
    const seen: BlizzardSource[] = []

    await runWithBlizzardSource('profile_read', async () => {
      seen.push(currentBlizzardSource())
      await pause()
      seen.push(currentBlizzardSource())
    })

    expect(seen).toEqual(['profile_read', 'profile_read'])
    // And the chain that set it is over: nothing leaks into whatever runs next.
    expect(currentBlizzardSource()).toBe('other')
  })

  it('is replaced inside a nested run, and restored after it', async () => {
    const seen: BlizzardSource[] = []

    await runWithBlizzardSource('account_refresh', async () => {
      seen.push(currentBlizzardSource())
      await runWithBlizzardSource('card_render', async () => {
        seen.push(currentBlizzardSource())
      })
      seen.push(currentBlizzardSource())
    })

    expect(seen).toEqual(['account_refresh', 'card_render', 'account_refresh'])
  })

  it('belongs to the call chain, so two concurrent reads never see each other', async () => {
    const seen: string[] = []

    async function read(source: BlizzardSource, wait: number): Promise<void> {
      await runWithBlizzardSource(source, async () => {
        await pause(wait)
        seen.push(`${source}=${currentBlizzardSource()}`)
        await pause(wait)
        seen.push(`${source}=${currentBlizzardSource()}`)
      })
    }

    // Interleaved on purpose: the second one finishes its first leg while the first is still waiting.
    await Promise.all([read('profile_read', 4), read('background_scan', 1)])

    expect(seen).toEqual([
      'background_scan=background_scan',
      'profile_read=profile_read',
      'background_scan=background_scan',
      'profile_read=profile_read'
    ])
  })

  it('files a tag it does not know as `other`, rather than storing what arrived', () => {
    runWithBlizzardSource('<script>', () => {
      expect(currentBlizzardSource()).toBe('other')
    })
  })

  it('tells the reader’s own Refresh from a page view', () => {
    expect(characterReadSource(false)).toBe('profile_read')
    expect(characterReadSource(true)).toBe('profile_refresh')
    // Both are categories the panel knows: a source the report cannot draw would be a row nobody sees.
    for (const source of [characterReadSource(false), characterReadSource(true)]) {
      expect(BLIZZARD_SOURCES).toContain(source)
    }
  })
})
