/**
 * The hall of fame's rows: the table read from the database, and the writes that keep it true as the population
 * moves.
 *
 * The fixture below is the table as the build before this one kept it - a file of records, `leaderboard.json` - and
 * it is written out for the migration to move (`./statisticsMigration`), because that is how the rows a real site
 * has on the day this ships arrive in the database. Every question the page asks is then put to the database: each
 * order, each filter, each page, the widgets, and a place in the table.
 *
 * The second half is about the maintenance rather than the fixture, and it is the half that a rebuild would hide:
 * once a table has been built, the only thing that keeps it true is the write path - a reading filed, an account's
 * totals filed, a character claimed - so each of those is exercised and read back through the very table the page
 * draws, and a row that had been left behind would be a failing assertion rather than a stale page.
 *
 * The fixture is deliberately small and awkward: two rows tie on the figure the table is ordered by, one name is
 * Cyrillic, one row is below the level cap with an item level it is not printed for, and one row holds nothing
 * at all - which is the row that would sort first if a zero were read as a missing figure.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardQuery } from '#shared/data/leaderboardSchema'
import { fileAccountReading } from '../../server/utils/accountPool'
import { claimGuestCharacter } from '../../server/utils/accountSync'
import { fileDailyReading } from '../../server/utils/characterReading'
import { calculatePlayerScore, SCORE_VERSION } from '../../server/utils/playerScore'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

const data = mkdtempSync(join(tmpdir(), 'hoa-rows-'))
process.env.NUXT_DATA_DIR = data

/** One row of the old table, with every figure it printed - the rating included, as the file carried it. */
function legacyRow(region: string, realm: string, name: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  const six = {
    achievements: Number(extras.achievements ?? 0),
    mounts: Number(extras.mounts ?? 0),
    pets: Number(extras.pets ?? 0),
    toys: Number(extras.toys ?? 0),
    decor: Number(extras.decor ?? 0),
    reputations: Number(extras.reputations ?? 0)
  }

  return {
    region,
    realm,
    realmName: realm,
    name: name.toLowerCase(),
    displayName: name,
    avatar: 'avatar.jpg',
    classId: 1,
    faction: 'alliance',
    level: 90,
    ilvl: 320,
    mPlusScore: 0,
    honorableKills: 0,
    ...six,
    score: calculatePlayerScore(six),
    updatedAt: '2026-10-15',
    firstSeenAt: '2026-10-08',
    ...extras
  }
}

/** The table as the build before this one wrote it, with the awkward rows above in it. */
const FIXTURE = [
  legacyRow('eu', 'gordunni', 'Alpha', { mounts: 100, pets: 50, achievements: 1000, classId: 1, ilvl: 320 }),
  legacyRow('eu', 'gordunni', 'Beta', { mounts: 100, pets: 50, achievements: 1000, classId: 1, ilvl: 320 }),
  legacyRow('eu', 'gordunni', 'Азурмаск', { mounts: 50, pets: 10, achievements: 500, classId: 11, faction: 'horde', mPlusScore: 3000 }),
  legacyRow('us', 'kirin-tor', 'Gamma', { mounts: 200, level: 80, ilvl: 500, classId: 3 }),
  legacyRow('us', 'kirin-tor', 'Delta', { classId: 8, ilvl: 0 }),
  legacyRow('eu', 'ysondre', 'Epsilon', { mounts: 1, pets: 1, toys: 1, decor: 1, reputations: 1, achievements: 1, classId: 12, honorableKills: 500 })
]

writeFileSync(join(data, 'leaderboard.json'), JSON.stringify({ version: 1, scoreVersion: 4, updatedAt: '2026-10-15', players: FIXTURE }))

/**
 * Every module of this test, freshly loaded.
 *
 * `vi.resetModules` is what makes that possible: the migration remembers that it has run, and a test that
 * changes the database between cases has to be handed a module that has not.
 */
async function modules(): Promise<{
  rows: typeof import('../../server/utils/leaderboardRows')
  migrateStatistics: typeof import('../../server/utils/statisticsMigration').migrateStatistics
}> {
  vi.resetModules()
  return {
    rows: await import('../../server/utils/leaderboardRows'),
    migrateStatistics: (await import('../../server/utils/statisticsMigration')).migrateStatistics
  }
}

/**
 * A reading of a character, in the shape the site's own writer takes: the figures a profile carries, with the ones
 * a page's read does not fetch left out - the appearances and the pvp figures - which is what the reader's merge
 * keeps from the point before.
 */
function reading(mounts: number): never {
  return {
    name: 'Stranger',
    realm: 'Gordunni',
    level: 90,
    faction: 'HORDE',
    classId: 1,
    avatarUrl: '',
    ilvl: 300,
    mPlusScore: 0,
    stats: {
      mounts: { count: mounts },
      pets: { count: 1 },
      toys: { count: 1 },
      decor: { count: 1 },
      reputations: { count: 1 },
      achievements: { count: 1 }
    }
  } as never
}

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

afterAll(() => {
  rmSync(data, { recursive: true, force: true })
  delete process.env.NUXT_DATA_DIR
})

describe('the rows the table draws', () => {
  it('draws the population in the order the table is read in', async () => {
    const { rows, migrateStatistics } = await modules()
    await migrateStatistics()

    const names = (query: LeaderboardQuery) => rows.readLeaderboardPage(query, 25).players.map((player) => player.name)

    // The rating first: one row's mounts outweigh everything else, two rows tie on both the rating and the
    // figure so the name decides, and a Cyrillic name is ordered by it like any other.
    expect(names({})).toEqual(['gamma', 'alpha', 'beta', 'азурмаск', 'epsilon', 'delta'])
    expect(names({ sort: 'mounts' })).toEqual(['gamma', 'alpha', 'beta', 'азурмаск', 'epsilon', 'delta'])
    // The figure first, and then the rating: rows that share a figure (everybody with no rating at all) are
    // ordered by what they have gathered, so the two strongest come before the two weakest.
    expect(names({ sort: 'mplus' })).toEqual(['азурмаск', 'gamma', 'alpha', 'beta', 'epsilon', 'delta'])
    // The filters, and a search that has to fold a Cyrillic name to find it.
    expect(names({ realm: 'gordunni' })).toEqual(['alpha', 'beta', 'азурмаск'])
    expect(names({ faction: 'horde' })).toEqual(['азурмаск'])
    expect(names({ classId: 1 })).toEqual(['alpha', 'beta'])
    expect(names({ q: 'азур' })).toEqual(['азурмаск'])
    expect(names({ q: 'nobody' })).toEqual([])
  })

  it('slices the population into pages, and keeps a caller inside them', async () => {
    const { rows, migrateStatistics } = await modules()
    await migrateStatistics()

    const first = rows.readLeaderboardPage({}, 2)

    expect(first.players.map((player) => player.name)).toEqual(['gamma', 'alpha'])
    expect(first).toMatchObject({ total: 6, pages: 3, page: 1, perPage: 2, updatedAt: '2026-10-15' })
    expect(rows.readLeaderboardPage({ page: 3 }, 2).players.map((player) => player.name)).toEqual(['epsilon', 'delta'])
    // A page past the end is the last page rather than an empty answer.
    expect(rows.readLeaderboardPage({ page: 99 }, 2).page).toBe(3)
  })

  it('carries the figures, the rating and the day of every row', async () => {
    const { rows, migrateStatistics } = await modules()
    await migrateStatistics()

    const alpha = rows.readLeaderboardPage({ q: 'alpha' }, 25).players[0]

    expect(alpha).toMatchObject({
      region: 'eu',
      realm: 'gordunni',
      realmName: 'gordunni',
      name: 'alpha',
      displayName: 'Alpha',
      avatar: 'avatar.jpg',
      classId: 1,
      faction: 'alliance',
      level: 90,
      ilvl: 320,
      mounts: 100,
      pets: 50,
      achievements: 1000,
      // The rating is computed from the row's own figures by the formula's weights, and never read off a stored
      // column.
      score: calculatePlayerScore({ achievements: 1000, mounts: 100, pets: 50, toys: 0, decor: 0, reputations: 0 }),
      updatedAt: '2026-10-15',
      firstSeenAt: '2026-10-08'
    })
  })

  it('gathers the widgets over the whole population', async () => {
    const { rows, migrateStatistics } = await modules()
    await migrateStatistics()

    const stats = rows.readGlobalStats()

    expect(stats).toMatchObject({
      players: 6,
      realms: 3,
      classes: 5,
      topClass: { classId: 1, count: 2, share: 33 },
      // The three leaders, each the first row of one order: the most collectables, the best rating, the most
      // decor. A leader holding nothing is reported as no leader at all rather than as a row of zeroes.
      collector: { player: { name: 'gamma' }, value: 200 },
      rating: { player: { name: 'азурмаск' }, value: 3000 },
      architect: { player: { name: 'epsilon' }, value: 1 },
      totals: { mounts: 451, pets: 111, toys: 1, decor: 1, reputations: 1, achievements: 2501 }
    })

    expect(stats.realmsFacet.map((realm) => [realm.realm, realm.count])).toEqual([
      ['gordunni', 3],
      ['kirin-tor', 2],
      ['ysondre', 1]
    ])
    expect(stats.classesFacet).toEqual([
      { classId: 1, count: 2 },
      { classId: 3, count: 1 },
      { classId: 8, count: 1 },
      { classId: 11, count: 1 },
      { classId: 12, count: 1 }
    ])
    expect(stats.factionsFacet).toEqual([
      { faction: 'alliance', count: 5 },
      { faction: 'horde', count: 1 }
    ])
  })

  it('places a member in the overall table, and nobody else anywhere', async () => {
    const { rows, migrateStatistics } = await modules()
    await migrateStatistics()

    const standing = rows.readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'beta' })

    expect(standing?.rank).toBe(3)
    expect(standing?.total).toBe(6)
    expect(standing?.player).toMatchObject({ name: 'beta', displayName: 'Beta' })
    // Nothing at all for a character the table does not draw: there is nothing to say about a row that is not
    // there, and a place would say something the data does not.
    expect(rows.readLeaderboardStanding({ region: 'eu', realm: 'gordunni', name: 'nobody' })).toBeNull()
  })
})

describe('the population the table draws', () => {
  it('draws an account once, by its own totals, and never draws its alts', async () => {
    const { rows } = await modules()

    memory.addUser(42)
    const main = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Main', isMain: true, level: 90 })
    const alt = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Alt', level: 90 })

    for (const [id, mounts] of [[main, 20], [alt, 30]] as const) {
      memory.addSnapshot({
        characterId: id,
        takenAt: 1000,
        mounts,
        pets: 1,
        toys: 1,
        decor: 1,
        reputations: 1,
        achievements: 1
      })
    }

    fileAccountReading(42)

    const page = rows.readLeaderboardPage({}, 25)

    // One row, wearing the account's own figures and the main's identity - and the alt is not a row at all.
    expect(page.total).toBe(1)
    expect(page.players[0]).toMatchObject({ name: 'main', isAccount: true, mounts: 30, level: 90 })
  })

  it('leaves out an account that asked to, and a character nobody has read', async () => {
    const { rows } = await modules()

    memory.addUser(43, true)
    const hidden = memory.addCharacter({ userId: 43, region: 'eu', realm: 'gordunni', name: 'Hidden', isMain: true })
    memory.addSnapshot({
      characterId: hidden,
      takenAt: 1000,
      mounts: 40,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(43)

    // A row the site knows of and has never read: nothing to draw.
    memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Unread' })

    expect(rows.readLeaderboardPage({}, 25).total).toBe(0)
  })

  it('draws an account by the very figures its own history keeps', async () => {
    const { rows } = await modules()

    memory.addUser(42)
    const main = memory.addCharacter({
      userId: 42,
      region: 'eu',
      realm: 'gordunni',
      name: 'Main',
      isMain: true,
      level: 90,
      ilvl: 320
    })

    // A second character wearing better gear, so the row's item level cannot be the roster's best: it is the
    // main's own, the very character the row is named after.
    memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Geared', level: 80, ilvl: 500 })

    memory.addSnapshot({
      characterId: main,
      takenAt: 1000,
      mplus: 1234,
      mounts: 20,
      pets: 3,
      toys: 4,
      decor: 5,
      reputations: 6,
      achievements: 700,
      honorableKills: 90
    })

    fileAccountReading(42)

    const row = rows.readLeaderboardPage({}, 25).players[0]
    const point = memory.db
      .prepare('SELECT * FROM account_snapshots WHERE user_id = 42 ORDER BY taken_at DESC LIMIT 1')
      .get() as Record<string, number | null>
    const character = memory.db.prepare("SELECT ilvl FROM characters WHERE name_key = 'main'").get() as {
      ilvl: number | null
    }

    // The row a reader compares and the point its history draws are the same figures, field for field - which is
    // the whole reason an account's own point is kept rather than one character's reading: a table and a graph
    // cannot disagree about an account when they are read from one place (`./statisticsPopulation`).
    expect(row).toMatchObject({
      mounts: point.mounts,
      pets: point.pets,
      toys: point.toys,
      decor: point.decor,
      reputations: point.reputations,
      achievements: point.achievements,
      honorableKills: point.honorable_kills,
      mPlusScore: point.mplus_score
    })

    // The item level is not one of those figures: it is what a character *wears*, so it is read from the
    // character's own row - the main's, the very character the row is named after - and never from the
    // point, nor from the roster's best gear (`Geared` above wears more of it).
    expect(row?.ilvl).toBe(character.ilvl)
  })

  it('is an empty first page for a table with nothing in it', async () => {
    const { rows } = await modules()

    expect(rows.readLeaderboardPage({}, 25)).toMatchObject({
      players: [],
      total: 0,
      pages: 1,
      page: 1,
      updatedAt: ''
    })
  })
})

describe('the writes that keep the table true', () => {
  it('rewrites a guest row the moment its reading moves', async () => {
    const { rows } = await modules()

    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, reading(10))

    // The first read of a table that has never been built is what builds it; everything after it is the write path,
    // which is the only thing that keeps the table true between two rebuilds.
    expect(rows.readLeaderboardPage({}, 25).players[0]).toMatchObject({ name: 'stranger', mounts: 10 })

    fileDailyReading(id, reading(12))

    // And the table is not rebuilt between the two reads: the version the database's own header carries is the one
    // the rows were rated with, so the second answer is the write path's doing and not a rebuild's.
    expect(memory.db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: SCORE_VERSION })

    // And the stamp the rows themselves are checked against (`ROW_VERSION`, kept in the header's other field): a
    // table written by a build whose rows said something else is rebuilt once, exactly as a changed weight is.
    memory.db.exec('PRAGMA application_id = 1')
    rows.ensurePopulation()

    const rowsStamp = memory.db.prepare('PRAGMA application_id').get() as { application_id: number }
    expect(rowsStamp.application_id).toBeGreaterThan(1)

    const page = rows.readLeaderboardPage({}, 25)

    expect(page.total).toBe(1)
    expect(page.players[0]).toMatchObject({ name: 'stranger', mounts: 12 })
  })

  it('takes a guest out of the table the moment an account claims the character', async () => {
    const { rows } = await modules()

    memory.addUser(42)
    const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })
    fileDailyReading(id, reading(10))

    expect(rows.readLeaderboardPage({}, 25).total).toBe(1)

    // Claimed: the character is an alt now - until the account names it its main - so it stops being a member of the
    // population in its own right, and the row it held as a guest goes with it (`./statisticsPopulation`).
    claimGuestCharacter(42, 'eu', 'gordunni', 'Stranger')

    expect(rows.readLeaderboardPage({}, 25).total).toBe(0)
  })

  it('rewrites an account row the moment its totals move, and keeps it one row', async () => {
    const { rows } = await modules()

    memory.addUser(42)
    const main = memory.addCharacter({
      userId: 42,
      region: 'eu',
      realm: 'gordunni',
      name: 'Main',
      isMain: true,
      level: 90
    })

    memory.addSnapshot({
      characterId: main,
      takenAt: 1000,
      mounts: 20,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(42)

    expect(rows.readLeaderboardPage({}, 25).players[0]).toMatchObject({ name: 'main', mounts: 20 })

    // A later reading of the same character: the account's own point moves, and the row the table draws - which is
    // the account's, not the character's - moves with it.
    memory.addSnapshot({
      characterId: main,
      takenAt: 2000,
      mounts: 30,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
    fileAccountReading(42)

    const page = rows.readLeaderboardPage({}, 25)

    expect(page.total).toBe(1)
    expect(page.players[0]).toMatchObject({ name: 'main', isAccount: true, mounts: 30 })
  })
})
