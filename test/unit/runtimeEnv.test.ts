/**
 * The `.env` beside the running server, and the bridge to the settings that are read without a request.
 *
 * The app is uploaded as a directory and started with `node server/index.mjs`, so the file in *that* directory
 * is what should configure it - and `loadRuntimeEnv` is what reads it into `process.env`, where Nitro looks
 * for values as it answers a request. Two things these tests pin, because they are the difference between a
 * host being configured by its file and not: a variable that is already set for the process wins over the
 * file, and a caller that has no request to hand over (`privateSetting`) still finds what the file said.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRuntimeEnv, privateSetting } from '../../server/utils/runtimeEnv'

let dir = ''
const touched = new Set<string>()

/** Sets a variable the way a test needs it, remembering the key so the process is put back afterwards. */
function setEnv(key: string, value: string | undefined): void {
  touched.add(key)
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hoa-env-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  for (const key of touched) delete process.env[key]
  touched.clear()
})

describe('the .env beside the running server', () => {
  it('puts what it holds into the environment, and says how much it took', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_BLIZZARD_CLIENT_ID=from-the-file\nNUXT_SESSION_PASSWORD="a quoted key"\n')
    setEnv('NUXT_BLIZZARD_CLIENT_ID', undefined)
    setEnv('NUXT_SESSION_PASSWORD', undefined)

    expect(loadRuntimeEnv(file)).toBe(2)
    expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('from-the-file')
    expect(process.env.NUXT_SESSION_PASSWORD).toBe('a quoted key')
  })

  it('leaves a variable that is already set for the process alone, the way Nuxt resolves .env', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_BLIZZARD_CLIENT_ID=from-the-file\n')
    setEnv('NUXT_BLIZZARD_CLIENT_ID', 'from-the-process')

    expect(loadRuntimeEnv(file)).toBe(0)
    expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('from-the-process')
  })

  it('is quiet about a host that has no file', () => {
    expect(loadRuntimeEnv(join(dir, 'nothing-here'))).toBe(0)
  })

  it('is quiet about something it cannot read as a file at all', () => {
    expect(loadRuntimeEnv(dir)).toBe(0)
  })

  it('does not overrule what it already took, so reading it twice changes nothing', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_SESSION_PASSWORD=one\n')
    setEnv('NUXT_SESSION_PASSWORD', undefined)

    expect(loadRuntimeEnv(file)).toBe(1)
    expect(loadRuntimeEnv(file)).toBe(0)
    expect(process.env.NUXT_SESSION_PASSWORD).toBe('one')
  })
})

describe('a setting read without a request', () => {
  it('prefers the environment, which is where the .env was read into', () => {
    setEnv('NUXT_TRUST_PROXY', '1')
    expect(privateSetting('NUXT_TRUST_PROXY', '')).toBe('1')
  })

  it('falls back to what the build carries when the environment is silent', () => {
    setEnv('NUXT_TRUST_PROXY', undefined)
    expect(privateSetting('NUXT_TRUST_PROXY', '')).toBe('')
    expect(privateSetting('NUXT_MISSING_ENTIRELY', 'baked')).toBe('baked')
  })

  it('treats an empty variable as one that was never set', () => {
    setEnv('NUXT_SESSION_PASSWORD', '')
    expect(privateSetting('NUXT_SESSION_PASSWORD', 'baked')).toBe('baked')
  })
})
