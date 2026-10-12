/**
 * The collections summary: one count per shelf, and the numbers a reader is shown.
 *
 * Two rules matter here and neither is cosmetic. A shelf counts each item **once**, however many
 * groups the atlas files it under, so a summary and the shelf it summarises must print the same pair
 * of figures (that agreement is a promise the comments make, and it is asserted below). And an
 * account-wide shelf is counted **without the faction filter**, because an account plays both sides -
 * so flipping that reading can only grow a total, never shrink it.
 */
import { describe, expect, it } from 'vitest'
import { buildCollectionPage, buildCollectionSummary } from '../../server/utils/collections'
import { COLLECTION_KINDS, type CollectionKind } from '../../shared/data/collectionsSchema'

function emptyByKind(): Record<CollectionKind, Set<number>> {
  return Object.fromEntries(COLLECTION_KINDS.map((kind) => [kind, new Set<number>()])) as Record<CollectionKind, Set<number>>
}

describe('buildCollectionSummary', () => {
  it('counts every shelf, and its own total is the shelves added up', () => {
    const summary = buildCollectionSummary('en_US', emptyByKind())

    expect(summary.shelves).toHaveLength(COLLECTION_KINDS.length)
    expect(summary.collected).toBe(0)
    expect(summary.total).toBeGreaterThan(0)
    expect(summary.total).toBe(summary.shelves.reduce((sum, shelf) => sum + shelf.total, 0))
    expect(summary.collected).toBe(summary.shelves.reduce((sum, shelf) => sum + shelf.collected, 0))
  })

  it('never reports a shelf as more complete than it is', () => {
    for (const shelf of buildCollectionSummary('en_US', emptyByKind()).shelves) {
      expect(shelf.collected).toBeLessThanOrEqual(shelf.total)
      expect(shelf.percent).toBe(shelf.total ? Math.round((shelf.collected / shelf.total) * 100) : 0)
      expect(shelf.percent).toBeLessThanOrEqual(100)
    }
  })

  it('agrees with the shelf it summarises on every count (one item counted once)', () => {
    for (const shelf of buildCollectionSummary('en_US', emptyByKind()).shelves) {
      const page = buildCollectionPage(shelf.kind, 'en_US', 'eu', new Set<number>(), null, {} as never)
      expect(page.total).toBe(shelf.total)
      expect(page.collected).toBe(shelf.collected)
    }
  })

  it('counts an account-wide shelf without a faction, so its total can only grow', () => {
    const character = buildCollectionSummary('en_US', emptyByKind(), 'HORDE')
    const account = buildCollectionSummary('en_US', emptyByKind(), 'HORDE', new Set<CollectionKind>(['mounts']))

    const characterMounts = character.shelves.find((shelf) => shelf.kind === 'mounts')!
    const accountMounts = account.shelves.find((shelf) => shelf.kind === 'mounts')!

    expect(accountMounts.total).toBeGreaterThanOrEqual(characterMounts.total)
    expect(accountMounts.account).toBe(true)
    expect(characterMounts.account).toBe(false)
    expect(account.account).toBe(true)
    expect(character.account).toBe(false)
  })
})
