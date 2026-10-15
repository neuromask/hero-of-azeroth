/**
 * The one character read behind the account sync, and the rule that keeps two passes from reading it twice.
 *
 * `refreshCharacterStats` is the expensive half: a full Blizzard profile plus the id lists that fill the
 * account pool. It is called from the profile page on a click and from the background pass, and the two can
 * overlap - so a character already being read is shared rather than read twice. These tests pin that rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterRow } from '../../server/utils/accountSync'

const getCharacter = vi.fn()
const getCharacterMountIds = vi.fn(async () => [] as number[])
const getMaxedReputationIds = vi.fn(async () => [] as number[])
const getCharacterTitleIds = vi.fn(async () => [] as number[])
const getCharacterQuestIds = vi.fn(async () => [] as number[])
const getCharacterRecipeIds = vi.fn(async () => [] as number[])
const getCharacterProfessions = vi.fn(async () => [] as string[])
const getCharacterTransmogs = vi.fn(async () => null)
const addToPool = vi.fn(() => 0)
const syncPoolReputations = vi.fn(() => 0)
const syncPoolFigures = vi.fn(() => 0)

const profile = {
  name: 'X',
  realm: 'Gordunni',
  classId: 8,
  level: 80,
  faction: 'HORDE',
  avatarUrl: '',
  ilvl: 600,
  mPlusScore: 2500,
  ap: 11000,
  stats: {
    mounts: { count: 1200 },
    pets: { count: 1400 },
    toys: { count: 900 },
    decor: { count: 90 },
    reputations: { count: 50 },
    titles: { count: 5 },
    quests: { count: 100 },
    recipes: { count: 30 },
    transmogs: { count: 0 },
    honorableKills: { count: 0 },
    honorLevel: { count: 0 }
  }
}

const row: CharacterRow = {
  id: 1,
  user_id: 1,
  region: 'eu',
  realm_slug: 'gordunni',
  name: 'x',
  name_key: 'x'
}

beforeEach(() => {
  vi.resetModules()
  getCharacter.mockResolvedValue(profile)
  const g = globalThis as Record<string, unknown>
  g.getCharacter = getCharacter
  g.getCharacterMountIds = getCharacterMountIds
  g.getMaxedReputationIds = getMaxedReputationIds
  g.getCharacterTitleIds = getCharacterTitleIds
  g.getCharacterQuestIds = getCharacterQuestIds
  g.getCharacterRecipeIds = getCharacterRecipeIds
  g.getCharacterProfessions = getCharacterProfessions
  g.getCharacterTransmogs = getCharacterTransmogs
  g.addToPool = addToPool
  g.syncPoolReputations = syncPoolReputations
  g.syncPoolFigures = syncPoolFigures
  g.useDb = () => ({ prepare: () => ({ run: () => ({}), get: () => undefined, all: () => [] }) })
})

describe('refreshCharacterStats', () => {
  it('shares one read between two concurrent callers', async () => {
    const { refreshCharacterStats } = await import('../../server/utils/accountSync')

    const first = refreshCharacterStats(row)
    const second = refreshCharacterStats(row)
    await Promise.all([first, second])

    expect(getCharacterMountIds).toHaveBeenCalledTimes(1)
    expect(getCharacter).toHaveBeenCalledTimes(1)
  })

  it('reads different characters independently', async () => {
    const { refreshCharacterStats } = await import('../../server/utils/accountSync')

    await refreshCharacterStats(row)
    await refreshCharacterStats({ ...row, id: 2 })

    expect(getCharacterMountIds).toHaveBeenCalledTimes(2)
  })
})
