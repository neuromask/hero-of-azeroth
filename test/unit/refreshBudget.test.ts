/**
 * The budget a forced refresh is charged to.
 *
 * `?force=true` is the one public request that spends Blizzard's quota on purpose, and the per-character
 * cooldown bounds one character - a walk over names used to be a fresh cooldown every time, which is ninety
 * calls for ten requests. These tests pin the rules that replaced that: one press is one event however many
 * requests it sends, a caller has a budget, a burst is bounded, the process has ceilings of its own, and a
 * caller whose address cannot be believed shares the process's budget rather than getting one per request.
 *
 * The module reads the request's address and the runtime config through the same free names Nitro hands it,
 * so each test installs its own: `getRequestIP` answers from the fake event, `trustProxy` decides whether the
 * forwarded address is believed at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRefreshBudgets, requireRefreshBudget } from '../../server/utils/refreshBudget'

/** A request that is about to ask for a forced refresh of one character. */
interface FakeEvent {
  /** The address the socket was opened from - the proxy's, behind one. */
  address: string
  /** What `X-Forwarded-For` claims, which a caller writes itself unless a proxy overwrites it. */
  forwardedFor: string
  headers: Record<string, string>
}

function request(address: string, forwardedFor = address): FakeEvent {
  return { address, forwardedFor, headers: {} }
}

let trustProxy = ''

beforeEach(() => {
  trustProxy = ''
  clearRefreshBudgets()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-12T09:00:00Z'))

  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({ trustProxy })
  ;(globalThis as Record<string, unknown>).getRequestIP = (event: FakeEvent, options?: { xForwardedFor?: boolean }) =>
    options?.xForwardedFor ? event.forwardedFor : event.address
  ;(globalThis as Record<string, unknown>).setResponseHeader = (event: FakeEvent, name: string, value: string) => {
    event.headers[name] = value
  }
  ;(globalThis as Record<string, unknown>).createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)
})

afterEach(() => {
  vi.useRealTimers()
})

/** Charges one forced request, reporting what it answered with rather than throwing. */
function charge(event: FakeEvent, character: string): { status: number; retryAfter?: string } {
  try {
    requireRefreshBudget(event as never, 'eu', 'gordunni', character)
    return { status: 200, retryAfter: event.headers['retry-after'] }
  } catch (err) {
    const failure = err as { statusCode: number }
    return { status: failure.statusCode, retryAfter: event.headers['retry-after'] }
  }
}
describe('one press of the Refresh button', () => {
  it('is one event, however many requests it sends', () => {
    const caller = request('203.0.113.7')

    // The button sends the profile, the card, and the feed: three requests, one press.
    expect(charge(caller, 'neuromask').status).toBe(200)
    expect(charge(caller, 'neuromask').status).toBe(200)
    expect(charge(caller, 'neuromask').status).toBe(200)
  })

  it('does not spend a second event on the card and the feed sent beside it', () => {
    const caller = request('203.0.113.8')

    // Twelve presses - one per character, spaced past a burst and inside the caller window - are the budget,
    // and each of them arrives as the three requests the button sends.
    for (let index = 0; index < 12; index += 1) {
      vi.advanceTimersByTime(11_000)
      expect(charge(caller, `alt${index}`).status).toBe(200)
      expect(charge(caller, `alt${index}`).status).toBe(200)
      expect(charge(caller, `alt${index}`).status).toBe(200)
    }

    vi.advanceTimersByTime(11_000)
    const refused = charge(caller, 'alt12')

    // The thirteen presses' worth of requests spent twelve events: the press is refused, and told to wait.
    expect(refused.status).toBe(429)
    expect(Number(refused.retryAfter)).toBeGreaterThan(0)
  })
})

describe('a walk over characters', () => {
  it('is refused once the caller has spent the budget', () => {
    const caller = request('203.0.113.9')
    let allowed = 0

    // Twenty attempts inside one caller window: the first twelve are answered, the rest are refused.
    for (let index = 0; index < 20; index += 1) {
      vi.advanceTimersByTime(11_000)
      if (charge(caller, `walk${index}`).status === 200) allowed += 1
    }

    expect(allowed).toBe(12)
  })

  it('does not spend another caller out of its own budget', () => {
    const busy = request('203.0.113.10')
    const other = request('203.0.113.11')

    for (let index = 0; index < 12; index += 1) {
      vi.advanceTimersByTime(11_000)
      charge(busy, `alt${index}`)
    }

    vi.advanceTimersByTime(11_000)
    expect(charge(busy, 'alt12').status).toBe(429)
    expect(charge(other, 'alt1').status).toBe(200)
  })
})

describe('a burst of forced requests', () => {
  it('is answered until the burst allowance is spent, and refused after it', () => {
    const caller = request('203.0.113.12')

    for (let index = 0; index < 4; index += 1) {
      expect(charge(caller, `burst${index}`).status).toBe(200)
    }

    const refused = charge(caller, 'burst4')
    expect(refused.status).toBe(429)
    expect(Number(refused.retryAfter)).toBeLessThanOrEqual(10)
  })

  it('lets the same caller through again once the burst window has passed', () => {
    const caller = request('203.0.113.13')

    for (let index = 0; index < 4; index += 1) charge(caller, `burst${index}`)
    expect(charge(caller, 'burst4').status).toBe(429)

    vi.advanceTimersByTime(11_000)
    expect(charge(caller, 'burst4').status).toBe(200)
  })
})

describe('the address a budget is charged to', () => {
  it('is the socket address while the deployment has not said a proxy can be trusted', () => {
    const first = request('10.0.0.1', '203.0.113.20')
    const second = request('10.0.0.1', '203.0.113.21')

    for (let index = 0; index < 4; index += 1) charge(first, `shared${index}`)

    // Two callers claiming two addresses behind one proxy: with the header not believed they share a budget,
    // which is the conservative reading - a stranger cannot hand itself a fresh one by writing a header.
    expect(charge(second, 'shared4').status).toBe(429)
  })

  it('is the forwarded address once the deployment says the proxy overwrites it', () => {
    trustProxy = '1'
    const first = request('10.0.0.1', '203.0.113.30')
    const second = request('10.0.0.1', '203.0.113.31')

    for (let index = 0; index < 4; index += 1) charge(first, `apart${index}`)

    expect(charge(second, 'apart4').status).toBe(200)
  })

  it('holds the process ceiling even when every caller is a stranger with a budget of its own', () => {
    trustProxy = '1'
    let allowed = 0

    // One request each, from a hundred addresses, at the same moment: the per-caller budget never fires, so
    // what stops them is the process's own burst allowance.
    for (let index = 0; index < 100; index += 1) {
      if (charge(request(`203.0.113.${index}`, `198.51.100.${index}`), `many${index}`).status === 200) allowed += 1
    }

    expect(allowed).toBe(8)
  })
})
