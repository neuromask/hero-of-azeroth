/**
 * What a forced refresh is allowed to cost, and who pays for it.
 *
 * `?force=true` is the one public request that deliberately spends Blizzard's quota: it skips every cache the
 * site has, and one press on a character the site has not read inside its cooldown is eight calls to the game
 * data API. The per-character cooldown (`server/utils/blizzard`) bounds *one* character, which leaves the
 * interesting abuse open: a walk over names - `alt1`, `alt2`, ... - is a fresh cooldown every time. Measured
 * before this module existed: ten forced requests for ten characters were ninety calls, and twelve sent at
 * once were a hundred and eight in flight together.
 *
 * So the budget is charged to the **caller**, with a ceiling on the process as well:
 *
 *   - a *refresh event* is one character refreshed by one caller. The button sends three requests for it -
 *     the profile, the card, and the feed when the shell holds one - and they are one event, not three: the
 *     first charges it, the others are recognised as the same refresh (and are answered from the reading the
 *     first one just made). A reader pressing Refresh gets one event, and so does a reader with two tabs open;
 *   - a *charge* is a single forced request, event or not, which is what bounds parallel work: a burst is
 *     answered until the burst allowance is spent, so a caller cannot put a hundred reads in flight;
 *   - the process has the same two windows of its own, which hold whatever a caller turns out to be: one
 *     instance of the site cannot be made to spend more of the quota than these, however many callers there
 *     are and however little the address means.
 *
 * What it does *not* do: touch an ordinary request (nothing here is consulted unless `force` was asked for),
 * touch the per-character cooldown, or queue anything. A refusal is a `429` with a `Retry-After`, which is
 * what the state honestly is - the refresh is not happening now, and the plain URL is still answered with the
 * last reading, untouched.
 *
 * The limits are generous for a person and tight for a script: a collector refreshing twelve different
 * characters in five minutes is inside the caller budget, while a walk of a realm is refused after twelve.
 * They bound *this process*: a deployment running several instances would give each its own budget, which is
 * one more reason the site runs as a single one (`README.md`).
 */
import type { H3Event } from 'h3'
// A plain import rather than Nitro's auto-import: the environment in front of the frozen runtime config is a
// rule of `server/utils/runtimeEnv`, and importing it keeps this module working under the unit tests.
import { privateSetting } from './runtimeEnv'

/** One press, however many requests it sends, is one event for this long. */
const EVENT_WINDOW_MS = 20_000

/** How many events one caller may ask for inside the window, and the window itself. */
const CALLER_EVENTS = 12
const CALLER_WINDOW_MS = 5 * 60_000

/** How many forced requests one caller may start in a burst, and how long a burst is. */
const CALLER_BURST = 4
const BURST_WINDOW_MS = 10_000

/** The same two for the whole process, which no address can raise. */
const PROCESS_EVENTS = 120
const PROCESS_BURST = 8

/** How many callers are remembered before the ones outside every window are dropped. */
const CALLER_LIMIT = 5000

/** When each caller last refreshed a given character, so the three requests of one press are one event. */
const lastEvent = new Map<string, number>()

/** When each caller's events happened, and when each started a forced request. */
const callerEvents = new Map<string, number[]>()
const callerBursts = new Map<string, number[]>()

/** The process's own two windows. */
const processEvents: number[] = []
const processBursts: number[] = []

/** Keeps a list of moments to the window being asked about, and answers with what is left inside it. */
function recent(stamps: number[], now: number, windowMs: number): number[] {
  let oldest = stamps[0]

  while (oldest !== undefined && oldest <= now - windowMs) {
    stamps.shift()
    oldest = stamps[0]
  }

  return stamps
}

/** Drops the callers that have nothing left inside any window, so the maps cannot grow without end. */
function sweep(now: number): void {
  if (callerEvents.size <= CALLER_LIMIT) return

  for (const [key, stamps] of callerEvents) {
    if (!recent(stamps, now, CALLER_WINDOW_MS).length) {
      callerEvents.delete(key)
      callerBursts.delete(key)
    }
  }
}

/**
 * The caller a budget is charged to.
 *
 * The address is used **only when the deployment says it can be trusted**. Behind a reverse proxy the socket
 * address is the proxy's, and `X-Forwarded-For` is written by whoever sends the request - a header a caller
 * chooses, so believing it unconditionally would hand a script a fresh budget with every request, which is
 * worse than having no per-caller limit at all. `NUXT_TRUST_PROXY` is what says a proxy the site controls
 * sits in front and *overwrites* that header (the host's own web server, in the deployment this repository
 * documents); until an operator sets it, every caller behind the proxy shares one budget.
 *
 * That conservative reading is safe because the process windows do not depend on the answer: whatever the
 * address resolves to, one instance cannot be made to spend more than its share of the quota. Setting the
 * variable sharpens *who* is limited, not *how much* the process can be made to spend.
 */
function callerKey(event: H3Event): string {
  const config = useRuntimeConfig() as { trustProxy?: string }
  // The environment first: the `.env` beside the server is read into it as the process starts, after Nitro
  // froze the copy this function is handed (`server/utils/runtimeEnv`).
  const trusted = privateSetting('NUXT_TRUST_PROXY', config.trustProxy).trim() !== ''
  const address = trusted ? getRequestIP(event, { xForwardedFor: true }) : getRequestIP(event)

  return address || 'unknown'
}

/** Seconds until there is room again, for `Retry-After`. */
function waitFor(stamps: number[], now: number, windowMs: number): number {
  const oldest = stamps[0]
  return oldest === undefined ? 1 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
}

/**
 * Charges a forced refresh to whoever asked for it, or refuses it with a `429`.
 *
 * Called by every endpoint that acts on `force=true`, before any of the work that makes the request
 * expensive. It throws rather than returning a verdict, so an endpoint cannot charge the budget and then
 * forget to look at the answer.
 */
export function requireRefreshBudget(event: H3Event, region: string, realm: string, name: string): void {
  const now = Date.now()
  const caller = callerKey(event)
  const character = `${caller}|${region}:${realm}:${name}`

  const burst = recent(callerBursts.get(caller) || [], now, BURST_WINDOW_MS)
  callerBursts.set(caller, burst)

  // The same press arriving as its second or third request: it is charged for the burst - it is still a
  // request being served - but not for another event, because the reader asked once.
  const sameRefresh = (lastEvent.get(character) ?? 0) > now - EVENT_WINDOW_MS

  let refusal: { retryAfter: number; why: string } | null = null

  if (!sameRefresh) {
    const events = recent(callerEvents.get(caller) || [], now, CALLER_WINDOW_MS)
    const processWindow = recent(processEvents, now, CALLER_WINDOW_MS)

    if (events.length >= CALLER_EVENTS) {
      refusal = { retryAfter: waitFor(events, now, CALLER_WINDOW_MS), why: 'this caller has refreshed enough for now' }
    } else if (processWindow.length >= PROCESS_EVENTS) {
      refusal = {
        retryAfter: waitFor(processWindow, now, CALLER_WINDOW_MS),
        why: 'the site has refreshed as much as it can just now'
      }
    }
  }

  const processBurst = recent(processBursts, now, BURST_WINDOW_MS)
  if (!refusal && burst.length >= CALLER_BURST) {
    refusal = { retryAfter: waitFor(burst, now, BURST_WINDOW_MS), why: 'too many refreshes from here at once' }
  } else if (!refusal && processBurst.length >= PROCESS_BURST) {
    refusal = {
      retryAfter: waitFor(processBurst, now, BURST_WINDOW_MS),
      why: 'the site is refreshing as much as it can at once'
    }
  }

  if (refusal) {
    // `Retry-After` is a number of seconds, which is how h3 types it as well.
    setResponseHeader(event, 'retry-after', refusal.retryAfter)
    throw createError({
      statusCode: 429,
      statusMessage: `Too many refreshes: ${refusal.why}`,
      data: { retryAfter: refusal.retryAfter }
    })
  }

  // Charged: this request is being served, and the character is marked as refreshed just now.
  burst.push(now)
  processBursts.push(now)
  lastEvent.set(character, now)

  if (!sameRefresh) {
    const events = callerEvents.get(caller) || []
    recent(events, now, CALLER_WINDOW_MS).push(now)
    callerEvents.set(caller, events)
    processEvents.push(now)
    sweep(now)
  }
}

/**
 * Forgets every budget.
 *
 * The windows live in the process, and a test that has to press Refresh more often than a caller may is the
 * only caller of this. Exported rather than kept private so a test never has to reach into the state.
 */
export function clearRefreshBudgets(): void {
  lastEvent.clear()
  callerEvents.clear()
  callerBursts.clear()
  processEvents.length = 0
  processBursts.length = 0
}

