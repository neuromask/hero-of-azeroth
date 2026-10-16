/**
 * Where the app thinks it is, and where its data goes.
 *
 * This pair is what keeps a site's data directory from depending on how its process was started. With the
 * working directory in charge, a host that starts `node /somewhere/app/server/index.mjs` from a panel of its
 * own writes into a second, empty directory: the site's front page comes up blank while the real data sits
 * untouched in the directory the previous process used. The cases below are the ones that matter - the
 * packaged app, a checkout (`npm run dev`, where the entry is the Nuxt CLI inside `node_modules`), and
 * `NUXT_DATA_DIR`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appDirectory, dataDirectory } from '../../server/utils/appPaths'

let dir = ''
const touched = new Set<string>()

/** Sets a variable the way a test needs it, remembering the key so the process is put back afterwards. */
function setEnv(key: string, value: string | undefined): void {
  touched.add(key)
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hoa-paths-'))

  // The environment is put back before every case, not only after it: `dataDirectory()` reads `NUXT_DATA_DIR`
  // at call time, so a test file that points the site's data somewhere for its own reasons must not decide what
  // this one sees. Without this the cases below pass or fail on which files happened to run beside them.
  touched.add('NUXT_DATA_DIR')
  delete process.env.NUXT_DATA_DIR
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  for (const key of touched) delete process.env[key]
  touched.clear()
})

describe('the directory the app runs from', () => {
  it('is the one above the built server, whatever the working directory is', () => {
    const app = join(dir, 'app')
    mkdirSync(join(app, 'server'), { recursive: true })
    writeFileSync(join(app, 'server', 'index.mjs'), '// the built server')

    const argv = process.argv[1]
    const cwd = process.cwd()

    try {
      process.argv[1] = join(app, 'server', 'index.mjs')
      process.chdir(tmpdir())

      expect(appDirectory()).toBe(app)
      expect(dataDirectory()).toBe(join(app, 'server', 'data'))
    } finally {
      process.chdir(cwd)
      process.argv[1] = argv
    }
  })

  it('is the working directory in a checkout, where the entry is the Nuxt CLI', () => {
    const argv = process.argv[1]

    try {
      process.argv[1] = join(dir, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')

      expect(appDirectory()).toBe(process.cwd())
      expect(dataDirectory()).toBe(join(process.cwd(), 'server', 'data'))
    } finally {
      process.argv[1] = argv
    }
  })

  it('does not trust a script that only looks like the entry', () => {
    // No `index.mjs` beside it: an editor's preview, a half-typed path, anything - and the working
    // directory is the safer answer.
    const app = join(dir, 'app')
    mkdirSync(join(app, 'server'), { recursive: true })

    const argv = process.argv[1]

    try {
      process.argv[1] = join(app, 'server', 'index.mjs')
      expect(appDirectory()).toBe(process.cwd())
    } finally {
      process.argv[1] = argv
    }
  })
})

describe('the directory the data goes in', () => {
  it('follows NUXT_DATA_DIR when a host keeps its data somewhere else on purpose', () => {
    setEnv('NUXT_DATA_DIR', join(dir, 'volume', 'hoa'))

    expect(dataDirectory()).toBe(join(dir, 'volume', 'hoa'))
  })

  it('is the app\'s own when nothing overrides it', () => {
    setEnv('NUXT_DATA_DIR', undefined)

    expect(dataDirectory()).toBe(join(appDirectory(), 'server', 'data'))
  })
})
