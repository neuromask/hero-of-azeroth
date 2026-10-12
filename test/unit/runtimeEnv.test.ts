/**
 * The `.env` beside the running server, and the bridge to the settings that are read without a request.
 *
 * The app is uploaded as a directory and started with `node server/index.mjs`, so the file in *that* directory
 * is what should configure it - and `loadRuntimeEnv` is what reads it into `process.env`, where Nitro looks
 * for values as it answers a request. Two things these tests pin, because they are the difference between a
 * host being configured by its file and not: a variable that is already set for the process wins over the
 * file, and a caller that has no request to hand over (`privateSetting`) still finds what the file said.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRuntimeEnv, missingSettings, privateSetting } from '../../server/utils/runtimeEnv'

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
  it('puts what it holds into the environment, and says which file it was', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_BLIZZARD_CLIENT_ID=from-the-file\nNUXT_SESSION_PASSWORD="a quoted key"\n')
    setEnv('NUXT_BLIZZARD_CLIENT_ID', undefined)
    setEnv('NUXT_SESSION_PASSWORD', undefined)

    expect(loadRuntimeEnv(file)).toEqual({ file, taken: 2 })
    expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('from-the-file')
    expect(process.env.NUXT_SESSION_PASSWORD).toBe('a quoted key')
  })

  it('leaves a variable that is already set for the process alone, the way Nuxt resolves .env', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_BLIZZARD_CLIENT_ID=from-the-file\n')
    setEnv('NUXT_BLIZZARD_CLIENT_ID', 'from-the-process')

    expect(loadRuntimeEnv(file)).toEqual({ file, taken: 0 })
    expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('from-the-process')
  })

  it('is quiet about a host that has no file', () => {
    expect(loadRuntimeEnv(join(dir, 'nothing-here'))).toEqual({ file: null, taken: 0 })
  })

  it('is quiet about something it cannot read as a file at all', () => {
    expect(loadRuntimeEnv(dir)).toEqual({ file: null, taken: 0 })
  })

  it('reads a file an editor saved with a byte-order mark', () => {
    // Notepad and its like write one. Left in place it becomes part of the *first* key, so that key quietly
    // never arrives - a credential pair with a missing half, which is answered with a 401 for reasons that
    // look like the credentials themselves.
    const file = join(dir, '.env')
    writeFileSync(file, '\uFEFFNUXT_BLIZZARD_CLIENT_ID=file-client\nNUXT_BLIZZARD_CLIENT_SECRET=file-secret\n')
    setEnv('NUXT_BLIZZARD_CLIENT_ID', undefined)
    setEnv('NUXT_BLIZZARD_CLIENT_SECRET', undefined)

    expect(loadRuntimeEnv(file)).toEqual({ file, taken: 2 })
    expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('file-client')
    expect(process.env.NUXT_BLIZZARD_CLIENT_SECRET).toBe('file-secret')
  })

  it('does not overrule what it already took, so reading it twice changes nothing', () => {
    const file = join(dir, '.env')
    writeFileSync(file, 'NUXT_SESSION_PASSWORD=one\n')
    setEnv('NUXT_SESSION_PASSWORD', undefined)

    expect(loadRuntimeEnv(file)).toEqual({ file, taken: 1 })
    expect(loadRuntimeEnv(file)).toEqual({ file, taken: 0 })
    expect(process.env.NUXT_SESSION_PASSWORD).toBe('one')
  })

  it('finds it beside the app even when the working directory is somewhere else', () => {
    // The deploy leaves `.env` beside `server/`, and a host may start the app with a working directory of its
    // own - which is exactly the state a site whose credentials look "missing" is in.
    const app = join(dir, 'app')
    const elsewhere = join(dir, 'elsewhere')
    mkdirSync(join(app, 'server'), { recursive: true })
    mkdirSync(elsewhere, { recursive: true })
    writeFileSync(join(app, '.env'), 'NUXT_BLIZZARD_CLIENT_ID=beside-the-app\n')

    const argv = process.argv[1]
    const cwd = process.cwd()

    try {
      process.chdir(elsewhere)
      process.argv[1] = join(app, 'server', 'index.mjs')
      setEnv('NUXT_BLIZZARD_CLIENT_ID', undefined)

      expect(loadRuntimeEnv()).toEqual({ file: join(app, '.env'), taken: 1 })
      expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('beside-the-app')
    } finally {
      process.chdir(cwd)
      process.argv[1] = argv
    }
  })

  it('prefers the working directory when the file is there', () => {
    const here = join(dir, 'here')
    const app = join(dir, 'app')
    mkdirSync(join(app, 'server'), { recursive: true })
    mkdirSync(here, { recursive: true })
    writeFileSync(join(here, '.env'), 'NUXT_BLIZZARD_CLIENT_ID=from-the-working-directory\n')
    writeFileSync(join(app, '.env'), 'NUXT_BLIZZARD_CLIENT_ID=beside-the-app\n')

    const argv = process.argv[1]
    const cwd = process.cwd()

    try {
      process.chdir(here)
      process.argv[1] = join(app, 'server', 'index.mjs')
      setEnv('NUXT_BLIZZARD_CLIENT_ID', undefined)

      expect(loadRuntimeEnv().file).toBe(join(here, '.env'))
      expect(process.env.NUXT_BLIZZARD_CLIENT_ID).toBe('from-the-working-directory')
    } finally {
      process.chdir(cwd)
      process.argv[1] = argv
    }
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

describe('the settings the site cannot work without', () => {
  it('names the ones still missing once the file has been read', () => {
    setEnv('NUXT_BLIZZARD_CLIENT_ID', 'set')
    setEnv('NUXT_BLIZZARD_CLIENT_SECRET', undefined)
    setEnv('NUXT_SESSION_PASSWORD', '')

    expect(missingSettings()).toEqual(['NUXT_BLIZZARD_CLIENT_SECRET', 'NUXT_SESSION_PASSWORD'])
  })

  it('names none of them when everything is in place', () => {
    setEnv('NUXT_BLIZZARD_CLIENT_ID', 'set')
    setEnv('NUXT_BLIZZARD_CLIENT_SECRET', 'set')
    setEnv('NUXT_SESSION_PASSWORD', 'set')

    expect(missingSettings()).toEqual([])
  })
})
