/**
 * The metric leaderboards: one figure's ranking, at three scopes, and the places the comparison board asks for.
 *
 * A ranking is only worth anything if it *agrees with itself*, so the property pinned here is that one: for every
 * one of the thirteen figures the site ranks (`METRIC_LEADERBOARDS`), the order a page is drawn in, the place the
 * ranks endpoint answers and the population a scope counts are the same three answers - and they are the order an
 * implementation written out in plain JavaScript produces from the same fixture. That reference is deliberately
 * not the server's own code: it is the documented order (figure, then rating, then name, then the address a row is
 * keyed by) written a second time, so a query that agrees with itself but not with the rule shows up here.
 *
 * What the fixture is built to catch, one case at a time:
 *
 *   - a member whose figure is *unknown* (`NULL`) is left out of that ranking rather than placed at the bottom of
 *     it, while a *real* zero is ranked like any other figure;
 *   - two members with the same figure are settled by the rating, then by the name, then by the address - which is
 *     the only tie-break that can separate one name on two realms;
 *   - an account is ranked by its own aggregated totals rather than by its main's reading, an alt is not ranked at
 *     all, and an account that asked to be left out is not in the population;
 *   - the same realm slug in two regions is two realms, and a scope that names one of them holds only it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { calculatePlayerScore } from '../../server/utils/playerScore'
import { fileAccountReading } from '../../server/utils/accountPool'
import { fileDailyReading } from '../../server/utils/characterReading'
import {
  ensurePopulation,
  readMetricLeaderboardPage,
  readMetricRanks,
  refreshAccountRow
} from '../../server/utils/leaderboardRows'
import {
  METRIC_LEADERBOARDS,
  METRIC_LEADERBOARD_SLUGS,
  metricLeaderboardOf,
  metricFigureOf
} from '#shared/data/leaderboardSchema'
import type { MetricKey } from '#shared/data/historySchema'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/**
 * The figures of one member of the fixture, as the site's own readings hold them.
 *
 * `null` is a figure nobody has read, which is the one thing a ranking must not read as a nought.
 */
interface Figures {
  mPlusScore: number
  achievements: number
  mounts: number
  pets: number
  toys: number
  decor: number
  reputations: number
  titles: number | null
  quests: number | null
  recipes: number | null
  transmogs: number | null
  honorableKills: number | null
  honorLevel: number | null
}

/** One member of the population, as the test knows it: who it is, and what it holds. */
interface Member {
  region: string
  realm: string
  name: string
  displayName: string
  /** The guild the row prints, where the fixture gave one. */
  guild?: string
  figures: Figures
  /** The rating the row is ordered by when two figures are equal. */
  score: number
}

/** The six collections a rating is computed from, which is also what a complete reading means. */
function collections(six: Pick<Figures, 'achievements' | 'mounts' | 'pets' | 'toys' | 'decor' | 'reputations'>) {
  return {
    achievements: six.achievements,
    mounts: six.mounts,
    pets: six.pets,
    toys: six.toys,
    decor: six.decor,
    reputations: six.reputations
  }
}

/** The rating a member is ordered by, computed from the six figures the formula weighs. */
function scoreOf(member: Member): number {
  return calculatePlayerScore(collections(member.figures))
}

/**
 * The fixture's own members, written out rather than derived: this is the reference the database is compared
 * against, so it is a thing a reader can check by eye.
 *
 * `Alpha` and `Beta` hold the same collections and the same ten titles, and Alpha's higher achievements are what
 * puts it first - which is the score tie-break. `Gamma` has never had a reading of the five figures a metric
 * leaderboard ranks, so it is in no ranking of them - while its zero honorable kills is a *real* zero and takes
 * part. The two `Twin`s hold the same figures and the same rating on two realms, and only the address tells them
 * apart.
 */
const ALPHA: Member = {
  region: 'eu',
  realm: 'gordunni',
  name: 'alpha',
  displayName: 'Alpha',
  guild: 'Nightfall',
  figures: {
    mPlusScore: 0,
    achievements: 1000,
    mounts: 100,
    pets: 50,
    toys: 20,
    decor: 10,
    reputations: 5,
    titles: 10,
    quests: 100,
    recipes: 50,
    transmogs: 500,
    honorableKills: 1000,
    honorLevel: 20
  },
  score: 0
}

const BETA: Member = {
  region: 'eu',
  realm: 'gordunni',
  name: 'beta',
  displayName: 'Beta',
  figures: {
    mPlusScore: 0,
    achievements: 800,
    mounts: 100,
    pets: 50,
    toys: 20,
    decor: 10,
    reputations: 5,
    titles: 10,
    quests: 90,
    recipes: 40,
    transmogs: 400,
    honorableKills: 900,
    honorLevel: 15
  },
  score: 0
}

const GAMMA: Member = {
  region: 'eu',
  realm: 'gordunni',
  name: 'gamma',
  displayName: 'Gamma',
  figures: {
    mPlusScore: 0,
    achievements: 1500,
    mounts: 5,
    pets: 5,
    toys: 5,
    decor: 5,
    reputations: 5,
    titles: null,
    quests: null,
    recipes: null,
    transmogs: null,
    honorableKills: 0,
    honorLevel: null
  },
  score: 0
}

const ZERO: Member = {
  region: 'eu',
  realm: 'eversong',
  name: 'zero',
  displayName: 'Zero',
  figures: {
    mPlusScore: 0,
    achievements: 0,
    mounts: 0,
    pets: 0,
    toys: 0,
    decor: 0,
    reputations: 0,
    titles: 0,
    quests: 0,
    recipes: 0,
    transmogs: 0,
    honorableKills: 0,
    honorLevel: 0
  },
  score: 0
}

/** The same character's figures on another realm: the pair only the address can tell apart. */
const TWIN_EU: Member = {
  ...ZERO,
  name: 'twin',
  displayName: 'Twin',
  realm: 'gordunni',
  figures: { ...ZERO.figures, titles: 5 }
}

const TWIN_US: Member = {
  ...ZERO,
  region: 'us',
  realm: 'kirin-tor',
  name: 'twin',
  displayName: 'Twin',
  figures: { ...ZERO.figures, titles: 5 }
}

/** The account's own main, whose row carries the account's aggregated totals rather than its own reading. */
const MAIN: Member = {
  region: 'eu',
  realm: 'gordunni',
  name: 'mainchar',
  displayName: 'Mainchar',
  figures: {
    mPlusScore: 0,
    achievements: 1200,
    mounts: 200,
    pets: 60,
    toys: 25,
    decor: 12,
    reputations: 6,
    // The account's own figure, which its pool raises above the reading below: 25 titles across the account
    // rather than the 20 this character has earned.
    titles: 25,
    quests: 50,
    recipes: 50,
    transmogs: 100,
    honorableKills: 0,
    honorLevel: 0
  },
  score: 0
}

/** The alt's own titles, which are nobody's figure: an alt is not a member of any ranking (see `ALT_TITLES`). */
const ALT_TITLES = 5

/** The figures of the account that asked to be left out of the table. */
const HIDDEN_TITLES = 5000

const GUESTS: Member[] = [ALPHA, BETA, GAMMA, ZERO, TWIN_EU, TWIN_US]
const MEMBERS: Member[] = [...GUESTS, MAIN]

for (const member of MEMBERS) member.score = scoreOf(member)

/** Writes the fixture into the database the reads under test answer from. */
function build(): void {
  for (const member of GUESTS) {
    const id = memory.addGuestCharacter({
      region: member.region,
      realm: member.realm,
      name: member.displayName,
      guild: member.guild
    })

    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: member.figures.mPlusScore,
      ...collections(member.figures),
      titles: member.figures.titles,
      quests: member.figures.quests,
      recipes: member.figures.recipes,
      transmogs: member.figures.transmogs,
      honorableKills: member.figures.honorableKills,
      honorLevel: member.figures.honorLevel,
      score: member.score
    })
  }

  // The account: a main whose own reading is *below* the account's totals for titles, an alt that must never be
  // ranked, and the pool that is what raises the account's figure above the main's reading.
  memory.addUser(7)
  const main = memory.addCharacter({ userId: 7, region: 'eu', realm: 'gordunni', name: 'Mainchar', isMain: true })
  const alt = memory.addCharacter({ userId: 7, region: 'eu', realm: 'gordunni', name: 'Altchar' })

  for (const [id, titles] of [
    [main, 20],
    [alt, ALT_TITLES]
  ] as const) {
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: 0,
      ...collections(MAIN.figures),
      titles,
      quests: MAIN.figures.quests,
      recipes: MAIN.figures.recipes,
      transmogs: MAIN.figures.transmogs,
      honorableKills: 0,
      honorLevel: 0,
      score: MAIN.score
    })
  }

  memory.addPoolItems(7, 'titles', Array.from({ length: 25 }, (_, index) => 100 + index))
  // The account's reputations are the pool's union alone (`readAccountTotals`), so the six its characters stand at
  // are counted here rather than read off a character's own tally.
  memory.addPoolItems(7, 'reputations', Array.from({ length: MAIN.figures.reputations }, (_, index) => 500 + index))
  fileAccountReading(7)

  // And an account that asked to be left out of the table, holding figures that would top the titles ranking.
  memory.addUser(9, true)
  const hidden = memory.addCharacter({ userId: 9, region: 'eu', realm: 'gordunni', name: 'Hidden', isMain: true })
  memory.addSnapshot({
    characterId: hidden,
    takenAt: 1000,
    mplus: 0,
    ...collections(MAIN.figures),
    titles: HIDDEN_TITLES,
    quests: null,
    recipes: null,
    transmogs: null,
    honorableKills: null,
    honorLevel: null,
    score: MAIN.score
  })
  fileAccountReading(9)

  ensurePopulation()
}

/**
 * The ranking the rule produces, written out in JavaScript: what a scope holds, in the order the site draws it.
 *
 * The comparison is spelled the way SQLite's own is - a case-folded name compared as text, then the three address
 * segments - rather than with `localeCompare`, which orders by a locale's rules and would quietly disagree with
 * the database.
 */
function reference(metric: MetricKey, scope: { region?: string; realm?: string } = {}): Member[] {
  const lower = (value: string) => value.toLowerCase()

  return MEMBERS.filter((member) => {
    if (!scope.region) return true
    if (member.region !== scope.region) return false
    return !scope.realm || member.realm === scope.realm
  })
    .filter((member) => figureOf(member, metric) !== null)
    .sort((left, right) => {
      const a = figureOf(left, metric) as number
      const b = figureOf(right, metric) as number
      if (a !== b) return b - a
      if (left.score !== right.score) return right.score - left.score
      if (lower(left.displayName) !== lower(right.displayName)) {
        return lower(left.displayName) < lower(right.displayName) ? -1 : 1
      }
      if (left.region !== right.region) return left.region < right.region ? -1 : 1
      if (left.realm !== right.realm) return left.realm < right.realm ? -1 : 1
      return left.name < right.name ? -1 : 1
    })
}

/** A member as a row of the table keys it, which is the key the ranks endpoint answers under. */
function keyOf(member: Member): string {
  return `${member.region}:${member.realm}:${member.name}`
}

/**
 * The figure the ranking of `metric` is of for one member of the fixture.
 *
 * The rating is the one figure of the thirteen that is not one of a member's `figures` - it is computed from six of
 * them, which is what `scoreOf` above is - so it is read from its own field rather than from the map.
 */
function figureOf(member: Member, metric: MetricKey): number | null {
  return metric === 'score' ? member.score : member.figures[metric]
}

describe('the figures a metric leaderboard can be of', () => {
  it('names the thirteen figures of the comparison board, and reads each from its own column', () => {
    // The board's thirteen rows are these thirteen, and the two lists are one list: a slug added without a page, or
    // a page without an entry here, is a figure a reader cannot reach.
    expect(METRIC_LEADERBOARD_SLUGS).toEqual([
      'score',
      'achievements',
      'mounts',
      'toys',
      'pets',
      'decor',
      'titles',
      'reputations',
      'transmogs',
      'quests',
      'recipes',
      'honorable-kills',
      'honor-level'
    ])

    // The column is the shape the materialised row holds, and it is never the slug: the two spellings meet only
    // here, which is what keeps a hand-typed address out of a query.
    expect(metricLeaderboardOf('honorable-kills')?.column).toBe('honorable_kills')
    expect(metricLeaderboardOf('honor-level')?.column).toBe('honor_level')
    expect(metricLeaderboardOf('mounts')?.column).toBe('mounts')

    // The figures the site deliberately does not rank on a page of their own, and a slug that is not one at all.
    expect(metricLeaderboardOf('mplus')).toBeNull()
    expect(metricLeaderboardOf('ilvl')).toBeNull()
    expect(metricLeaderboardOf('mounts; DROP TABLE leaderboard')).toBeNull()
  })

  it('orders every one of them exactly as the rule does, with the figures under the names', () => {
    build()

    for (const entry of METRIC_LEADERBOARDS) {
      const expected = reference(entry.metric)
      const page = readMetricLeaderboardPage(entry, {}, 25)

      expect({ slug: entry.slug, names: page.players.map((player) => player.name) }).toEqual({
        slug: entry.slug,
        names: expected.map((member) => member.name)
      })

      // And the figure under each name is the figure the ranking is of rather than a neighbouring column, which is
      // what a whitelist entry pointing at the wrong column would produce.
      expect(page.players.map((player) => metricFigureOf(player, entry.metric))).toEqual(
        expected.map((member) => figureOf(member, entry.metric))
      )

      expect({ slug: entry.slug, total: page.total }).toEqual({ slug: entry.slug, total: expected.length })
    }
  })

  it('places every ranked member exactly where the rule does, in all three scopes', () => {
    build()

    for (const entry of METRIC_LEADERBOARDS) {
      const world = reference(entry.metric)

      for (const member of world) {
        const answer = readMetricRanks(entry, [keyOf(member)]).players[0]!

        expect({ slug: entry.slug, who: member.name, rank: answer.worldRank }).toEqual({
          slug: entry.slug,
          who: member.name,
          rank: world.indexOf(member) + 1
        })

        expect({ slug: entry.slug, who: member.name, rank: answer.regionRank }).toEqual({
          slug: entry.slug,
          who: member.name,
          rank: reference(entry.metric, { region: member.region }).indexOf(member) + 1
        })

        expect({ slug: entry.slug, who: member.name, rank: answer.realmRank }).toEqual({
          slug: entry.slug,
          who: member.name,
          rank: reference(entry.metric, { region: member.region, realm: member.realm }).indexOf(member) + 1
        })

        expect(answer.participating).toBe(true)
        expect(answer.value).toBe(figureOf(member, entry.metric))
      }
    }
  })
})

describe('the scope a ranking is read at', () => {
  it('counts the world, one region and one realm, and keeps a realm slug inside its own region', () => {
    build()

    const titles = metricLeaderboardOf('titles')!

    // The world: everybody holding a figure. The two `Twin`s are two members of it, because two realms are two
    // realms - even when the slug is the same.
    expect(readMetricLeaderboardPage(titles, {}, 25).total).toBe(reference('titles').length)

    // EU: only the European members of that world.
    const eu = readMetricLeaderboardPage(titles, { region: 'eu' }, 25)
    expect(eu.total).toBe(reference('titles', { region: 'eu' }).length)
    expect(eu.players.map((player) => player.region)).toEqual(eu.players.map(() => 'eu'))

    // And the realm inside it: `gordunni` in EU holds the EU twin and not the US one, which a realm scope without a
    // region could not say.
    const gordunni = readMetricLeaderboardPage(titles, { region: 'eu', realm: 'gordunni' }, 25)
    expect(gordunni.total).toBe(reference('titles', { region: 'eu', realm: 'gordunni' }).length)
    expect(gordunni.players.map((player) => `${player.region}:${player.realm}`)).toEqual(
      gordunni.players.map(() => 'eu:gordunni')
    )
    expect(gordunni.players.some((player) => player.region === 'us')).toBe(false)

    // The other realm of the same slug, in the other region, is a ranking of its own.
    const usTwin = readMetricLeaderboardPage(titles, { region: 'us', realm: 'kirin-tor' }, 25)
    expect(usTwin.total).toBe(1)
    expect(usTwin.players[0]).toMatchObject({ region: 'us', realm: 'kirin-tor' })
  })

  it('is a ranking of nobody at all for a region this build does not serve', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const page = readMetricLeaderboardPage(titles, { region: 'xx' }, 25)

    expect(page.total).toBe(0)
    expect(page.players).toEqual([])

    // A realm slug with no region is not a realm: it is not answered for at all, rather than answered with
    // everybody of that slug in every region.
    const realmOnly = readMetricLeaderboardPage(titles, { realm: 'gordunni' }, 25)
    expect(realmOnly.total).toBe(reference('titles', { region: 'eu', realm: 'gordunni' }).length + reference('titles', { region: 'us', realm: 'gordunni' }).length)
  })

  it('says what a place is a place among, so a rank reads as a rank rather than as a number', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const alpha = readMetricRanks(titles, [keyOf(ALPHA)]).players[0]!

    expect(alpha).toMatchObject({
      key: 'eu:gordunni:alpha',
      worldRank: reference('titles').indexOf(ALPHA) + 1,
      worldTotal: reference('titles').length,
      regionRank: reference('titles', { region: 'eu' }).indexOf(ALPHA) + 1,
      regionTotal: reference('titles', { region: 'eu' }).length,
      realmRank: reference('titles', { region: 'eu', realm: 'gordunni' }).indexOf(ALPHA) + 1,
      realmTotal: reference('titles', { region: 'eu', realm: 'gordunni' }).length
    })
  })
})

describe('the realm menu a ranking offers', () => {
  it('lists the realms the ranking holds members in, with how many each holds', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const world = readMetricLeaderboardPage(titles, {}, 25)

    // The world page offers both regions' realms, and only the realms this figure is held in: `gamma` holds no
    // titles, but it is a member of the mounts ranking - which is why the facet is read per figure.
    expect(world.realms.map((entry) => `${entry.region}:${entry.realm}`).sort()).toEqual(
      ['eu:eversong', 'eu:gordunni', 'us:kirin-tor'].sort()
    )

    // And the counts are the members of that realm that hold a figure, which is what the table would show.
    for (const entry of world.realms) {
      const expected = reference('titles', { region: entry.region, realm: entry.realm }).length
      expect({ realm: entry.realm, count: entry.count }).toEqual({ realm: entry.realm, count: expected })
    }
  })

  it('keeps a scoped page inside its own region, so a realm picked from the menu stays there', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const eu = readMetricLeaderboardPage(titles, { region: 'eu' }, 25)
    const realm = readMetricLeaderboardPage(titles, { region: 'eu', realm: 'gordunni' }, 25)

    expect(eu.realms.map((entry) => entry.region)).toEqual(eu.realms.map(() => 'eu'))
    expect(eu.realms.map((entry) => entry.realm).sort()).toEqual(['eversong', 'gordunni'])

    // A realm page offers that realm's siblings too: a reader standing on one realm can step to the next.
    expect(realm.realms.map((entry) => entry.realm).sort()).toEqual(['eversong', 'gordunni'])
  })

  it('narrows the table by a side and by a fragment of a name, without touching the menu', () => {
    build()

    const titles = metricLeaderboardOf('titles')!

    // The two narrowing choices the front door's bar also carries. They change what the table holds - and not the
    // realms the menu offers, which is about the ranking rather than about the slice of it on screen.
    const typed = readMetricLeaderboardPage(titles, { q: 'alp' }, 25)
    expect(typed.players.map((player) => player.name)).toEqual(['alpha'])
    expect(typed.total).toBe(1)
    expect(typed.realms.length).toBeGreaterThan(0)

    // A world page is where both regions meet, so a faction that holds nothing there is a table with nobody in it.
    const nobody = readMetricLeaderboardPage(titles, { faction: 'horde' }, 25)
    expect(nobody.total).toBe(0)
    expect(nobody.players).toEqual([])

    const eu = readMetricLeaderboardPage(titles, { region: 'eu' }, 25)
    expect(eu.realms.length).toBeGreaterThan(0)
  })

  it('answers from a database that has none of the ranking indices, in the same order', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const before = readMetricLeaderboardPage(titles, {}, 25)

    // The one failure the read is built to survive: a database whose index could not be written - a full disk, a
    // lock - is a database SQLite refuses a statement prepared against it ("no query solution"), and the page falls
    // back to the planner's own plan rather than answering a 500 (`throughMetricIndex` in ./leaderboardRows). What
    // is asserted is that the answer is the same one, in the same order: an index is a plan, not a rule.
    memory.db.exec('DROP INDEX idx_leaderboard_titles')

    try {
      const after = readMetricLeaderboardPage(titles, {}, 25)
      expect(after.players.map((player) => player.name)).toEqual(before.players.map((player) => player.name))
      expect(after.players.map((player) => player.titles)).toEqual(before.players.map((player) => player.titles))
      expect(after.total).toBe(before.total)
      expect(after.realms).toEqual(before.realms)
    } finally {
      memory.db.exec(
        'CREATE INDEX idx_leaderboard_titles ON leaderboard(titles DESC, score DESC, display_name COLLATE NOCASE, region, realm_slug, name_key, updated_at)'
      )
    }
  })
})

describe('a tie, an unknown figure and a real zero', () => {
  it('settles two equal figures by the rating, then by the name, then by the address', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const page = readMetricLeaderboardPage(titles, {}, 25)

    // Alpha and Beta hold the same ten titles: the rating settles them, and it is the figure the table is ordered
    // by when nothing else is asked for.
    expect(ALPHA.figures.titles).toBe(BETA.figures.titles)
    expect(ALPHA.score).toBeGreaterThan(BETA.score)
    expect(page.players.findIndex((player) => player.name === 'alpha')).toBeLessThan(
      page.players.findIndex((player) => player.name === 'beta')
    )

    // The two Twins hold the same five titles *and* the same rating: only the address can order them, and it puts
    // the European one first (`eu` before `us` in the region column the order ends with).
    expect(TWIN_EU.score).toBe(TWIN_US.score)
    const twins = page.players.filter((player) => player.name === 'twin')
    expect(twins.map((player) => player.region)).toEqual(['eu', 'us'])

    // And the order the page is drawn in is the order the place is counted in, tie for tie.
    twins.forEach((player, index) => {
      const rank = page.players.findIndex((row) => row.name === player.name && row.region === player.region)
      expect(readMetricRanks(titles, [`${player.region}:${player.realm}:${player.name}`]).players[0]!.worldRank).toBe(
        rank + 1
      )
      expect(index).toBeLessThan(2)
    })
  })

  it('leaves a member whose figure nobody has read out of that ranking, and keeps a real zero in it', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const recipes = metricLeaderboardOf('recipes')!

    // Gamma's five figures were never read - and it is in no ranking of them at all.
    expect(GAMMA.figures.titles).toBeNull()
    expect(readMetricLeaderboardPage(titles, {}, 25).players.some((player) => player.name === 'gamma')).toBe(false)

    const gammaTitles = readMetricRanks(titles, [keyOf(GAMMA)]).players[0]!
    expect(gammaTitles).toMatchObject({ participating: true, value: null, worldRank: null, regionRank: null, realmRank: null })

    // Its honorable kills, though, are a real zero: that is a figure, and a figure is ranked.
    expect(GAMMA.figures.honorableKills).toBe(0)
    const kills = readMetricLeaderboardPage(metricLeaderboardOf('honorable-kills')!, {}, 25)
    expect(kills.players.some((player) => player.name === 'gamma')).toBe(true)
    expect(readMetricRanks(metricLeaderboardOf('honorable-kills')!, [keyOf(GAMMA)]).players[0]!.worldRank).not.toBeNull()

    // And Zero holds a nought of everything, which is a figure too: it is last rather than unranked.
    const zero = readMetricLeaderboardPage(recipes, {}, 25).players.find((player) => player.name === 'zero')
    expect(zero).toBeDefined()
    expect(metricFigureOf(zero!, 'recipes')).toBe(0)
  })

  it('refuses to give a place to a character that is not in the population at all', () => {
    build()

    const titles = metricLeaderboardOf('titles')!

    // An alt is not a member: the account's row is the character it leads with, and nobody else of its roster is
    // ranked - however much the alt itself holds.
    const alt = readMetricRanks(titles, ['eu:gordunni:altchar']).players[0]!
    expect(alt).toMatchObject({ participating: false, value: null, worldRank: null, regionRank: null, realmRank: null })
    expect(readMetricLeaderboardPage(titles, {}, 25).players.some((player) => player.name === 'altchar')).toBe(false)

    // A character nobody has read is not a member either, and neither is an account that asked to be left out.
    expect(readMetricRanks(titles, ['eu:gordunni:stranger']).players[0]).toMatchObject({ participating: false })
    expect(readMetricLeaderboardPage(titles, {}, 25).players.some((player) => player.name === 'hidden')).toBe(false)
    expect(readMetricRanks(titles, ['eu:gordunni:hidden']).players[0]).toMatchObject({ participating: false })

    // The population a refused character is told about is still the ranking's own, so "not in this ranking" reads as
    // a fact about them rather than as a broken answer.
    expect(alt.worldTotal).toBe(reference('titles').length)
    expect(alt.regionTotal).toBe(reference('titles', { region: 'eu' }).length)
  })
})

describe('the account behind a row', () => {
  it('ranks a main by the account totals rather than by the character reading', () => {
    build()

    const titles = metricLeaderboardOf('titles')!

    // The main has earned twenty titles and the account's pool counts twenty-five across its roster: the figure the
    // ranking is of is the account's, which is the figure the comparison board prints for the same character.
    expect(MAIN.figures.titles).toBe(25)
    const row = readMetricLeaderboardPage(titles, {}, 25).players.find((player) => player.name === 'mainchar')
    expect(row).toMatchObject({ isAccount: true, titles: 25 })
    expect(readMetricRanks(titles, [keyOf(MAIN)]).players[0]).toMatchObject({ value: 25, worldRank: 1 })

    // And the answer carries the row itself, which is what the plate above a ranking prints a portrait, a class and
    // a guild from: the table's own record rather than the browser's remembered copy of the character.
    const answer = readMetricRanks(titles, [keyOf(MAIN)]).players[0]!
    expect(answer.player).toMatchObject({ name: 'mainchar', isAccount: true, titles: 25 })
    expect(answer.player?.guild).toBeUndefined()
  })

  it('follows a main that moves, and gives the place up beside it', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const before = readMetricRanks(titles, ['eu:gordunni:mainchar', 'eu:gordunni:altchar']).players

    expect(before[0]).toMatchObject({ participating: true, worldRank: 1 })
    expect(before[1]).toMatchObject({ participating: false, worldRank: null })

    // Naming the other character is one write of the row the account is drawn by, and the place moves with it.
    memory.db.prepare('UPDATE characters SET is_main = 0 WHERE user_id = 7').run()
    memory.db.prepare("UPDATE characters SET is_main = 1 WHERE name_key = 'altchar'").run()
    refreshAccountRow(7)

    const after = readMetricRanks(titles, ['eu:gordunni:mainchar', 'eu:gordunni:altchar']).players
    expect(after[0]).toMatchObject({ participating: false, worldRank: null })
    expect(after[1]).toMatchObject({ participating: true, worldRank: 1 })
  })

  it('takes an account that asks to be left out out of the ranking, and its place with it', () => {
    build()

    const titles = metricLeaderboardOf('titles')!

    memory.db.prepare('UPDATE users SET hide_from_fame = 1 WHERE id = 7').run()
    refreshAccountRow(7)

    expect(readMetricLeaderboardPage(titles, {}, 25).players.some((player) => player.name === 'mainchar')).toBe(false)
    expect(readMetricRanks(titles, ['eu:gordunni:mainchar']).players[0]).toMatchObject({
      participating: false,
      worldRank: null
    })
  })

  it('reads a figure that moves again, and re-places the member it moved', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const guest = memory.db.prepare("SELECT id FROM characters WHERE name_key = 'alpha'").get() as { id: number }

    expect(readMetricRanks(titles, [keyOf(ALPHA)]).players[0]!.worldRank).toBe(reference('titles').indexOf(ALPHA) + 1)

    // A later reading with more titles: a point is filed, the member's row is rewritten, and the place is the place
    // in the table as it is now rather than the one from the read before.
    memory.addSnapshot({
      characterId: guest.id,
      takenAt: 2000,
      mplus: 0,
      ...collections(ALPHA.figures),
      titles: 9999,
      quests: ALPHA.figures.quests,
      recipes: ALPHA.figures.recipes,
      transmogs: ALPHA.figures.transmogs,
      honorableKills: ALPHA.figures.honorableKills,
      honorLevel: ALPHA.figures.honorLevel,
      score: ALPHA.score
    })
    fileDailyReading(guest.id, { stats: { titles: { count: 9999 } } } as never)

    const page = readMetricLeaderboardPage(titles, {}, 25)
    expect(page.players[0]!.name).toBe('alpha')
    expect(readMetricRanks(titles, [keyOf(ALPHA)]).players[0]).toMatchObject({ value: 9999, worldRank: 1 })
  })

  it('carries the guild the profile named onto the row a ranking prints', () => {
    build()

    const titles = metricLeaderboardOf('titles')!
    const row = readMetricLeaderboardPage(titles, {}, 25).players.find((player) => player.name === 'alpha')

    expect(row?.guild).toBe('Nightfall')

    // A row the site has no guild for says nothing at all rather than an empty name, which is what a page prints a
    // dash for.
    const beta = readMetricLeaderboardPage(titles, {}, 25).players.find((player) => player.name === 'beta')
    expect(beta?.guild).toBeUndefined()
  })
})
