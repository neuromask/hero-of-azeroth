/**
 * The comparison that decides whether the host's `.env` is uploaded again.
 *
 * The deploy sends the configuration beside the artefact, and that file is edited a few times a year:
 * re-uploading a copy the host already has rotates `.env.previous` and prints a restart nothing needs. What
 * may be forgiven is only the shape of the file's edges - the line endings a Windows checkout has and the
 * host does not, the blank line an editor leaves at the end - because a running site cannot tell those apart
 * from the copy it holds. Everything else has to count as a change, or a real edit would be silently dropped
 * and the site would keep answering with credentials nobody meant to keep.
 */
import { describe, expect, it } from 'vitest'
import { sameEnv } from '../../scripts/lib/envFile.mjs'

const file = [
  '# the settings the host reads when it starts',
  'NUXT_BLIZZARD_CLIENT_ID=file-client',
  'NUXT_SESSION_PASSWORD=a-key-long-enough-to-seal-a-cookie',
  ''
].join('\n')

describe('the .env beside the checkout, compared with the host\'s copy', () => {
  it('is not a change when only the line endings differ', () => {
    expect(sameEnv(file.replace(/\n/g, '\r\n'), file)).toBe(true)
  })

  it('is not a change when an editor left a blank line at the end', () => {
    expect(sameEnv(`${file}\n\n`, file)).toBe(true)
  })

  it('is a change when a value was edited', () => {
    expect(sameEnv(file.replace('file-client', 'another-client'), file)).toBe(false)
  })

  it('is a change when a key was added', () => {
    expect(sameEnv(`${file}NUXT_TRUST_PROXY=1\n`, file)).toBe(false)
  })

  it('is a change when a line moved', () => {
    const lines = file.trim().split('\n')

    expect(sameEnv([lines[1], lines[0], lines[2]].join('\n'), file)).toBe(false)
  })

  it('is a change when the host has nothing there at all', () => {
    expect(sameEnv('', file)).toBe(false)
  })
})
