/**
 * The maintenance of the materialised table: what one write does to a row, and what a write that fails leaves
 * behind.
 *
 * Two things are pinned here, and both are the reason the writes are shaped the way they are.
 *
 * The first is **atomicity**. A row is taken out and written back, and a failure between the two used to lose
 * the member for good: the table's version stamp would still say it was current, so nothing would ever rebuild
 * the row (`ensurePopulation`). A test below fails the write at exactly that moment and asks for the row back.
 *
 * The second is **what a row is made of**. A row is not the member's figures alone - it carries the level, the
 * item level the character wears, the portrait and the name, none of which is a metric - so a re-read that moved
 * only one of those has to move the row while the history keeps the point it had. The reads that used to file a
 * point and stop when nothing had moved left exactly that row stale, for a guest and for an account alike.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { fileAccountReading } from '../../server/utils/accountPool'
import { fileDailyReading } from '../../server/utils/characterReading'
import { ensurePopulation, refreshAccountRow, refreshGuestRow } from '../../server/utils/leaderboardRows'
import { statisticsRevision } from '../../server/utils/statisticsPopulation'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** A profile as `fileDailyReading` reads one: the six collections, the item level, and the facts beside them. */
function reading(input: {
  mounts: number
  ilvl?: number
  ap?: number
  level?: number
  avatar?: string
}): never {
  return {
    name: 'Stranger',
    realm: 'Gordunni',
    level: input.level ?? 90,
    faction: 'HORDE',
    classId: 1,
    avatarUrl: input.avatar ?? '',
    ilvl: input.ilvl ?? 300,
    mPlusScore: 0,
    ap: input.ap ?? 1000,
    stats: {
      mounts: { count: input.mounts },
      pets: { count: 1 },
      toys: { count: 1 },
      decor: { count: 1 },
      reputations: { count: 1 }
    }
  } as never
}

/** One row of the table, as the database holds it. */
function row(region: string, realm: string, name: string): Record<string, unknown> | undefined {
  return memory.db
    .prepare('SELECT * FROM leaderboard WHERE region = ? AND realm_slug = ? AND name_key = ?')
    .get(region, realm, name) as Record<string, unknown> | undefined
}

/** The account's own row, which is drawn under the character it leads with. */
function accountRow(): Record<string, unknown> | undefined {
  return memory.db.prepare('SELECT * FROM leaderboard WHERE is_account = 1').get() as Record<string, unknown> | undefined
}

/** How many readings a character has on file. */
function points(characterId: number): number {
  return (memory.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE character_id = ?').get(characterId) as { n: number }).n
}

/** How many points of history an account has on file. */
function accountPoints(userId: number): number {
  return (
    memory.db.prepare('SELECT COUNT(*) AS n FROM account_snapshots WHERE user_id = ?').get(userId) as { n: number }
  ).n
}

/** A guest with one reading, and the table built from it. */
function guest(name = 'Stranger'): number {
  const id = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name })
  fileDailyReading(id, reading({ mounts: 10 }))
  ensurePopulation()
  return id
}

/** An account whose main and alt are both read in full, and the table built from them. */
function account(): { userId: number; main: number; alt: number } {
  const userId = 42
  memory.addUser(userId)

  const main = memory.addCharacter({
    userId,
    region: 'eu',
    realm: 'gordunni',
    name: 'Mainchar',
    isMain: true,
    level: 90,
    ilvl: 320
  })
  const alt = memory.addCharacter({ userId, region: 'eu', realm: 'gordunni', name: 'Altchar', level: 80, ilvl: 350 })

  for (const id of [main, alt]) {
    memory.addSnapshot({
      characterId: id,
      takenAt: 1000,
      mplus: 0,
      mounts: id === main ? 100 : 200,
      pets: 1,
      toys: 1,
      decor: 1,
      reputations: 1,
      achievements: 1
    })
  }

  fileAccountReading(userId)
  ensurePopulation()
  return { userId, main, alt }
}

/**
 * Runs `work` with the row insert failing, which is the one moment the maintenance may not lose a member.
 *
 * The reader the modules are handed is the real database behind a proxy whose `prepare` refuses the insert - so
 * the delete before it has already run, inside the transaction, and what the row looks like afterwards is
 * exactly what is being asked.
 */
function withFailingWrite(work: () => void): void {
  const real = (globalThis as Record<string, unknown>).useDb as () => DatabaseSync

  ;(globalThis as Record<string, unknown>).useDb = () =>
    new Proxy(memory.db, {
      get(target, property) {
        if (property !== 'prepare') {
          const value = Reflect.get(target, property) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }

        return (sql: string) => {
          if (/INSERT OR REPLACE INTO leaderboard/i.test(sql)) throw new Error('the write failed')
          return target.prepare(sql)
        }
      }
    })

  try {
    expect(work).toThrow('the write failed')
  } finally {
    ;(globalThis as Record<string, unknown>).useDb = real
  }
}

describe('a row write that fails half-way', () => {
  it('leaves a guest exactly as it was, rather than dropping the member', () => {
    const id = guest()
    const before = row('eu', 'gordunni', 'stranger')
    expect(before).toMatchObject({ mounts: 10, ilvl: 300 })

    // The character wears better gear now, so the row has to be rewritten - and the write fails after the old
    // row has been taken out, which is the moment a half-done write loses a member for good.
    memory.db.prepare('UPDATE characters SET ilvl = 400 WHERE id = ?').run(id)
    withFailingWrite(() => refreshGuestRow('eu', 'gordunni', 'stranger'))

    expect(row('eu', 'gordunni', 'stranger')).toEqual(before)
  })

  it('leaves an account exactly as it was, rather than dropping the member', () => {
    const { main } = account()
    const before = accountRow()
    expect(before).toMatchObject({ name_key: 'mainchar', ilvl: 320, mounts: 200 })

    memory.db.prepare('UPDATE characters SET ilvl = 400 WHERE id = ?').run(main)
    withFailingWrite(() => refreshAccountRow(42))

    expect(accountRow()).toEqual(before)
  })

  it('is still current afterwards, so the next write lands on the row that survived', () => {
    const id = guest()
    memory.db.prepare('UPDATE characters SET ilvl = 400 WHERE id = ?').run(id)

    withFailingWrite(() => refreshGuestRow('eu', 'gordunni', 'stranger'))

    // The header was never touched, so nothing thinks the table has to be rebuilt - and the row is the one that
    // was there, not a half-written one.
    expect(memory.db.prepare('PRAGMA application_id').get()).toMatchObject({ application_id: expect.any(Number) })
    expect(row('eu', 'gordunni', 'stranger')).toMatchObject({ ilvl: 300 })

    // The same write, this time allowed through: the row moves and no second member appears.
    refreshGuestRow('eu', 'gordunni', 'stranger')
    expect(row('eu', 'gordunni', 'stranger')).toMatchObject({ ilvl: 400 })
    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM leaderboard').get()).toMatchObject({ n: 1 })
  })
})

describe('a re-read that moved one field and no collection', () => {
  it('moves a guest row for the item level alone, and files no point', () => {
    const id = guest()

    fileDailyReading(id, reading({ mounts: 10, ilvl: 400 }))

    // The history did not move - the six figures are the ones the newest point already holds - but the row did,
    // because the item level is read from the character rather than from the point.
    expect(points(id)).toBe(1)
    expect(memory.db.prepare('SELECT ilvl FROM characters WHERE id = ?').get(id)).toMatchObject({ ilvl: 400 })
    expect(row('eu', 'gordunni', 'stranger')).toMatchObject({ ilvl: 400, mounts: 10 })
  })

  it('moves a guest row for the portrait, the level and the name alone', () => {
    const id = guest()

    memory.db
      .prepare('UPDATE characters SET avatar = ?, level = ?, display_name = ? WHERE id = ?')
      .run('new-portrait.jpg', 80, 'Renamed', id)

    fileDailyReading(id, reading({ mounts: 10, ilvl: 300 }))

    expect(points(id)).toBe(1)
    expect(row('eu', 'gordunni', 'stranger')).toMatchObject({
      avatar: 'new-portrait.jpg',
      level: 80,
      display_name: 'Renamed'
    })
  })

  it("moves an account row for the main's item level alone, and files no point", () => {
    const { userId, main } = account()

    // The alt wears better gear than the main, and the row is the main's: it must print the main's item level.
    memory.db.prepare('UPDATE characters SET ilvl = 400 WHERE id = ?').run(main)
    fileAccountReading(userId)

    expect(accountPoints(userId)).toBe(1)
    expect(accountRow()).toMatchObject({ name_key: 'mainchar', ilvl: 400, mounts: 200 })
  })

  it("moves an account row for the main's portrait, level and name alone", () => {
    const { userId, main } = account()

    memory.db
      .prepare('UPDATE characters SET avatar = ?, level = ?, display_name = ? WHERE id = ?')
      .run('main-portrait.jpg', 85, 'Mainrenamed', main)

    fileAccountReading(userId)

    expect(accountPoints(userId)).toBe(1)
    expect(accountRow()).toMatchObject({
      avatar: 'main-portrait.jpg',
      level: 85,
      display_name: 'Mainrenamed',
      ilvl: 320
    })
  })

  it('does not move the revision for a write that changes nothing at all', () => {
    const id = guest()
    const before = statisticsRevision()

    // The same figures and the same item level: no point is filed and the row says what it already said.
    fileDailyReading(id, reading({ mounts: 10, ilvl: 300 }))

    expect(statisticsRevision()).toBe(before)
    expect(points(id)).toBe(1)

    // A figure that moved is a different matter: the revision moves with it, which is what throws away the
    // memos of the population and the cache the leaderboard is served from.
    fileDailyReading(id, reading({ mounts: 11, ilvl: 300 }))

    expect(statisticsRevision()).toBeGreaterThan(before)
    expect(row('eu', 'gordunni', 'stranger')).toMatchObject({ mounts: 11 })
  })
})

