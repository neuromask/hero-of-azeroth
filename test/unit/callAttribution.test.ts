/**
 * Every Blizzard request is counted once, under the thing that asked for it, and the parts add up to the whole.
 *
 * Before this the sign-in's own Battle.net requests (the code exchange, `userinfo`, the account summary and its
 * collections) were a `$fetch` of their own: they had a deadline but no counter, so the panel's total was short by
 * every sign-in. And Blizzard's web hosts - the Armoury page and the render CDN - were counted nowhere. These tests pin
 * the attribution vocabulary and that the two kinds of traffic are kept apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

let asked: string[] = []

beforeEach(() => {
  asked = []
  vi.resetModules()
  installUseDb(createMemoryDb().db)
  const g = globalThis as Record<string, unknown>
  g.useRuntimeConfig = () => ({
    blizzardClientId: 'isolated-client',
    blizzardClientSecret: 'isolated-secret',
    public: { siteUrl: 'https://example.test' }
  })
  g.createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
  g.$fetch = (url: string) => {
    asked.push(url)
    if (url.includes('/oauth/token')) return Promise.resolve({ access_token: 'isolated-token', expires_in: 86400 })
    if (url.includes('/oauth/userinfo')) return Promise.resolve({ sub: '1', battletag: 'X#1' })
    if (url.includes('/profile/user/wow')) return Promise.resolve({ wow_accounts: [] })
    if (url.includes('render.worldofwarcraft.com')) return Promise.reject(Object.assign(new Error('x'), { statusCode: 404 }))
    return Promise.resolve({ realms: [] })
  }
})

describe('the attribution of a Blizzard request', () => {
  it('counts a reader’s Battle.net requests, as their own category, under the source that asked', async () => {
    const { getUserInfo, getAccountProfile, refreshAccessToken } = await import('../../server/utils/bnetOAuth')
    const { runWithBlizzardSource } = await import('../../server/utils/blizzardSource')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    await runWithBlizzardSource('account_refresh', async () => {
      await refreshAccessToken('eu', 'a-refresh-token')
      await getUserInfo('eu', 'a-reader-token')
      await getAccountProfile('eu', 'a-reader-token')
    })

    const report = readDiagnosticBuffers().blizzardApi
    expect(report.total).toBe(3)
    expect(report.bySource).toEqual([expect.objectContaining({ source: 'account_refresh', calls: 3 })])
    // The renewal posts to the token URL the site's own token uses, but it is the reader's, and says so.
    expect(report.byCategory.find((row) => row.category === 'oauth')?.calls).toBe(2)
    expect(report.byCategory.find((row) => row.category === 'account')?.calls).toBe(1)
    expect(report.byCategory.some((row) => row.category === 'token')).toBe(false)
    // Nothing of the reader's token reaches the panel.
    expect(JSON.stringify(readDiagnosticBuffers())).not.toContain('a-reader-token')
  })

  it('files the realm list under its own source, and the parts add up to the total', async () => {
    const { getRealms } = await import('../../server/utils/blizzard')
    const { runWithBlizzardSource } = await import('../../server/utils/blizzardSource')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    await runWithBlizzardSource('realm_list', () => getRealms('eu', 'en_US'))

    const report = readDiagnosticBuffers().blizzardApi
    expect(report.bySource).toEqual([expect.objectContaining({ source: 'realm_list', calls: 2 })])
    expect(report.bySource.reduce((sum, row) => sum + row.calls, 0)).toBe(report.total)
  })

  it('counts Blizzard’s web hosts apart from the API, with a deadline of their own', async () => {
    const { resolveArmoryBackground } = await import('../../server/utils/armory')
    const { readDiagnosticBuffers } = await import('../../server/utils/adminDiagnostics')

    // Mage: one class artwork candidate on the render CDN, which this stub refuses.
    expect(await resolveArmoryBackground({ classId: 8 })).toBe('')

    const report = readDiagnosticBuffers().blizzardApi
    expect(report.total).toBe(0)
    expect(report.external).toEqual([expect.objectContaining({ target: 'render_cdn', calls: asked.length, failed: asked.length })])
  })
})
