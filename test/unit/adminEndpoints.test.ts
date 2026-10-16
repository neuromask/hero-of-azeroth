/**
 * The panel's endpoints, called the way Nitro calls them.
 *
 * What is stubbed is the *plumbing* - `defineEventHandler`, `readBody`, the session - and nothing else: the
 * guards, the diagnostics builder, the character lookup and the pragma under test are the real implementations.
 * That is what makes these tests worth having: they are the only place where "no session is a 401, a stranger is
 * a 403, an administrator gets the answer" is checked end to end rather than one function at a time.
 *
 * The refusal is checked for what it *left behind* as well as for its status: a rejected action must not have
 * written anything, and the diagnostics answer must not carry a secret, a token, a BattleTag or a private path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

const session = vi.hoisted(() => ({ requireUser: vi.fn() }))

vi.mock('../../server/utils/session', () => ({ requireUser: session.requireUser }))

import {
  chargeManualRefresh,
  claimManualOperation,
  clearAdminDiagnostics,
  invalidateDiagnosticsCache,
  manualRefreshCoolingDown,
  readAdminDiagnostics,
  readDiagnosticBuffers,
  recordDiagnostic,
  recordManualRefresh,
  releaseManualOperation
} from '../../server/utils/adminDiagnostics'
import { optimizeDatabase, resolveTargetCharacter } from '../../server/utils/adminActions'
import { requireAdmin, requireAdminAction } from '../../server/utils/requireAdmin'
import { getSiteSettings, saveSiteSettings } from '../../server/utils/siteSettings'
import type { SessionUser } from '../../server/utils/session'

/** The one character read, which would otherwise reach Blizzard. It is the only stubbed *behaviour*. */
const refresh = vi.hoisted(() => ({ run: vi.fn() }))

let memory: MemoryDb
let body: unknown = {}
let originHeader: string | undefined
let hostHeader: string | undefined

/** An account, as far as these endpoints care: the guard reads the BattleTag and nothing else. */
function account(battletag: string | null): SessionUser {
  return {
    id: 1,
    bnetSub: 'sub',
    battletag,
    mainCharacterId: null,
    hideFromFame: false,
    authExpired: false,
    accessToken: null,
    refreshToken: null,
    expiresAt: null
  }
}

const admin = () => session.requireUser.mockResolvedValue(account('neuromask#2809'))
const stranger = () => session.requireUser.mockResolvedValue(account('stranger#1234'))
const nobody = () =>
  session.requireUser.mockRejectedValue(Object.assign(new Error('Sign in with Battle.net first'), { statusCode: 401 }))

/**
 * The Nitro globals these modules are written against. Everything taken from a `server/utils` module is the real
 * export; only the framework's own request plumbing is a stub.
 */
const globals = globalThis as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.createError = (input: { statusCode?: number; statusMessage?: string }) =>
  Object.assign(new Error(input?.statusMessage || 'error'), input)
globals.getRequestHeader = (_event: unknown, name: string) =>
  name === 'origin' ? originHeader : name === 'host' ? hostHeader : undefined
globals.readBody = async () => body
globals.setResponseHeader = () => {}
globals.requireAdmin = requireAdmin
globals.requireAdminAction = requireAdminAction
globals.readAdminDiagnostics = readAdminDiagnostics
globals.resolveTargetCharacter = resolveTargetCharacter
globals.optimizeDatabase = optimizeDatabase
globals.saveSiteSettings = saveSiteSettings
globals.claimManualOperation = claimManualOperation
globals.releaseManualOperation = releaseManualOperation
globals.manualRefreshCoolingDown = manualRefreshCoolingDown
globals.chargeManualRefresh = chargeManualRefresh
globals.recordManualRefresh = recordManualRefresh
globals.recordDiagnostic = recordDiagnostic
globals.invalidateDiagnosticsCache = invalidateDiagnosticsCache
globals.refreshCharacterStatsWithOutcome = refresh.run

type Handler = (event: unknown) => Promise<unknown>

const diagnostics = (await import('../../server/api/admin/diagnostics.get')).default as unknown as Handler
const characterRefresh = (await import('../../server/api/admin/character-refresh.post')).default as unknown as Handler
const optimize = (await import('../../server/api/admin/optimize.post')).default as unknown as Handler
const settings = (await import('../../server/api/admin/settings.post')).default as unknown as Handler

/** The status an endpoint refused with, which is the whole answer of a refusal. */
async function statusOf(handler: Handler): Promise<number> {
  try {
    await handler({})
    return 200
  } catch (error) {
    return Number((error as { statusCode?: number }).statusCode || 0)
  }
}

beforeEach(() => {
  memory = createMemoryDb()
  memory.db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
  installUseDb(memory.db)

  clearAdminDiagnostics()
  refresh.run.mockReset()
  body = {}
  originHeader = undefined
  hostHeader = 'heroofazeroth.com'
  session.requireUser.mockReset()

  delete process.env.NUXT_ADMIN_BATTLETAGS
})

afterEach(() => {
  delete process.env.NUXT_ADMIN_BATTLETAGS
})

describe('reading the diagnostics', () => {
  it('answers 401 without a session and 403 for a signed-in stranger', async () => {
    nobody()
    expect(await statusOf(diagnostics)).toBe(401)

    stranger()
    expect(await statusOf(diagnostics)).toBe(403)
  })

  it('answers an administrator with the five sections, and hands over nothing private', async () => {
    admin()

    const answer = (await diagnostics({})) as Record<string, unknown>
    const serialised = JSON.stringify(answer)

    expect(Object.keys(answer)).toEqual(expect.arrayContaining(['system', 'database', 'sync', 'blizzardApi', 'errors']))
    // Nothing a request could have carried, and nothing of the process's own surroundings.
    for (const forbidden of ['accessToken', 'refreshToken', 'password', 'secret', 'battletag', 'Authorization']) {
      expect(serialised).not.toContain(forbidden)
    }
    // The files are named, not located: the panel has no use for a path and a reader has no business knowing one.
    const database = answer.database as { files: { db: { name: string } } }
    expect(database.files.db.name).toBe('hoa.db')
    expect(serialised).not.toContain('\\')

    // And reading the panel costs Blizzard nothing: it is built from what the process already counted, so
    // refreshing it - which the page does every twenty seconds while it is open - spends no quota at all.
    expect(readDiagnosticBuffers().blizzardApi.total).toBe(0)
  })
})

describe('refreshing one character', () => {
  it('is refused to a stranger, and leaves nothing written behind', async () => {
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Main', isMain: true })
    stranger()
    body = { region: 'eu', realm: 'Gordunni', name: 'Main' }

    expect(await statusOf(characterRefresh)).toBe(403)
    // The refusal came before the read, so the character's figures were not touched.
    expect(refresh.run).not.toHaveBeenCalled()
  })

  it('refuses a cross-origin press even from an administrator', async () => {
    admin()
    originHeader = 'https://evil.example'

    expect(await statusOf(characterRefresh)).toBe(403)
    expect(refresh.run).not.toHaveBeenCalled()
  })

  it('answers 404 for an address the site holds no character for, which is the only input it accepts', async () => {
    admin()

    for (const invalid of [
      {},
      { region: 'eu' },
      { region: 'ru', realm: 'gordunni', name: 'main' },
      { region: 'eu', realm: 'gordunni', name: '<script>alert(1)</script>' },
      { characterId: 'not-a-number' }
    ]) {
      body = invalid
      expect(await statusOf(characterRefresh), JSON.stringify(invalid)).toBe(404)
    }

    expect(refresh.run).not.toHaveBeenCalled()
  })

  it('reads the character through the site’s own reader and says whether anything moved', async () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Main', isMain: true })
    admin()
    refresh.run.mockResolvedValue({ profile: { name: 'Main' }, updated: true })

    body = { region: 'eu', realm: 'Gordunni', name: 'Main' }
    await expect(characterRefresh({})).resolves.toEqual({ status: 'updated', characterId: id })

    refresh.run.mockResolvedValue({ profile: { name: 'Main' }, updated: false })
    // A second press a moment later is inside the cooldown, and is told so rather than run again.
    expect(await statusOf(characterRefresh)).toBe(429)
  })

  it('answers 409 while another maintenance operation holds the one slot', async () => {
    admin()
    expect(claimManualOperation('database-optimize')).toBe(true)

    expect(await statusOf(characterRefresh)).toBe(409)

    releaseManualOperation('database-optimize')
  })

  it('passes a failed read on as its own status, and counts it as a failed manual refresh', async () => {
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Gone', isMain: true })
    admin()
    refresh.run.mockRejectedValue(
      Object.assign(new Error('There is no such character on that realm'), { statusCode: 404 })
    )

    body = { region: 'eu', realm: 'Gordunni', name: 'Gone' }

    // Not a 200, and not a softened status: the failure the reader would have seen is the one the operator sees.
    expect(await statusOf(characterRefresh)).toBe(404)

    const buffers = readDiagnosticBuffers()
    expect(buffers.sync.manual).toMatchObject({ count: 1, lastOutcome: 'failed' })
    expect(buffers.errors.some((entry) => entry.message === 'manual character refresh failed')).toBe(true)
  })

  it('finds a character by its record id as well as by its address', async () => {
    const id = memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Main', isMain: true })

    expect(resolveTargetCharacter({ characterId: id })?.name_key).toBe('main')
    expect(resolveTargetCharacter({ region: 'EU', realm: 'Gordunni', name: 'main' })?.id).toBe(id)
    // An address the site holds nobody at is nothing to read.
    expect(resolveTargetCharacter({ region: 'eu', realm: 'gordunni', name: 'nobody' })).toBeNull()
  })
})

describe('the database maintenance step', () => {
  it('is refused to a stranger and to a cross-origin press', async () => {
    stranger()
    expect(await statusOf(optimize)).toBe(403)

    admin()
    originHeader = 'https://evil.example'
    expect(await statusOf(optimize)).toBe(403)
  })

  it('runs the pragma when an administrator asks, and only then', async () => {
    admin()

    const answer = (await optimize({})) as { ok: boolean; durationMs: number }

    expect(answer.ok).toBe(true)
    expect(answer.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('answers 409 while another operation holds the one slot', async () => {
    admin()
    expect(claimManualOperation('character-refresh')).toBe(true)

    expect(await statusOf(optimize)).toBe(409)

    releaseManualOperation('character-refresh')
  })

  it('runs against a throwaway database without rewriting anything', () => {
    memory.addCharacter({ userId: 1, region: 'eu', realm: 'Gordunni', name: 'Main', isMain: true })

    const before = memory.db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number }
    expect(optimizeDatabase().durationMs).toBeGreaterThanOrEqual(0)
    const after = memory.db.prepare('SELECT COUNT(*) AS count FROM characters').get() as { count: number }

    expect(after.count).toBe(before.count)
  })
})

describe('the settings write', () => {
  it('is refused to a stranger, and changes nothing at all', async () => {
    stranger()
    body = { content: { 'about.intro': 'written by nobody' } }

    expect(await statusOf(settings)).toBe(403)
    expect(getSiteSettings().content).toEqual({})
  })

  it('is refused to a cross-origin press, and written for an administrator', async () => {
    admin()
    originHeader = 'https://evil.example'
    body = { content: { 'about.intro': 'nope' } }

    expect(await statusOf(settings)).toBe(403)
    expect(getSiteSettings().content).toEqual({})

    originHeader = 'https://heroofazeroth.com'
    await expect(settings({})).resolves.toMatchObject({ content: { 'about.intro': 'nope' } })
  })
})
