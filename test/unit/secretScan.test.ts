/**
 * The gate that stops a build carrying the site's runtime secrets from being uploaded.
 *
 * `nuxt.config.ts` gives the Battle.net credentials and the session key empty defaults so a build never bakes
 * them (`npm run check:secrets`, and the deploy before it uploads, is what proves it) - and this is the half
 * of that arrangement which decides whether the proof means anything: the search has to find a secret wherever
 * it is, and it must never print one when it does. A scanner that quietly missed a file, or that echoed what
 * it found into a build log, would be worse than no scanner at all.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findSecrets, readDotenv, secretValues } from '../../scripts/lib/secrets.mjs'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoa-secrets-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

/** A build artefact, small enough to reason about: a bundle, a nested file, and an image. */
function artefact(): void {
  fs.mkdirSync(path.join(dir, 'server', 'chunks', '_'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'server', 'chunks', '_', 'nitro.mjs'), 'const config = { blizzardClientId: "" };\n')
  fs.writeFileSync(path.join(dir, 'server', 'index.mjs'), 'export default {};\n')
  fs.writeFileSync(path.join(dir, 'public', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
}

describe('the secret search', () => {
  it('finds a value wherever it landed, and names the key rather than the value', () => {
    artefact()
    fs.writeFileSync(
      path.join(dir, 'server', 'chunks', '_', 'nitro.mjs'),
      'const config = { blizzardClientSecret: "8f14e45fceea167a5a36dedd4bea2543" };\n'
    )

    const findings = findSecrets(dir, new Map([['NUXT_BLIZZARD_CLIENT_SECRET', '8f14e45fceea167a5a36dedd4bea2543']]))

    expect(findings).toHaveLength(1)
    expect(findings[0]!.file).toBe('server/chunks/_/nitro.mjs')
    expect(findings[0]!.key).toBe('NUXT_BLIZZARD_CLIENT_SECRET')
    // And what a log would get: a name and a file, never the value (`json` is what a console would print).
    expect(JSON.stringify(findings)).not.toContain('8f14e45fceea167a5a36dedd4bea2543')
  })

  it('finds one inside a source map, a JSON file and an image alike', () => {
    artefact()
    const secret = 'a-long-enough-secret-value'
    fs.writeFileSync(path.join(dir, 'server', 'index.mjs.map'), `{"sources":["${secret}"]}`)
    fs.writeFileSync(path.join(dir, 'public', 'logo.png'), Buffer.from(secret))

    const findings = findSecrets(dir, new Map([['NUXT_SESSION_PASSWORD', secret]]))

    expect(findings.map((finding) => finding.file).sort()).toEqual(['public/logo.png', 'server/index.mjs.map'])
  })

  it('says nothing when the artefact is clean', () => {
    artefact()
    expect(findSecrets(dir, new Map([['NUXT_BLIZZARD_CLIENT_SECRET', 'a-value-that-is-not-there']]))).toHaveLength(0)
  })

  it('reports how much it read, so a clean answer is a statement about something', () => {
    artefact()
    const findings = findSecrets(dir, new Map([['NUXT_BLIZZARD_CLIENT_ID', 'another-value-that-is-not-there']]))
    expect(findings.searched).toBe(3)
  })
})

describe('the values a build could have taken', () => {
  it('prefers the environment, which is what Nuxt resolves last', () => {
    const dotenv = new Map([['NUXT_BLIZZARD_CLIENT_ID', 'from-the-file-at-least-eight']])
    const values = secretValues({ env: { NUXT_BLIZZARD_CLIENT_ID: 'from-the-environment-too' }, dotenv })

    expect(values.get('NUXT_BLIZZARD_CLIENT_ID')).toBe('from-the-environment-too')
  })

  it('leaves out a value too short to mean anything, and one that is not set at all', () => {
    const values = secretValues({ env: { NUXT_SESSION_PASSWORD: 'short' }, dotenv: new Map() })

    expect(values.has('NUXT_SESSION_PASSWORD')).toBe(false)
    expect(values.size).toBe(0)
  })

  it('reads a .env file the way Nuxt does, comments and quotes included', () => {
    const file = path.join(dir, '.env')
    fs.writeFileSync(file, '# a comment\nNUXT_BLIZZARD_CLIENT_SECRET="a-quoted-secret-value"\n\nFTP_SERVER=example.com\n')

    const dotenv = readDotenv(file)

    expect(dotenv.get('NUXT_BLIZZARD_CLIENT_SECRET')).toBe('a-quoted-secret-value')
    expect(dotenv.has('# a comment')).toBe(false)
    expect(dotenv.get('FTP_SERVER')).toBe('example.com')
  })
})
