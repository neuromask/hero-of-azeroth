/**
 * The question a ranking's table asks, and the name its answer is filed under.
 *
 * A table's rows belong to the question that asked for them, and Nuxt files an answer under the `key` its fetch was
 * given. With one fixed key for every ranking, a page the router has rebuilt for another address is handed the
 * answer to the question *before* it - the rows of the ranking the reader has just left - because a key with data
 * behind it is a key `useAsyncData` does not fetch again; the table then corrects itself only when the whole
 * document is reloaded, which is why a reader meets this as "the address moved and the table did not". That
 * failure is invisible from the server - the request, the address and the answer are all correct, and only the name
 * they were filed under made a lie of them - so it is pinned here.
 *
 * The composable is driven through stubs of the Nuxt globals (`installNuxtStubs`, the way `test/helpers/memoryDb`
 * installs `useDb`), so what is checked is the *question* rather than the answer: the ordering, the places and the
 * scopes behind it have their own tests against a real database (`metricLeaderboard.test.ts`), and the address
 * rules have theirs (`metricLeaderboardNavigation.test.ts`). What is left - and what only a caller can get wrong -
 * is that a ranking asks its own address, that the address is read from the page *reactively* (the page hands over
 * its own props), and that no two questions share a name.
 */
import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, reactive, ref, toValue, watch } from 'vue'
import { METRIC_LEADERBOARDS } from '#shared/data/leaderboardSchema'
import type { MetricLeaderboard, MetricLeaderboardPage } from '#shared/data/leaderboardSchema'
import { useMetricLeaderboardView } from '../../app/composables/metricLeaderboard'

/** One metric of the site's own list, by slug. A slug the site does not rank is a broken test, not a case. */
function metricOf(slug: string): MetricLeaderboard {
  const found = METRIC_LEADERBOARDS.find((entry) => entry.slug === slug)
  if (!found) throw new Error(`the site ranks no such figure: ${slug}`)
  return found
}

/** What one stubbed `useFetch` was handed: where it was asked, the question, and the name it is filed under. */
interface Asked {
  url: string
  key: unknown
  query: unknown
  data: ReturnType<typeof ref<MetricLeaderboardPage | undefined>>
}

/**
 * The globals Nuxt would have handed the composable - the reactivity of Vue, the address, and the fetch.
 *
 * `useFetch` is a recorder rather than a request: it keeps the `key` and the `query` it was called with, which are
 * the two things a table's identity is made of, and hands back refs the test can write an answer into.
 */
function installNuxtStubs(route: { path: string; query: Record<string, unknown> }): {
  asked: Asked[]
  writes: Array<Record<string, unknown>>
} {
  const asked: Asked[] = []
  const writes: Array<Record<string, unknown>> = []

  Object.assign(globalThis, {
    ref,
    computed,
    reactive,
    watch,
    nextTick,
    toValue,
    useRoute: () => route,
    useRouter: () => ({
      replace: (to: Record<string, unknown>) => {
        writes.push(to)
      }
    }),
    useFetch: (url: string, options: { key?: unknown; query?: unknown } = {}) => {
      const data = ref<MetricLeaderboardPage | undefined>(undefined)
      asked.push({ url, key: options.key, query: options.query, data })
      return { data, pending: ref(false), error: ref(null), refresh: async () => {} }
    }
  })

  return { asked, writes }
}

/** The table of one ranking, as the page sets it up: the scope is the page's props, the route is its address. */
function ranking(scope: { metric: MetricLeaderboard; region?: string; realm?: string }) {
  const route = reactive({ path: '/ru/leaderboards/mounts', query: {} as Record<string, unknown> })
  const { asked, writes } = installNuxtStubs(route)

  return { view: useMetricLeaderboardView(scope), asked, writes, route, scope }
}

/** The address a fetch was asked to answer, which is what its answer belongs to. */
const queryOf = (asked: Asked[]): Record<string, unknown> => toValue(asked[0]?.query) as Record<string, unknown>


describe('the question a ranking asks', () => {
  it('names the answer after the whole question, through a key that follows it', () => {
    const { asked } = ranking({ metric: metricOf('mounts'), region: 'eu', realm: 'gordunni' })

    expect(asked[0]?.url).toBe('/api/leaderboard/metrics')
    // A *getter*, not a string: the key has to be able to change when the question does - an address followed, a
    // filter set, a page stepped to - or one answer stays filed under one name for all of them.
    expect(typeof asked[0]?.key).toBe('function')
    expect(queryOf(asked)).toMatchObject({ metric: 'mounts', region: 'eu', realm: 'gordunni', page: 1 })
    expect(keyOf(asked)).toContain('mounts')
    expect(keyOf(asked)).toContain('gordunni')
  })

  it('never files two questions under one name', () => {
    // The bug this exists for: the world's ranking, a region's and a realm's are three answers, and a page rebuilt
    // for the second must not be handed the first.
    const names = [
      ranking({ metric: metricOf('mounts') }),
      ranking({ metric: metricOf('mounts'), region: 'eu' }),
      ranking({ metric: metricOf('mounts'), region: 'eu', realm: 'gordunni' }),
      ranking({ metric: metricOf('mounts'), region: 'eu', realm: 'silvermoon' }),
      ranking({ metric: metricOf('pets'), region: 'eu', realm: 'gordunni' })
    ].map((table) => keyOf(table.asked))

    expect(new Set(names).size).toBe(names.length)
  })

  it('files the same question under the same name, which is what lets the server answer be reused', () => {
    const one = ranking({ metric: metricOf('mounts'), region: 'eu' })
    const two = ranking({ metric: metricOf('mounts'), region: 'eu' })

    // The server renders this page under this name and the browser asks for the same one, so the answer arrives
    // with the document and the first paint is the table rather than a spinner (`useAsyncData`'s payload).
    expect(keyOf(one.asked)).toBe(keyOf(two.asked))
  })

  it('follows an address that changes under the page', () => {
    const scope = reactive({
      metric: metricOf('mounts'),
      region: 'eu' as string | undefined,
      realm: undefined as string | undefined
    })
    const { asked } = ranking(scope)
    const mounts = keyOf(asked)

    // The page hands over its own props, so a page the router has kept alive follows the address it is drawn for.
    scope.metric = metricOf('pets')
    expect(queryOf(asked)).toMatchObject({ metric: 'pets', region: 'eu' })
    expect(keyOf(asked)).not.toBe(mounts)

    scope.realm = 'gordunni'
    expect(queryOf(asked)).toMatchObject({ metric: 'pets', region: 'eu', realm: 'gordunni' })

    scope.region = undefined
    scope.realm = undefined
    expect(queryOf(asked)).toMatchObject({ metric: 'pets', region: undefined, realm: undefined })
    expect(keyOf(asked)).not.toBe(mounts)
  })

  it('carries the page of the ranking, which is what a `?rank=` link opens', () => {
    const { asked, view } = ranking({ metric: metricOf('mounts'), region: 'eu' })
    const first = keyOf(asked)

    // A ranking of four pages, so that stepping to the third is a step the table can take.
    asked[0]!.data.value = { page: 1, pages: 4, perPage: 25, players: [], realms: [], total: 100 } as never

    view.setPage(3)

    expect(queryOf(asked)).toMatchObject({ page: 3 })
    expect(keyOf(asked)).not.toBe(first)
  })

  it('carries the narrowing choices, which do not travel in the address', async () => {
    vi.useFakeTimers()
    try {
      const { asked, view } = ranking({ metric: metricOf('mounts') })
      const everybody = keyOf(asked)

      view.setFaction('horde')
      expect(queryOf(asked)).toMatchObject({ faction: 'horde' })
      expect(keyOf(asked)).not.toBe(everybody)

      // The name waits for the reader to stop typing, and then is part of the question like the side is.
      view.search.value = 'нейро'
      await vi.advanceTimersByTimeAsync(400)
      expect(queryOf(asked)).toMatchObject({ faction: 'horde', q: 'нейро' })
      expect(keyOf(asked)).not.toBe(everybody)
    } finally {
      vi.useRealTimers()
    }
  })
})

/** The name the answer is filed under, which is what a later address must not be handed. */
const keyOf = (asked: Asked[]): string => toValue(asked[0]?.key as () => string)

