/**
 * Who may call the panel's endpoints, and what a refusal leaves behind.
 *
 * The site's authorization is two questions - is anybody signed in, and is the account an administrator - and
 * the whole point of the guard is that every endpoint asks both, in that order, before it does anything at all.
 * These tests pin the three answers (`401`, `403`, and through) and the one addition: a state-changing request
 * is checked against the browser's own `Origin`, which is the CSRF guard this app can honestly have - it has no
 * token system, and inventing one beside the session cookie would be a second mechanism to get wrong.
 *
 * The session is mocked rather than simulated: what is under test here is the guard's own decisions, and the
 * signature that answers "who is signed in" belongs to `server/utils/session` and is tested with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb, type MemoryDb } from '../helpers/memoryDb'

const session = vi.hoisted(() => ({ requireUser: vi.fn() }))

vi.mock('../../server/utils/session', () => ({ requireUser: session.requireUser }))

import { clearAdminDiagnostics, readDiagnosticBuffers } from '../../server/utils/adminDiagnostics'
import { assertSameOrigin, requireAdmin, requireAdminAction } from '../../server/utils/requireAdmin'
import type { SessionUser } from '../../server/utils/session'

let memory: MemoryDb
let originHeader: string | undefined
let hostHeader: string | undefined

/** An account, as far as this test cares: the guard reads the BattleTag and nothing else. */
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

beforeEach(() => {
  memory = createMemoryDb()
  installUseDb(memory.db)
  clearAdminDiagnostics()

  delete process.env.NUXT_ADMIN_BATTLETAGS
  session.requireUser.mockReset()

  originHeader = undefined
  hostHeader = 'heroofazeroth.com'

  const globals = globalThis as Record<string, unknown>
  globals.createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
  globals.getRequestHeader = (_event: unknown, name: string) =>
    name === 'origin' ? originHeader : name === 'host' ? hostHeader : undefined
})

afterEach(() => {
  delete process.env.NUXT_ADMIN_BATTLETAGS
})

describe('the sign-in question', () => {
  it('answers 401 when nobody is signed in, which is the session layer’s own refusal', async () => {
    session.requireUser.mockRejectedValue(Object.assign(new Error('Sign in with Battle.net first'), { statusCode: 401 }))

    await expect(requireAdmin({} as never)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('answers 403 for a reader who is somebody, just not an administrator', async () => {
    session.requireUser.mockResolvedValue(account('stranger#1234'))

    await expect(requireAdmin({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('answers 403 for an account with no BattleTag at all', async () => {
    session.requireUser.mockResolvedValue(account(null))

    await expect(requireAdmin({} as never)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets an administrator through, and hands them back', async () => {
    const admin = account('neuromask#2809')
    session.requireUser.mockResolvedValue(admin)

    await expect(requireAdmin({} as never)).resolves.toBe(admin)
  })

  it('files a refusal without naming the BattleTag that was refused', async () => {
    session.requireUser.mockResolvedValue(account('stranger#1234'))

    await expect(requireAdmin({} as never)).rejects.toBeTruthy()

    const [entry] = readDiagnosticBuffers().errors
    expect(entry!.category).toBe('admin')
    expect(entry!.message).not.toContain('stranger')
  })
})

describe('the origin question', () => {
  it('lets a request with no Origin through: it is not a page of this site making a claim', () => {
    expect(() => assertSameOrigin({} as never)).not.toThrow()
  })

  it('lets this site’s own Origin through', () => {
    originHeader = 'https://heroofazeroth.com'
    expect(() => assertSameOrigin({} as never)).not.toThrow()
  })

  it('refuses another site’s Origin', () => {
    originHeader = 'https://evil.example'

    expect(() => assertSameOrigin({} as never)).toThrowError(
      expect.objectContaining({ statusCode: 403 }) as unknown as Error
    )
  })

  it('refuses an Origin that is not a URL, and one that disagrees with the Host', () => {
    originHeader = 'not-a-url'
    expect(() => assertSameOrigin({} as never)).toThrow()

    originHeader = 'https://heroofazeroth.com'
    hostHeader = 'somewhere.else'
    expect(() => assertSameOrigin({} as never)).toThrow()
  })
})

describe('an action that will write', () => {
  it('is refused before anything is read when the Origin is somebody else’s, and does not touch the session', async () => {
    originHeader = 'https://evil.example'
    session.requireUser.mockResolvedValue(account('neuromask#2809'))

    await expect(requireAdminAction({} as never)).rejects.toMatchObject({ statusCode: 403 })
    // Nothing of the work has happened: the guard is the first statement, so no state was read from the request.
    expect(session.requireUser).not.toHaveBeenCalled()
  })

  it('still asks the administrator question once the Origin is this site’s own', async () => {
    originHeader = 'https://heroofazeroth.com'
    session.requireUser.mockResolvedValue(account('stranger#1234'))

    await expect(requireAdminAction({} as never)).rejects.toMatchObject({ statusCode: 403 })
    expect(session.requireUser).toHaveBeenCalledTimes(1)
  })
})
