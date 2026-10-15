/**
 * The characters the site has read that no account holds.
 *
 * A character page is a lookup by anyone, signed in or not, so the site's own record of a character cannot be
 * kept for accounts alone: a stranger's reading has to have a row to be filed against. That row is a guest -
 * the same row an account's character gets, with no owner - and these tests are about the two things it has to
 * mean: the reading lands on it, with the history a comparison board draws, and nothing that belongs to an
 * account picks it up.
 *
 * The JSON stores the profile feed also writes are pointed at a throwaway directory first
 * (`NUXT_DATA_DIR`, see `./appPaths`), because a test must never touch the data a running site has written.
 * The import below is dynamic for exactly that reason: those modules read the path once, when they load.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterData } from '../../server/utils/blizzard'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

const data = mkdtempSync(join(tmpdir(), 'hoa-guests-'))
process.env.NUXT_DATA_DIR = data

const { feedProfile } = await import('../../server/utils/profileFeed')
const { readCharacterHistory } = await import('../../server/utils/characterReading')
const { accountOwnerId, accountTotalsByCharacterKey } = await import('../../server/utils/accountPool')
const { claimGuestCharacter } = await import('../../server/utils/accountSync')

// The profile feed reaches for one more of the server's auto-imports, which Nitro hands it as a free global: in
// a test it is wired by hand, exactly as `useDb` is (`installUseDb` in the helper beside this file).
const { rememberCharacter } = await import('../../server/utils/characterIndex')
;(globalThis as Record<string, unknown>).rememberCharacter = rememberCharacter

afterAll(() => {
  rmSync(data, { recursive: true, force: true })
  delete process.env.NUXT_DATA_DIR
})

let memory: MemoryDb

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
})

/** A profile as the lookup hands one over, with the figures a reading is made of. */
function profile(): CharacterData {
  return {
    name: 'Stranger',
    title: '',
    level: 90,
    race: 'Human',
    class: 'Warrior',
    spec: 'Arms',
    guild: '',
    realm: 'Gordunni',
    faction: 'HORDE',
    ap: 10000,
    ilvl: 320,
    mPlusScore: 2500,
    renderUrl: '',
    avatarUrl: 'avatar.jpg',
    classId: 1,
    raceId: 1,
    gender: 'MALE',
    backgroundUrl: '',
    stats: {
      mounts: { count: 100, total: 800 },
      pets: { count: 200, total: 1400 },
      toys: { count: 300, total: 900 },
      decor: { count: 400, total: 1200 },
      reputations: { count: 50, total: 230, accountWide: false },
      achievements: { count: 10000, total: 50000 },
      titles: { count: 5 },
      quests: { count: 6 },
      recipes: { count: 7 },
      honorableKills: { count: 8 },
      honorLevel: { count: 9 }
    }
  }
}

describe('a reading of a character no account holds', () => {
  it('files the character as a guest, with the reading behind it', async () => {
    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })

    const row = memory.db.prepare("SELECT * FROM characters WHERE name_key = 'stranger'").get() as Record<string, unknown>
    expect(row.user_id).toBeNull()
    expect(row.display_name).toBe('Stranger')
    expect(row.realm_name).toBe('Gordunni')
    expect(row.level).toBe(90)
    expect(row.faction).toBe('horde')
    expect(row.avatar).toBe('avatar.jpg')
    // The day the site met the character, which the hall of fame's table prints: written once, when the row is.
    expect(row.first_seen_at).toBeGreaterThan(0)

    // The reading is what a history is drawn from, and it is filed by the same code that files an account's.
    const history = readCharacterHistory('eu', 'gordunni', 'stranger', 'mounts')
    expect(history?.points).toEqual([{ takenAt: expect.any(Number), value: 100 }])
  })

  it('does not make the character an account\'s own', async () => {
    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })

    expect(accountOwnerId('eu', 'gordunni', 'stranger')).toBeNull()
  })

  it('is answered with its own figures, with no account totals standing behind them', async () => {
    memory.addUser(42)
    memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Owned' })
    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })

    // The hall of fame merges an account's own figures into its main's row, keyed by address: a guest must not be
    // in that map at all, or its row would print numbers that belong to nobody.
    const totals = accountTotalsByCharacterKey()
    expect(totals.has('eu:gordunni:owned')).toBe(true)
    expect(totals.has('eu:gordunni:stranger')).toBe(false)
  })

  it('keeps one row for a character read again', async () => {
    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })
    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })

    expect(memory.db.prepare("SELECT COUNT(*) AS n FROM characters WHERE name_key = 'stranger'").get()).toMatchObject({
      n: 1
    })
  })

  it('files against the account\'s own row when the character belongs to one', async () => {
    memory.addUser(42)
    const id = memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Stranger' })

    await feedProfile({ region: 'eu', realm: 'gordunni', name: 'stranger', profile: profile(), reading: true })

    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
    expect(memory.db.prepare('SELECT user_id FROM characters WHERE id = ?').get(id)).toMatchObject({ user_id: 42 })
    expect(accountOwnerId('eu', 'gordunni', 'stranger')).toBe(42)
    expect(readCharacterHistory('eu', 'gordunni', 'stranger', 'mounts')?.points).toHaveLength(1)
  })
})

describe('an account that signs in for a character already on file', () => {
  it('hands the guest row over rather than writing a second one', () => {
    memory.addUser(42)
    const guest = memory.addGuestCharacter({ region: 'eu', realm: 'gordunni', name: 'Stranger' })

    claimGuestCharacter(42, 'eu', 'gordunni', 'Stranger')

    expect(memory.db.prepare('SELECT COUNT(*) AS n FROM characters').get()).toMatchObject({ n: 1 })
    expect(memory.db.prepare('SELECT user_id FROM characters WHERE id = ?').get(guest)).toMatchObject({ user_id: 42 })
    expect(accountOwnerId('eu', 'gordunni', 'stranger')).toBe(42)
  })

  it('leaves a character that already belongs to somebody else alone', () => {
    memory.addUser(42)
    memory.addUser(43)
    const owned = memory.addCharacter({ userId: 43, region: 'eu', realm: 'gordunni', name: 'Stranger' })

    claimGuestCharacter(42, 'eu', 'gordunni', 'Stranger')

    expect(memory.db.prepare('SELECT user_id FROM characters WHERE id = ?').get(owned)).toMatchObject({ user_id: 43 })
    expect(accountOwnerId('eu', 'gordunni', 'stranger')).toBe(43)
  })
})
