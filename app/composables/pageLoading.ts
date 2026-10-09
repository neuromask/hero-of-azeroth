/**
 * What the whole site is waiting for, in one place.
 *
 * Every view used to answer this for itself: it drew a wheel while its own read was in flight, and a
 * page with nothing to wait for drew nothing at all. That holds exactly as long as the waits are long
 * - and they stopped being long. The feeds, the profiles and the shelves are all kept on the server
 * (see `server/utils/swrCache.ts`), so a click that once sat in front of a wheel for two seconds now
 * arrives in a tenth of one, and a wheel bound to a *read* is a wheel nobody ever sees. What the
 * reader still wants is the other half of the question - "did my click do anything?" - and that half
 * is the same question on every page of the site, so it is answered once, here, by
 * `app/components/PagePreloader.vue`.
 *
 * A wait is registered by whoever actually knows about it, and it is a *reason* rather than a
 * boolean because waits overlap: the router is walking to another address while the address being
 * left is still reading its own data. Registration comes in the two shapes the site has:
 *
 * - `track`, for a read that is a promise (a view that fetches once after it has mounted, which no
 *   navigation is waiting on);
 * - `follow`, for a read that is a flag of its own (`pending` of a `useAsyncData`, which is also true
 *   when the same page reads again without going anywhere - another character under a reused shell,
 *   a shelf's switches flipped).
 *
 * Both are relinquished by the scope that registers them, so a view that disappears mid-read cannot
 * leave the wheel up behind it. The one wait that belongs to nobody is the navigation itself, and Nuxt
 * reports that one on its own terms (see `providePageLoading`).
 *
 * It is `provide`/`inject` rather than a module-level store, for the reason the character shell states
 * about its own context: a store at module scope outlives the page that made it and would be shared by
 * every request the server renders at once, while this belongs to one rendered site and lives exactly
 * as long as it does.
 *
 * One page registers nothing on purpose: the hall of fame answers in place - it keeps its own plates
 * on screen and marks the figures it does not have yet with dashes - so a filter turned or a page
 * clicked there is not a wait the site has to announce (see `LeaderboardStats.vue`).
 */
import type { ComputedRef, InjectionKey, Ref } from 'vue'

/** One wait of the site: the wheel is up for as long as at least one of these is. */
export interface PageLoading {
  /** True while anything at all is being waited for, which is when the preloader is up. */
  waiting: ComputedRef<boolean>
  /**
   * Waits on a promise, ending the wait when it settles - successfully or not, since a failure is an
   * answer too. The promise is handed back untouched, errors included, so the caller still decides
   * what a failure means.
   */
  track<T>(reason: string, promise: Promise<T>): Promise<T>
  /**
   * Waits for as long as `busy` is true, for a view whose waiting state is a flag of its own.
   *
   * The flag is watched rather than sampled, so a read that starts and finishes between two renders
   * is still a wait - and a view that unmounts with a read in flight ends its own wait rather than
   * leaving the wheel up for the page that follows it.
   */
  follow(reason: string, busy: Ref<boolean>): void
  /**
   * Says that the navigation is over, for a page whose own read has answered with nothing to show - a
   * character that is not there, an API that failed.
   *
   * The one wait the site does not own is the navigation's: Nuxt reports its beginning and its end itself
   * (see `providePageLoading`), and its end does not come for a page whose read answered with an error.
   * The address has changed and the page is on screen, so the wheel has no reason left to be up - and it
   * stayed up over that page's own line until the wait was abandoned, half a minute later. The page that
   * got the answer is the one that knows, so it is the page that says so.
   *
   * Ending a navigation that is not running is harmless, which is why this needs no guard: a page read on
   * the server, or a page opened straight onto the error state, calls it with nothing to end.
   */
  arrive(): void
}

/** The key the wait is provided and injected under. A symbol, so nothing can collide with it. */
const PAGE_LOADING: InjectionKey<PageLoading> = Symbol('hoa-page-loading')

/** How long a wait may last before the site stops believing in it, in milliseconds. */
const ABANDON_AFTER_MS = 30_000

/**
 * Provides the site's waiting state, raising Nuxt's page hooks with it.
 *
 * Called once, by the root component, because the root is the one component every page is rendered
 * under and the state has to outlive the pages that are read through it.
 */
export function providePageLoading(): void {
  /** The waits in flight, counted: two reads of one thing end one at a time. */
  const waits = reactive(new Map<string, number>())
  /** The one wait the site does not own: the navigation Nuxt is walking through. */
  const navigating = ref(false)

  function begin(reason: string) {
    waits.set(reason, (waits.get(reason) ?? 0) + 1)
  }

  function end(reason: string) {
    const remaining = (waits.get(reason) ?? 0) - 1
    if (remaining > 0) waits.set(reason, remaining)
    else waits.delete(reason)
  }

  // Nuxt raises these around every client-side navigation - as the router steps into another address,
  // and once the page behind it has resolved its own data - which is what makes a route change a wait
  // without a single page knowing about it. The navigation is a boolean rather than a counted wait
  // because it is not the site's to balance: the router reports it, and reporting it twice (a route
  // that redirects) must not leave the wheel up for a wait nobody is holding. The end of it, though, is
  // not always reported: a page whose own read answers with an error never gets an end, and a page that
  // knows that is the one that says so (`arrive`, which the character page calls on exactly that answer).
  const nuxtApp = useNuxtApp()
  nuxtApp.hook('page:loading:start', () => {
    navigating.value = true
  })
  nuxtApp.hook('page:loading:end', () => {
    navigating.value = false
  })

  const waiting = computed(() => navigating.value || waits.size > 0)

  // The way out of a wait that never ends (see `ABANDON_AFTER_MS`). It is armed by the first wait and
  // disarmed by the last, so an ordinary page - many quick waits in a row - never reaches it.
  let abandonTimer: ReturnType<typeof setTimeout> | undefined
  const stopAbandonTimer = () => {
    if (abandonTimer) clearTimeout(abandonTimer)
    abandonTimer = undefined
  }
  watch(waiting, (busy) => {
    stopAbandonTimer()
    if (!busy || !import.meta.client) return
    abandonTimer = setTimeout(() => {
      waits.clear()
      navigating.value = false
      abandonTimer = undefined
    }, ABANDON_AFTER_MS)
  })

  provide(PAGE_LOADING, {
    waiting,
    track(reason, promise) {
      begin(reason)
      return promise.finally(() => end(reason))
    },
    follow(reason, busy) {
      /** Whether this scope is the one holding the wait, so releasing it twice is harmless. */
      let held = false
      const release = () => {
        if (!held) return
        held = false
        end(reason)
      }
      watch(
        busy,
        (reading) => {
          if (reading && !held) {
            held = true
            begin(reason)
          } else if (!reading) release()
        },
        { immediate: true }
      )
      onScopeDispose(release)
    },
    arrive() {
      navigating.value = false
    }
  })
}

/**
 * The waiting state of the surrounding site. A component rendered outside one - which the router
 * makes impossible, the preloader lives in the root - throws rather than waiting for nothing.
 */
export function usePageLoading(): PageLoading {
  const loading = inject(PAGE_LOADING)
  if (!loading) {
    throw createError({ statusCode: 500, statusMessage: 'The page has no root around it' })
  }
  return loading
}
