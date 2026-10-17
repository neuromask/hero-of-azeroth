/**
 * What a profile read keeps of the Blizzard documents it fetched: ids, never the documents.
 *
 * The collection documents are megabytes, and used to be held whole for every character read - which is how a few
 * visitors walked the process into its memory limit. A shelf wants the ids of what a character collected and the
 * journal wants a standing per faction, so that is all `rememberCharacterDocs` keeps; these tests pin that the
 * follow-up reads still get exactly what the document would have given them.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearCharacterDocs,
  recallCollectedIds,
  recallReputations,
  rememberCharacterDocs
} from '../../server/utils/blizzard'

beforeEach(() => {
  clearCharacterDocs()
})

const many = (count: number, wrap: (id: number) => unknown) => Array.from({ length: count }, (_, i) => wrap(i + 1))

describe('the documents a profile read files', () => {
  it('give a shelf the ids of every collection, exactly as the document named them', () => {
    rememberCharacterDocs('eu', 'gordunni', 'Neuromask', 'en_US', {
      mounts: { mounts: many(5, (id) => ({ mount: { id }, is_favorite: true, junk: 'x'.repeat(1000) })) },
      pets: { pets: [{ species: { id: 7 } }, { species: { id: 7 } }, { species: { id: 9 } }] },
      toys: { toys: many(3, (id) => ({ toy: { id } })) },
      decor: { decor_collected: many(2, (id) => ({ decor: { id } })) }
    })

    expect([...recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'mounts')!]).toEqual([1, 2, 3, 4, 5])
    expect([...recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'pets')!].sort()).toEqual([7, 9])
    expect(recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'toys')!.size).toBe(3)
    expect(recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'decor')!.size).toBe(2)
  })

  it('keep a standing per faction and nothing else of the reputations document', () => {
    rememberCharacterDocs('eu', 'gordunni', 'neuromask', 'en_US', {
      reputations: {
        reputations: [
          { faction: { id: 1, name: 'Heavy' }, standing: { tier: 7, raw: 42000, value: 999, max: 1000, name: 'Exalted', links: ['x'] } },
          { faction: { id: 2 }, standing: { renown_level: 12, raw: 5, value: 5, max: 2500, name: 'Renown 12' } },
          { faction: {}, standing: { tier: 1 } }
        ]
      }
    })

    const slim = recallReputations('eu', 'gordunni', 'neuromask', 'en_US')!.reputations

    expect(slim.map((entry) => entry.faction.id)).toEqual([1, 2])
    expect(slim[0]!.standing).toEqual({ tier: 7, raw: 42000, value: 999, max: 1000, name: 'Exalted' })
    expect(slim[1]!.standing.renown_level).toBe(12)
    expect(JSON.stringify(slim)).not.toContain('Heavy')
  })

  it('weigh kilobytes where the documents weighed megabytes', () => {
    const pets = { pets: many(50_000, (id) => ({ species: { id }, name: 'A pet with a long name', stats: { health: 1, power: 2 } })) }
    const documentBytes = JSON.stringify(pets).length

    rememberCharacterDocs('eu', 'gordunni', 'neuromask', 'en_US', { pets })
    const ids = recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'pets')!

    expect(ids.size).toBe(50_000)
    // Four bytes an id against the ~100 the document spent on each.
    expect(documentBytes / (ids.size * 4)).toBeGreaterThan(20)
  })

  it('leave an earlier filing in place for a document this read could not get', () => {
    rememberCharacterDocs('eu', 'gordunni', 'neuromask', 'en_US', { mounts: { mounts: [{ mount: { id: 1 } }] } })
    rememberCharacterDocs('eu', 'gordunni', 'neuromask', 'en_US', { pets: { pets: [{ species: { id: 2 } }] }, mounts: null })

    expect(recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'mounts')!.size).toBe(1)
    expect(recallCollectedIds('eu', 'gordunni', 'neuromask', 'en_US', 'pets')!.size).toBe(1)
  })

  it('answer nothing for a character that was never read, or read in another language', () => {
    rememberCharacterDocs('eu', 'gordunni', 'neuromask', 'en_US', { toys: { toys: [{ toy: { id: 1 } }] } })

    expect(recallCollectedIds('eu', 'gordunni', 'someone', 'en_US', 'toys')).toBeUndefined()
    expect(recallCollectedIds('eu', 'gordunni', 'neuromask', 'ru_RU', 'toys')).toBeUndefined()
    expect(recallReputations('eu', 'gordunni', 'neuromask', 'en_US')).toBeUndefined()
  })
})
