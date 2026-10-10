/**
 * A Battle.net token, encrypted before it touches the disk.
 *
 * A user access token is as good as the account it belongs to, so it never sits in the database as
 * plain text: an AES-256-GCM pass with a key derived from the site's session secret, which is the
 * one secret the process already carries. The scheme is written into the value itself
 * (`iv.tag.data`), so nothing else has to remember how it was sealed.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * The 32-byte key the tokens are sealed with, derived from the session secret.
 *
 * The secret is read from the runtime config so the same value that seals the cookie seals the
 * tokens - losing one loses the other, and rotating it simply makes the stored tokens unreadable,
 * which the callers already treat as "sign in again".
 */
function key(): Buffer {
  const config = useRuntimeConfig()
  const secret = String(config.sessionPassword || process.env.NUXT_SESSION_PASSWORD || '')
  return createHash('sha256').update(`hoa-token:${secret}`).digest()
}

/** A token as it is stored, or `null` for nothing to store. */
export function encryptToken(plain?: string | null): string | null {
  if (!plain) return null

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])

  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}

/** The token a stored value holds, or `null` when it cannot be read. */
export function decryptToken(stored?: string | null): string | null {
  if (!stored) return null

  try {
    const [iv, tag, data] = stored.split('.')
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv!, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag!, 'base64url'))

    return Buffer.concat([decipher.update(Buffer.from(data!, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    // A rotated secret or a tampered value: no token rather than a crash.
    return null
  }
}
