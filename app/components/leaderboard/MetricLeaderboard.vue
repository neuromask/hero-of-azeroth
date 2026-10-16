<script setup lang="ts">
/**
 * One metric leaderboard, as a page: the figure, the scope, the table and the way through it.
 *
 * A metric leaderboard is a ranking of a single figure (`METRIC_LEADERBOARDS` in
 * `#shared/data/leaderboardSchema`) read at one of three scopes - the whole world, one region, or one realm
 * inside that region - and there is a page per scope, so that a page has an address of its own and a crawler can
 * tell them apart. All three are this component: the routes under `app/pages/leaderboards/` only read the address
 * and hand its parts here, because what differs between them is two props and nothing else.
 *
 * What the page shows, top to bottom: what the ranking is of and where it is drawn (the scope, as a line and as
 * three links, so a reader can step from the world to their own realm and back), the table itself, and the way
 * through it. The figure is named the way the whole site names it (`metric.labelKey`), so a reader who came from
 * the comparison board finds the same word for the same figure.
 *
 * Two states are answered rather than decorated, and they are the two a *ranking* can be in rather than the two
 * a page can: an empty one, and one whose address names a realm the game does not have. They are different
 * sentences because they are different facts - "nobody here has a figure yet" is about the site's data, while a
 * realm the realm list denies is about the world - and neither is an error.
 *
 * The item level is deliberately not among the figures this page can rank, and neither is the Mythic+ rating:
 * the first is what a character *wears* rather than what it has gathered (the site draws no history and no
 * distribution of it), and the second belongs to the front door's table, which counts it in the season Blizzard
 * is running (`server/utils/mplus`). Both are decisions the site already made, and this page follows them.
 */
import { formatNumber } from '#shared/utils/formatNumber'
import { searchHistoryKey } from '#shared/utils/savedCharacters'
import { metricLeaderboardPath, useMetricLeaderboardView } from '~/composables/metricLeaderboard'
import { useSearchHistory } from '~/composables/searchHistory'
import type { MetricLeaderboard, MetricLeaderboardScope } from '#shared/data/leaderboardSchema'
// The picture the page stands on: the site's own artwork, which is part of the build and costs no request.
import backdrop from '~/assets/img/hf-bg_01.webp'

const props = defineProps<{
  /** The ranking being drawn: its slug, its column, its figure and the words it is printed in. */
  metric: MetricLeaderboard
  /** The region the address named, or absent for the world ranking. */
  region?: string
  /** The realm the address named, which is only ever read beside a region. */
  realm?: string
}>()

const { t } = useI18n()
const route = useRoute()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name this page prints comes
// from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel, knowsRealm } = useRealmNames()

/**
 * The table's own state, in one place: the rows of the page being drawn, the places they hold, the ways of
 * narrowing and stepping through them, and the address all of that is read from and written to.
 *
 * The props are handed over whole rather than as three values, because they are *reactive* and this composable
 * reads them from inside its computeds: a ranking is addressed by what the page is given, so a page the router has
 * kept alive for another address - or one that has been handed another by anything else - must follow it, and a
 * copy taken here would freeze the table on the ranking it was built with. The fetch is filed under that address
 * as well as asked with it (`requestKey`), which is what keeps a rebuilt page from being handed the rows of the
 * ranking it replaced.
 */
const { rows, total, pages, page, realms, offset, rankOf, highlighted, stale, faction, search, setFaction, reveal, pending, error, refresh, setPage } =
  useMetricLeaderboardView(props)

/**
 * Who is on the site, which is what the dots on the portraits are drawn from.
 *
 * The list is fetched with the page - the first answer the server sends already carries it, so the dots are in the
 * HTML - and re-read every minute while the tab is visible (`app/composables/presence.ts`). It is the front door's
 * own read, and this table draws the same dot for the same reason: a reader scanning a ranking can see whose
 * account is on the site right now.
 */
const { online } = await usePresence()

/** The figure's own name, which the heading, the column and the rank links all print. */
const metricLabel = computed(() => t(props.metric.labelKey))

/** The region's name, which the site already has in both languages. */
const regionLabel = computed(() => (props.region === 'us' ? t('america') : t('europe')))

/**
 * Where this ranking is drawn, as one line: the world, a region, or a realm inside its region.
 *
 * The realm is only ever printed beside its region, because a realm slug on its own names no realm - the same
 * reason the address spells the two together (`MetricLeaderboardScope`).
 */
const scopeLabel = computed(() => {
  if (!props.region) return t('lbWorld')
  if (!props.realm) return regionLabel.value
  return `${regionLabel.value} · ${realmLabel(props.region, props.realm, props.realm)}`
})

/**
 * The same place, written for a title rather than for a line of prose: a realm and its region are joined by the very
 * separator the parts of a title are joined by (`TITLE_SEPARATOR`), so a scoped ranking reads as one chain of scoping
 * - "Hall of Fame - Score - Europe - Gordunni" - rather than as a title with two different dividers in it.
 *
 * The dotted form above is what the description and the line under the heading print, where a realm and its region are
 * one fact among others rather than two parts of a title.
 */
const titleScope = computed(() =>
  props.region && props.realm
    ? `${regionLabel.value}${TITLE_SEPARATOR}${realmLabel(props.region, props.realm, props.realm)}`
    : scopeLabel.value
)

/**
 * The world ranking of this figure, which is the way out of every scoped page.
 *
 * It is the address a scoped page's empty states offer, and the one thing a reader who has landed on a realm by
 * following a comparison link is most likely to want next - so it is built here rather than spelled out twice in
 * the template below.
 */
const worldPath = computed(() => localeUrl(metricLeaderboardPath(props.metric.slug)))

/**
 * The scope this page is drawn for, which the menu of tables carries from one figure to the next.
 *
 * A reader comparing the mounts of their realm with the titles of it should not have to pick the realm again, so
 * every press of that menu keeps the region and the realm the address names - and the figure they were read for
 * simply changes.
 */
const scope = computed<MetricLeaderboardScope>(() => ({ region: props.region, realm: props.realm }))

/**
 * Picks a region from the filter bar's chips, which under this table is a *scope* rather than a filter: the region
 * a ranking is drawn for is part of its address (`MetricLeaderboardScope`), so a press is a step from one ranking to
 * another and the realm the reader was standing on is left behind - it belongs to the region they are leaving.
 *
 * The front door's bar reads the same chips as a filter instead (`app/pages/index.vue`), because its table is one
 * table with a region in it rather than one table per region. That difference is the page's, not the bar's.
 */
function pickRegion(code: string) {
  const path = code
    ? metricLeaderboardPath(props.metric.slug, { region: code })
    : metricLeaderboardPath(props.metric.slug)

  if (stripLocalePrefix(route.path) !== path) void navigateTo(localeUrl(path))
}

/**
 * Picks a realm from the filter bar's menu, which is the same kind of step as a region: the realm a leaderboard is
 * drawn for is part of its address, because the same realm slug exists in more than one region and a filtered
 * table could not say which of them it counted.
 *
 * "Every realm" is therefore the world ranking - the menu's own words - and a realm is the realm's own page, under
 * the region the facet names. A press that would land on the page the reader is already looking at is left alone,
 * so the menu's current row is not a link to itself.
 */
function pickRealm(slug: string) {
  const picked = realms.value.find((entry) => entry.realm === slug)
  const path = picked
    ? metricLeaderboardPath(props.metric.slug, { region: picked.region, realm: picked.realm })
    : metricLeaderboardPath(props.metric.slug)

  if (stripLocalePrefix(route.path) !== path) void navigateTo(localeUrl(path))
}

/**
 * Whether the address names a realm the game does not have, which is the one of the two empty states that is
 * about the world rather than about the site's data. `null` - a realm list nobody has read - is not a denial, so
 * only a list that *has* answered and does not hold the slug is treated as one (`knowsRealm`).
 */
const unknownRealm = computed(
  () => !!props.region && !!props.realm && knowsRealm(props.region, props.realm) === false
)

/**
 * What the page is called: the site's table of one figure, and the scope it is drawn for.
 *
 * The hall of fame is the site's summary and every ranking is a reading of one of its figures, so a page names both
 * - "Hall of Fame - Score - Hero of Azeroth" - and the scope is the *page's* address rather than a filter inside
 * it: a realm's pets and the world's pets are two tables, not two views of one. It is the page's name *and* the
 * heading under the header, and the parts are joined by the one separator the site's titles are joined by
 * (`TITLE_SEPARATOR`, `titleScope` above) - the brand is the only part the composable adds, and only for the
 * document, the preview and the crawler.
 */
const title = computed(() =>
  props.region
    ? t('lbMetricTitleScoped', { hall: t('lbTitle'), metric: metricLabel.value, scope: titleScope.value })
    : t('lbMetricTitle', { hall: t('lbTitle'), metric: metricLabel.value })
)

/** The one sentence a search result and a link preview carry. */
const description = computed(() =>
  t('lbMetricDescription', { metric: metricLabel.value, scope: scopeLabel.value })
)

/** The line under the heading, which says in the page's own words what the title says in the crawler's. */
const meta = computed(() => {
  const parts = [scopeLabel.value]
  if (total.value) parts.push(t('lbMetricTotal', { total: formatNumber(total.value) }))
  if (page.value?.updatedAt) parts.push(t('lbUpdated', { date: page.value.updatedAt }))
  return parts.join(' · ')
})

/** The character this browser read last, which is what the row of the header offers its own entries for. */
const { history, load: loadHistory } = useSearchHistory()
const reading = computed(() => history.value[0] || null)
onMounted(loadHistory)

/**
 * The account this browser is signed in with, which is the other half of whose rows these are.
 *
 * `/api/profile` is the same request the header's account plate and the front door read, under the same key, so a
 * metric page that draws one pays for one - and it is awaited with the page, which is what lets the reader's own row
 * wear its badge in the first render rather than in a second one.
 */
const { data: account } = await useFetch<{
  user: { mainCharacterId: number | null } | null
  characters: { region: string; realmSlug: string; name: string; isMain: boolean }[]
}>('/api/profile', { key: 'profile-identity' })

/**
 * The main the reader's account leads with, keyed the way a row of the table is keyed, which is the row that wears
 * the filled badge.
 *
 * `isMain` is the flag the site reads everywhere else for "the character an account leads with", and the payload
 * arrives ordered by it; the search here is a belt for a payload a build ordered differently. A reader who is not
 * signed in has no such row, and a reader who is sees it wherever in the ranking their main happens to stand - which
 * on a ranking of two hundred thousand members is the whole reason the badge is there.
 */
const ownerKey = computed(() => {
  if (!account.value?.user) return ''

  const characters = account.value.characters || []
  const main = characters.find((entry) => entry.isMain) || characters[0]
  if (!main) return ''

  return searchHistoryKey({ region: main.region, realm: main.realmSlug, name: main.name })
})

/**
 * The character above, keyed the way a row of the table is keyed, so the table can mark their row.
 *
 * It is the same string the plate is built from (`searchHistoryKey`), which is what makes the two the same
 * character rather than two spellings of one name.
 */
const selectedKey = computed(() => (reading.value ? searchHistoryKey(reading.value) : ''))

/** This page in `path`'s language, as an absolute URL on the public host - which is what structured data needs. */
const { public: publicConfig } = useRuntimeConfig()
const absolute = (path: string) => new URL(localeUrl(path), publicConfig.siteUrl).href

/**
 * The page's own head: the heading as its title, the scope as its description, and a trail through the scopes as
 * its structured data.
 *
 * The canonical URL is the composable's own answer - this page's address without its language - so a `?rank=`
 * link is the page it points into rather than a second one to index: a place is a position in a ranking, and a
 * ranking has one address per scope. An address that names a realm the game does not have is asked not to be
 * indexed at all: it is a page the site can draw and a page nobody should arrive at from a search result.
 */
usePageSeo({
  title: () => title.value,
  description: () => description.value,
  noindex: () => unknownRealm.value,
  jsonLd: (canonical) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('lbTitle'), item: absolute('/') },
      {
        '@type': 'ListItem',
        position: 2,
        name: metricLabel.value,
        item: absolute(metricLeaderboardPath(props.metric.slug))
      },
      ...(props.region
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: regionLabel.value,
              item: absolute(metricLeaderboardPath(props.metric.slug, { region: props.region }))
            }
          ]
        : []),
      ...(props.region && props.realm
        ? [
            {
              '@type': 'ListItem',
              position: 4,
              name: realmLabel(props.region, props.realm, props.realm),
              item: canonical
            }
          ]
        : [])
    ]
  })
})
</script>

<template>
  <div class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black">
    <SiteBackdrop :image="backdrop" />

    <!-- The same header every page of the site wears: the brand, this ranking's name where a character page
         prints a character's, the scope under it, and the reader's own corner on the right. -->
    <SiteHeader :title="title" :meta="meta">
      <SiteNav :character="reading" :label="t('lbTitle')" active="leaderboard" />
    </SiteHeader>

    <main class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4 pb-6">
      <!-- The same bar a table of the site wears: the menu of the site's thirteen rankings above the filters, then
           which side, which region, which realm and a name. It leads the page, because choosing the table is what a
           reader does before reading one, and the plate about *them* stands under it - which is also where the
           filters a reader has set are read from, one row above the rows they narrow. The region and the realm are
           this page's *address* - a press on either is a step from one ranking to another - and the reset button is
           the step back to the world's ranking, where neither is named. The legend of the score stands beside the
           field wherever the score is what the table shows, and it is the bare question mark: the figure it explains
           is the one in the column below. -->
      <LeaderboardFilters
        :faction="faction"
        :region="region || ''"
        :realm="realm || ''"
        :search="search"
        :current="metric.slug"
        :scope="scope"
        :players="total"
        :realms-facet="realms"
        :legend="metric.slug === 'score'"
        @update:faction="setFaction"
        @update:region="pickRegion"
        @update:realm="pickRealm"
        @update:search="search = $event"
      />

      <!-- The character this browser has selected, with their value for this figure and their three places: the
           plate every ranking wears, wearing this table's question, and the press that walks the table to their row
           (`app/components/leaderboard/MetricLeaderboardYou.vue`). -->
      <MetricLeaderboardYou
        v-if="reading"
        class="mt-3"
        :metric="metric"
        :character="reading"
        :scope="scope"
        @reveal="reveal"
      />

      <!-- A place a link asked for that the ranking no longer holds: the site says so rather than pretending
           the link landed where it meant to. The rows below are the ranking around where it would have been. -->
      <p
        v-if="stale"
        class="mt-3 rounded-xl border border-amber-500/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200"
      >
        {{ t('lbMetricStale') }}
      </p>

      <p v-if="error" class="mt-3 flex items-center gap-3 text-sm text-red-400">
        <span>{{ t('lbError') }}</span>
        <button type="button" class="underline hover:text-red-300" @click="refresh()">{{ t('activityRetry') }}</button>
      </p>

      <!-- A realm the realm list denies: not an empty ranking, and not an error either - the address names a
           realm the game does not have, which is the one thing the site can say about it. -->
      <div v-else-if="unknownRealm" class="hoa-panel mt-3 rounded-2xl p-8 text-center">
        <p class="text-sm text-gray-300">{{ t('lbMetricUnknownRealm') }}</p>
        <NuxtLink :to="worldPath" class="hoa-tab hoa-liquid-glass mt-4 inline-flex">
          {{ t('lbWorld') }}
        </NuxtLink>
      </div>

      <!-- Nobody has a figure yet at this scope, which is a fact about the site's own readings rather than a
           failure: the way out is the rest of the ranking rather than a retry. -->
      <div v-else-if="!rows.length" class="hoa-panel mt-3 rounded-2xl p-8 text-center">
        <p class="text-sm text-gray-300">{{ t('lbMetricEmpty', { metric: metricLabel }) }}</p>
        <p class="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-gray-500">{{ t('lbMetricEmptyHint') }}</p>
        <NuxtLink v-if="region" :to="worldPath" class="hoa-tab hoa-liquid-glass mt-4 inline-flex">
          {{ t('lbWorld') }}
        </NuxtLink>
      </div>

      <MetricLeaderboardTable
        v-else
        class="mt-3"
        :players="rows"
        :metric="metric"
        :offset="offset"
        :highlight="highlighted"
        :selected="selectedKey"
        :owner="ownerKey"
        :online="online"
        :pending="pending"
      />

      <div v-if="rows.length" class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-gray-500">
          {{ t('lbShowing', { from: formatNumber(offset + 1), to: formatNumber(offset + rows.length), total: formatNumber(total) }) }}
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="(page?.page || 1) <= 1"
            @click="setPage((page?.page || 1) - 1)"
          >{{ t('lbPrev') }}</button>

          <span class="tabular-nums text-xs text-gray-400">{{ page?.page || 1 }} / {{ pages }}</span>

          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="(page?.page || 1) >= pages"
            @click="setPage((page?.page || 1) + 1)"
          >{{ t('lbNext') }}</button>
        </div>
      </div>
    </main>

    <footer class="relative container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>

    <BackToTop />
    <SupportButton />
  </div>
</template>
