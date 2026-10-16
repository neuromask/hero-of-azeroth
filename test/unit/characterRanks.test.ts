/**
 * The places one character holds in every ranking the site keeps.
 *
 * What is pinned here is the property every door from a character's page depends on: a place is a place in the
 * ranking that door *opens* - the world's, whole - so for each figure the answer must be the row's own position in
 * the page the ranking draws, and a figure the table does not hold that character in must answer `null` rather than
 * a number that would open a table at nobody. A place and the table disagreeing is a link that lands on the wrong
 * row, which no amount of rendering afterwards can fix.
 *
 * The three states a ranking can be in are all exercised: a character with figures (a place in each figure's own
 * order), a character whose figure for some metrics has never been read (no place in those, a place in the rest),
 * and a character the table does not hold at all (no place anywhere).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCharacterRanks } from '../../server/utils/leaderboardStorage'
import { ensurePopulation, readMetricLeaderboardPage, readMetricRanks } from '../../server/utils/leaderboardRows'
import { METRIC_LEADERBOARDS, metricLeaderboardOf } from '../../shared/data/leaderboardSchema'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/**
 * A guest whose figures are the ones asked for: a snapshot is what makes a row, and the columns it does not carry -
 * titles, quests, recipes, the wardrobe, the player versus player pair - are left as the site holds them for a
 * character nobody has read those for: nothing at all.
 */
function member(name: string, realm: string, figures: { achievements?: number; mounts?: number; pets?: number } = {}): void {
  const id = memory.addGuestCharacter({ region: 'eu', realm, name })

  memory.addSnapshot({
    characterId: id,
    takenAt: 1000,
    achievements: figures.achievements ?? 0,
    mounts: figures.mounts ?? 0,
    pets: figures.pets ?? 0,
    toys: 0,
    decor: 0,
    reputations: 0
  })
}

describe('the places one character holds', () => {
  it('answers a place in every one of the site figures, and nothing where they hold none', async () => {
    member('Alpha', 'gordunni', { achievements: 500, mounts: 300, pets: 20 })
    member('Beta', 'gordunni', { achievements: 400, mounts: 500, pets: 40 })
    member('Gamma', 'eversong', { achievements: 600, mounts: 100, pets: 60 })

    ensurePopulation()

    const ranks = await getCharacterRanks({ region: 'eu', realm: 'gordunni', name: 'Alpha' })

    // Every ranking the site keeps is answered, because a page of tiles has no list of its own to fall back on -
    // and every answer is a place or nothing: never a zero, which would open a table at a row that is nobody.
    for (const metric of METRIC_LEADERBOARDS) {
      expect(Object.hasOwn(ranks, metric.slug)).toBe(true)

      const place = ranks[metric.slug]
      expect(place === null || (Number.isInteger(place) && place > 0)).toBe(true)
    }

    // The figures this character's own readings never carried: the table holds no figure for them, so there is no
    // row to turn to and the door is left pointing at the ranking itself.
    expect(ranks.titles).toBeNull()
    expect(ranks.quests).toBeNull()
    expect(ranks.recipes).toBeNull()
    expect(ranks.transmogs).toBeNull()
  })

  it('agrees with the page every ranking draws, figure for figure', async () => {
    member('Alpha', 'gordunni', { achievements: 500, mounts: 300, pets: 20 })
    member('Beta', 'gordunni', { achievements: 900, mounts: 500, pets: 40 })
    member('Gamma', 'eversong', { achievements: 100, mounts: 100, pets: 60 })

    ensurePopulation()

    // The name is asked for the way an address spells it, and the table keys it lowercased - the two have to be one
    // character rather than two (a page hands over the address's own spelling).
    const ranks = await getCharacterRanks({ region: 'eu', realm: 'gordunni', name: 'ALPHA' })

    for (const metric of METRIC_LEADERBOARDS) {
      const page = readMetricLeaderboardPage(metric, {}, 25)
      const at = page.players.findIndex((player) => player.name === 'alpha')

      expect(ranks[metric.slug]).toBe(at < 0 ? null : at + 1)
    }
  })

  it('answers nothing at all for a character the table does not hold', async () => {
    member('Alpha', 'gordunni', { achievements: 500, mounts: 300 })
    ensurePopulation()

    const ranks = await getCharacterRanks({ region: 'eu', realm: 'gordunni', name: 'Nobody' })

    for (const metric of METRIC_LEADERBOARDS) expect(ranks[metric.slug]).toBeNull()
  })

  it('answers the place in the world, not the one in the character own realm', async () => {
    // Two characters, a realm apart, and the one on the other realm is ahead: the world's page stands this one
    // second, while the page scoped to their own realm would stand them first. A door from a character's page opens
    // the *world's* ranking, so the place it carries has to be the one that page holds and not the narrower one.
    member('Alpha', 'gordunni', { achievements: 900_000, mounts: 900_000 })
    member('Ahead', 'eversong', { achievements: 950_000, mounts: 950_000 })

    ensurePopulation()

    const ranks = await getCharacterRanks({ region: 'eu', realm: 'gordunni', name: 'alpha' })
    const places = readMetricRanks(metricLeaderboardOf('mounts')!, ['eu:gordunni:alpha']).players[0]

    expect(places?.realmRank).toBe(1)
    expect(places?.worldRank).toBe(2)
    expect(ranks.mounts).toBe(2)
  })
})
