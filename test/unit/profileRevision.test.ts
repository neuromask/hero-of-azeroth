/**
 * The per-character stamp that invalidates the shelf caches on a manual Refresh.
 *
 * `?force=true` on the character endpoint re-reads Blizzard and stores the fresh copy, and every shelf
 * (collections, achievements, reputations) keys its own SWR store by the character's address. Without the
 * stamp a Refresh would leave those shelves answering from copies up to two hours old. These tests pin the
 * stamp: it starts at nought, moves one per forced read, is spelled without case, and does not bleed between
 * characters.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { bumpProfileRevision, clearProfileRevisions, profileRevision } from '../../server/utils/profileRevision'

describe('profileRevision', () => {
  beforeEach(() => {
    clearProfileRevisions()
  })

  it('starts at 0 and moves one per forced read', () => {
    expect(profileRevision('eu', 'gordunni', 'neuromask')).toBe(0)

    bumpProfileRevision('eu', 'gordunni', 'neuromask')
    expect(profileRevision('eu', 'gordunni', 'neuromask')).toBe(1)

    bumpProfileRevision('eu', 'gordunni', 'neuromask')
    expect(profileRevision('eu', 'gordunni', 'neuromask')).toBe(2)
  })

  it('spells the character without case, so the endpoint and the shelf agree', () => {
    bumpProfileRevision('eu', 'Gordunni', 'NeuroMask')
    expect(profileRevision('eu', 'gordunni', 'neuromask')).toBe(1)
  })

  it('does not bleed one character into another', () => {
    bumpProfileRevision('eu', 'gordunni', 'alpha')
    bumpProfileRevision('eu', 'gordunni', 'alpha')

    expect(profileRevision('eu', 'gordunni', 'alpha')).toBe(2)
    expect(profileRevision('eu', 'gordunni', 'beta')).toBe(0)
    expect(profileRevision('us', 'gordunni', 'alpha')).toBe(0)
  })
})