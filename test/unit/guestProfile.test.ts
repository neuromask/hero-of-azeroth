/**
 * The public profile a visitor sees without signing in with Battle.net.
 *
 * A stranger's lookup is the site's front door, so the rule it obeys must not move: a character that
 * belongs to no account is answered with Blizzard's own numbers, the pooled flag is off, and the
 * profile the endpoint cached is not written into (a page that wrote its figures back would be
 * feeding its own view into the reading the next reader is computed from).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { accountOwnerId, overlayPool } from '../../server/utils/accountPool'
import { calculatePlayerScore, scoreFigures } from '../../server/utils/playerScore'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** A character as the profile endpoint hands one over, with room to read the fields the rule touches. */
function guestProfile() {
  return {
    name: 'Stranger',
    realm: 'Gordunni',
    region: 'eu',
    level: 90,
    ilvl: 320,
    mPlusScore: 2500,
    ap: 10000,
    classId: 8,
    faction: 'HORDE',
    renderUrl: '',
    avatarUrl: '',
    backgroundUrl: '',
    raceId: 0,
    gender: '',
    pooled: false,
    score: 0,
    stats: {
      achievements: { count: 10000, total: 40000 },
      mounts: { count: 100, total: 1200 },
      pets: { count: 200, total: 1500 },
      toys: { count: 50, total: 900 },
      decor: { count: 10, total: 1400 },
      reputations: { count: 5, total: 100, accountWide: false }
    }
  } as never
}

describe('a guest lookup (no Battle.net account behind the character)', () => {
  it('finds no owner', () => {
    expect(accountOwnerId('eu', 'gordunni', 'stranger')).toBeNull()
  })

  it('is answered with the character\'s own figures and the pooled flag off', () => {
    const profile = guestProfile()
    const result = overlayPool(profile, 'eu', 'gordunni', 'stranger')

    expect(result.pooled).toBe(false)
    expect(result.stats.mounts.count).toBe(100)
    expect(result.stats.pets.count).toBe(200)
    expect(result.stats.reputations.count).toBe(5)
    expect(result.score).toBe(calculatePlayerScore(scoreFigures((profile as { stats: never }).stats)))
  })

  it('does not write its view back into the profile it was handed', () => {
    const profile = guestProfile()
    const result = overlayPool(profile, 'eu', 'gordunni', 'stranger')

    expect(result).not.toBe(profile)
    expect((profile as { score: number }).score).toBe(0)
  })

  it('finds the owner once the character is on the site\'s roster', () => {
    memory.addUser(42, false)
    memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Owned' })

    expect(accountOwnerId('eu', 'gordunni', 'owned')).toBe(42)
  })
})
