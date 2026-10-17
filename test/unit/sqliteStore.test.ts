/**
 * An answer kept in the site's SQLite file instead of the heap, and the gate that lets one card draw at a time.
 *
 * A card is a few hundred kilobytes and a shelf as much again; held in a `Map` they were the largest thing the
 * process owned. The disk tier is a cache and never data, so these pin the rules that make it safe: it keeps only
 * the newest rows it is allowed, it can never take a page down (a failing database is a miss), and it forgets what
 * an earlier build filed. The gate is the other half of the same budget - three cards drawn together are three
 * native-memory peaks on top of each other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSwrCache } from '../../server/utils/swrCache'
import { bufferCodec, createSqliteStore, jsonCodec } from '../../server/utils/sqliteStore'
import { createTaskGate } from '../../server/utils/taskGate'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

const OPTIONS = { maxRows: 10, maxAgeMs: 3_600_000 }

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
})

describe('an answer kept in SQLite', () => {
  it('round-trips a buffer without asking the producer twice, and reports when it was fetched', async () => {
    installUseDb(createMemoryDb().db)
    const cache = createSwrCache<Buffer>(60_000, 10, { persist: createSqliteStore('t-buffer', bufferCodec, OPTIONS) })
    const producer = vi.fn(async () => Buffer.from([1, 2, 3, 4]))

    const first = await cache('card', producer)
    const second = await cache('card', producer)

    expect([...first]).toEqual([1, 2, 3, 4])
    expect([...second]).toEqual([1, 2, 3, 4])
    expect(producer).toHaveBeenCalledTimes(1)
    expect(cache.fetchedAt('card')).toBeGreaterThan(0)
  })

  it('keeps the answer in the table and not in the process', async () => {
    const db = createMemoryDb().db
    installUseDb(db)
    const cache = createSwrCache<{ n: number }>(60_000, 10, {
      persist: createSqliteStore('t-json', jsonCodec<{ n: number }>(), OPTIONS)
    })

    await cache('a', async () => ({ n: 7 }))
    const rows = db.prepare("SELECT COUNT(*) AS n FROM render_cache WHERE namespace LIKE 't-json@%'").get() as { n: number }

    expect(rows.n).toBe(1)
    expect(await cache('a', async () => ({ n: 99 }))).toEqual({ n: 7 })
  })

  it('invalidates one key and leaves the rest', async () => {
    installUseDb(createMemoryDb().db)
    const cache = createSwrCache<string>(60_000, 10, { persist: createSqliteStore('t-inv', jsonCodec<string>(), OPTIONS) })

    await cache('a', async () => 'a')
    await cache('b', async () => 'b')
    cache.invalidate('a')

    expect(cache.fetchedAt('a')).toBeNull()
    expect(cache.fetchedAt('b')).toBeGreaterThan(0)
  })

  it('keeps only the newest rows it is allowed', async () => {
    const db = createMemoryDb().db
    installUseDb(db)
    const cache = createSwrCache<string>(60_000, 10, {
      persist: createSqliteStore('t-cap', jsonCodec<string>(), { maxRows: 3, maxAgeMs: 3_600_000 })
    })

    for (const key of ['a', 'b', 'c', 'd', 'e']) await cache(key, async () => key)

    const rows = db.prepare("SELECT COUNT(*) AS n FROM render_cache WHERE namespace LIKE 't-cap@%'").get() as { n: number }
    expect(rows.n).toBe(3)
  })

  it('forgets the rows an earlier build filed under the same name', async () => {
    const db = createMemoryDb().db
    installUseDb(db)
    db.exec(`CREATE TABLE render_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL, key TEXT NOT NULL,
      fetched_at INTEGER NOT NULL, body BLOB NOT NULL, UNIQUE (namespace, key))`)
    db.prepare('INSERT INTO render_cache (namespace, key, fetched_at, body) VALUES (?, ?, ?, ?)').run(
      't-boot@older',
      'a',
      Date.now(),
      Buffer.from('"stale from the build before"')
    )
    const cache = createSwrCache<string>(60_000, 10, { persist: createSqliteStore('t-boot', jsonCodec<string>(), OPTIONS) })

    expect(await cache('a', async () => 'fresh')).toBe('fresh')
    const old = db.prepare("SELECT COUNT(*) AS n FROM render_cache WHERE namespace = 't-boot@older'").get() as { n: number }
    expect(old.n).toBe(0)
  })

  it('treats a database that cannot be read as a miss, not as a failure', async () => {
    ;(globalThis as Record<string, unknown>).useDb = () => {
      throw new Error('database is locked')
    }
    const cache = createSwrCache<string>(60_000, 10, { persist: createSqliteStore('t-fail', jsonCodec<string>(), OPTIONS) })

    expect(await cache('a', async () => 'fresh')).toBe('fresh')
    expect(cache.fetchedAt('a')).toBeNull()
  })
})

describe('the render gate', () => {
  it('runs no more tasks at once than it was given slots for', async () => {
    const gate = createTaskGate(2, 10)
    let running = 0
    let peak = 0

    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
    }

    await Promise.all(Array.from({ length: 8 }, () => gate.run(task)))

    expect(peak).toBe(2)
    expect(gate.active).toBe(0)
    expect(gate.waiting).toBe(0)
  })

  it('refuses work past its queue with a 503 rather than piling it up', async () => {
    const gate = createTaskGate(1, 1)
    let release: () => void = () => {}
    const held = gate.run(() => new Promise<void>((resolve) => (release = resolve)))
    const queued = gate.run(async () => 'queued')

    await expect(gate.run(async () => 'too many')).rejects.toMatchObject({ statusCode: 503 })

    release()
    await held
    expect(await queued).toBe('queued')
  })

  it('frees its slot when a task fails', async () => {
    const gate = createTaskGate(1, 4)

    await expect(gate.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(await gate.run(async () => 'next')).toBe('next')
    expect(gate.active).toBe(0)
  })
})

