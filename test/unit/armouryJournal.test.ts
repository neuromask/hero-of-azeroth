/**
 * The Armoury mount journal: read behind the page, never in front of it.
 *
 * The Armoury answers with a *web page*, which costs seconds where every Blizzard call costs
 * milliseconds - so the profile must be answered without it. These tests pin the contract that makes
 * that safe: the profile reads what the site already holds (or the snapshot behind it), the network
 * read happens behind the request, a failure never destroys the last real number, and a burst of
 * requests for one character is one read of the Armoury rather than a handful.
 *
 * The module reads the network through the `$fetch` Nuxt hands it, so each test installs its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readMountJournal, refreshMountJournal } from '../../server/utils/armory'
import { mountTotal } from '../../server/utils/mounts'
import snapshot from '../../server/utils/armoury-totals.json'

/** A page shaped the way the Armoury ships one: the journal cut out of a `<script>` block. */
function armouryPage(total: number, collected: number): string {
  const list = Array.from({ length: total }, (_, index) => ({ id: index, collected: index < collected }))
  return `<html><script>{"mountsCollected":${collected},"mounts":[${list
    .map((entry) => JSON.stringify(entry))
    .join(',')}]}</script></html>`
}

/** The Blizzard index and a character's own collected list, as the profile has them. */
const INDEXED = 1676
const COLLECTED = 1265

let calls = 0
let respond: () => Promise<unknown>

beforeEach(() => {
  calls = 0
  respond = async () => armouryPage(1387, 1265)
  ;(globalThis as Record<string, unknown>).$fetch = (url: string) => {
    void url
    calls += 1
    return respond()
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the journal a profile is answered with', () => {
  it('is read without touching the network, so a character the site has never read has none to serve', () => {
    expect(readMountJournal('eu', 'gordunni', 'stranger')).toBeNull()
    expect(calls).toBe(0)
  })

  it('leaves the snapshot to stand in until a journal is on file - never a zero', () => {
    const journal = readMountJournal('eu', 'gordunni', 'stranger')
    const total = mountTotal(journal?.total, INDEXED, COLLECTED)

    expect(total).toBe(snapshot.mounts)
    expect(total).toBeGreaterThan(0)
    // and not the static index, which counts mounts no character's journal ever shows
    expect(total).not.toBe(INDEXED)
  })
})

describe('the read the profile starts', () => {
  it('returns at once, without waiting for the Armoury to answer', async () => {
    let landing: ((page: string) => void) | undefined
    respond = () => new Promise<string>((resolve) => { landing = resolve })

    const started = Date.now()
    // The profile does not await this - it starts the read and answers the page. What matters is that
    // starting it hands control straight back, whatever the Armoury is doing.
    const read = refreshMountJournal('eu', 'gordunni', 'slowarmoury')

    expect(Date.now() - started).toBeLessThan(1000)
    expect(calls).toBe(1)
    // the read is still in flight, so there is nothing new to serve yet - and nothing broken either
    expect(readMountJournal('eu', 'gordunni', 'slowarmoury')).toBeNull()
    expect(mountTotal(undefined, INDEXED, COLLECTED)).toBe(snapshot.mounts)

    landing?.(armouryPage(1387, 1265))
    await read
    expect(readMountJournal('eu', 'gordunni', 'slowarmoury')?.total).toBe(1387)
  })

  it('files the journal it read, for the requests that follow', async () => {
    respond = async () => armouryPage(1400, 1300)
    await refreshMountJournal('eu', 'gordunni', 'filesit')

    expect(readMountJournal('eu', 'gordunni', 'filesit')).toEqual({ total: 1400, collected: 1300 })
    expect(mountTotal(readMountJournal('eu', 'gordunni', 'filesit')?.total, INDEXED, COLLECTED)).toBe(1400)
  })

  it('does not read again while the journal it has is still fresh', async () => {
    respond = async () => armouryPage(1400, 1300)
    await refreshMountJournal('eu', 'gordunni', 'onceaday')
    expect(calls).toBe(1)

    await refreshMountJournal('eu', 'gordunni', 'onceaday')
    await refreshMountJournal('eu', 'gordunni', 'onceaday')

    expect(calls).toBe(1)
  })

  it('is one read for a burst of requests about one character', async () => {
    let landing: ((page: string) => void) | undefined
    respond = () => new Promise<string>((resolve) => { landing = resolve })

    const burst = Promise.all(
      Array.from({ length: 5 }, () => refreshMountJournal('eu', 'gordunni', 'burst'))
    )

    expect(calls).toBe(1)
    landing?.(armouryPage(1400, 1300))
    await burst

    expect(calls).toBe(1)
    expect(readMountJournal('eu', 'gordunni', 'burst')?.total).toBe(1400)
  })

  it('never rejects, so an Armoury that is down cannot fail the profile', async () => {
    respond = async () => {
      throw new Error('the Armoury answered 503')
    }

    await expect(refreshMountJournal('eu', 'gordunni', 'down')).resolves.toBeUndefined()
    expect(readMountJournal('eu', 'gordunni', 'down')).toBeNull()
    expect(mountTotal(undefined, INDEXED, COLLECTED)).toBe(snapshot.mounts)
  })

  it('does not let a failed read destroy the last journal it had', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))

    respond = async () => armouryPage(1500, 1400)
    await refreshMountJournal('eu', 'gordunni', 'keepsit')
    expect(readMountJournal('eu', 'gordunni', 'keepsit')?.total).toBe(1500)

    // a day on, the journal is due again - and this time the Armoury will not answer
    vi.setSystemTime(new Date('2026-10-02T01:00:00Z'))
    respond = async () => {
      throw new Error('the Armoury answered 503')
    }
    await refreshMountJournal('eu', 'gordunni', 'keepsit')

    expect(readMountJournal('eu', 'gordunni', 'keepsit')?.total).toBe(1500)
    expect(mountTotal(readMountJournal('eu', 'gordunni', 'keepsit')?.total, INDEXED, COLLECTED)).toBe(1500)
  })

  it('is asked for again sooner after a failure than after a success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))

    respond = async () => {
      throw new Error('down')
    }
    await refreshMountJournal('eu', 'gordunni', 'retries')
    expect(calls).toBe(1)

    // still inside the ten-minute window a failure is given
    vi.setSystemTime(new Date('2026-10-01T00:05:00Z'))
    await refreshMountJournal('eu', 'gordunni', 'retries')
    expect(calls).toBe(1)

    // past it, the site tries again rather than waiting out a day
    vi.setSystemTime(new Date('2026-10-01T00:15:00Z'))
    respond = async () => armouryPage(1387, 1265)
    await refreshMountJournal('eu', 'gordunni', 'retries')
    expect(calls).toBe(2)
    expect(readMountJournal('eu', 'gordunni', 'retries')?.total).toBe(1387)
  })
})

describe('the number the tile prints', () => {
  it('is never below what the character has collected', () => {
    expect(mountTotal(undefined, 1000, 1500)).toBe(1500)
    expect(mountTotal(1400, 1000, 1500)).toBe(1500)
  })

  it("prefers the character's own journal to the shared snapshot", () => {
    expect(mountTotal(1387, INDEXED, COLLECTED)).toBe(1387)
  })
})
