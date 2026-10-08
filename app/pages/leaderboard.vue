<script setup lang="ts">
/**
 * The hall of fame: a public table of every character the site has ever rendered.
 *
 * The page is a shell around three components - the widgets, the filters and the table - and it
 * owns nothing but the address: it is `/leaderboard` in English and `/ru/leaderboard` in Russian,
 * exactly as the front page is one route with two addresses, so the language switcher works here
 * the way it works everywhere else.
 *
 * What it deliberately does not own is the data. Every filter, every preset and every page number
 * is one request to `/api/leaderboard`, which is cached for an hour and answers from memory (see
 * `server/api/leaderboard/index.ts`), and the first page of the table is rendered on the server
 * and arrives inside the document - so a reader sees the hall of fame immediately, and the site's
 * TTFB does not move whether the table holds ten players or ten thousand.
 */
definePageMeta({ alias: '/ru/leaderboard' })

// The characters this browser has looked up, which is where the row's three character views find the
// character they belong to (see the composable for the shape and the limit).
import { useSearchHistory } from '~/composables/searchHistory'

// The picture the page stands on: the hall of fame's own artwork (`app/assets/img`), which is part
// of the build, so it costs no network request at all.
import backdrop from '~/assets/img/hf-bg_01.webp'

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()

const {
  filters,
  search,
  page,
  rows,
  stats,
  pending,
  error,
  refresh,
  setSort,
  setFaction,
  setRealm,
  setClass,
  setPage
} = useLeaderboardView()

usePageSeo({
  title: () => t('lbSeoTitle'),
  description: () => t('lbSeoDescription')
})

/** A figure the way the language being read writes it, for the line under the table. */
function format(value: number): string {
  return value.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US')
}

/** The first and the last rank on the page being drawn, for "showing 26–50 of 1 240". */
const from = computed(() => (page.value && rows.value.length ? (page.value.page - 1) * page.value.perPage + 1 : 0))
const to = computed(() => (page.value ? (page.value.page - 1) * page.value.perPage + rows.value.length : 0))

/** The rank the first row of the page carries, which is what a medal is measured against. */
const offset = computed(() => (page.value ? (page.value.page - 1) * page.value.perPage : 0))

/**
 * The line under the page's name in the header: who is in the table, in the reader's language.
 *
 * It is the header's version of a character's class and realm - the facts the page is about, read
 * in one glance - and it comes off the same aggregate the widgets print, so it can never disagree
 * with them. An empty string until the first answer lands, which the header prints as no line.
 */
const meta = computed(() => {
  const current = stats.value
  if (!current || !current.players) return ''

  return t('lbMeta', {
    players: format(current.players),
    realms: format(current.realms),
    classes: format(current.classes)
  })
})

/**
 * The character this browser looked at last - the one the reader came from - which is what the three
 * views beside the table belong to.
 *
 * The hall of fame is not a character, so the profile, the shelves and the feed its row offers have
 * to belong to somebody: they belong to the character this reader opened last, which the browser
 * remembers for exactly this kind of purpose (see `useSearchHistory`). Before that is known - a first
 * visit, a crawler, a reader who arrived straight from a link - the three lead to the front door,
 * where a character is chosen, so a tab in the row is never a dead end.
 */
const { history, load: loadHistory } = useSearchHistory()

const current = computed(() => history.value[0] || null)

/** The address of that character's own pages, or an empty string when there is no such character. */
const characterPath = computed(() => {
  const entry = current.value
  return entry ? `/${regionPath(entry.region)}/${entry.realm}/${entry.name}` : ''
})

/** The two views of the row that are plain addresses, each falling back to the front door. */
const overviewUrl = computed(() => localeUrl(current.value ? characterPath.value : '/'))
const activityUrl = computed(() => localeUrl(current.value ? `${characterPath.value}/activity` : '/'))

/** The collections subtree of that character, which the menu's entries hang from. */
const collectionsPath = computed(() => `${characterPath.value}/collections`)

// The history lives in the browser and the server has none, so it is read once the page is mounted:
// the first render carries the front-door fallback and the tabs take their real addresses a moment
// later. Both sides render the same thing at the same moment, so hydration has nothing to disagree
// about - the tabs simply change once the reader's own character is known.
onMounted(loadHistory)
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black"
  >
    <!-- The same backdrop the character pages stand on, with one of the site's own pictures in it
         rather than a character's class artwork (`app/components/SiteBackdrop.vue`). -->
    <SiteBackdrop :image="backdrop" />

    <!-- The same header the character pages wear: the brand, the page's name where a character's
         name would be, one line about the page under it, and the same four tabs below - the language
         pair ending the row, exactly where it sits on every other page
         (`app/components/SiteHeader.vue`). -->
    <SiteHeader :title="t('lbTitle')" :meta="meta">
      <!-- The character's own views, pointing at the character this reader came from. The menu of
           shelves is the very component the character page's row carries, so the dropdown, its
           entries and their addresses are the ones a reader has already met. -->
      <NuxtLink :to="overviewUrl" class="hoa-tab hoa-liquid-glass">{{ t('tabOverview') }}</NuxtLink>

      <CollectionMenu v-if="current" :path="collectionsPath" :active="false" />
      <NuxtLink v-else :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass">{{ t('tabCollections') }}</NuxtLink>

      <NuxtLink :to="activityUrl" class="hoa-tab hoa-liquid-glass">{{ t('tabActivity') }}</NuxtLink>

      <!-- And the hall of fame itself, which is the page being read. -->
      <NuxtLink
        :to="localeUrl('/leaderboard')"
        class="hoa-tab hoa-liquid-glass hoa-tab-active"
        aria-current="page"
      >{{ t('lbNav') }}</NuxtLink>
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <p class="max-w-3xl text-sm text-gray-400">{{ t('lbLead') }}</p>

      <LeaderboardStats class="mt-4" :stats="stats" :pending="pending" />

      <LeaderboardFilters
        class="mt-3"
        :sort="filters.sort"
        :faction="filters.faction"
        :realm="filters.realm"
        :class-id="filters.classId"
        :search="search"
        :stats="stats"
        @update:sort="setSort"
        @update:faction="setFaction"
        @update:realm="setRealm"
        @update:class="setClass"
        @update:search="search = $event"
      />

      <p v-if="error" class="mt-3 flex items-center gap-3 text-sm text-red-400">
        <span>{{ t('lbError') }}</span>
        <button type="button" class="underline hover:text-red-300" @click="refresh()">
          {{ t('activityRetry') }}
        </button>
      </p>

      <LeaderboardTable
        class="mt-3"
        :players="rows"
        :sort="filters.sort"
        :offset="offset"
        :pending="pending"
        @update:sort="setSort"
      />

      <div v-if="page && page.total" class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-gray-500">
          {{ t('lbShowing', { from: format(from), to: format(to), total: format(page.total) }) }}
          <span v-if="page.updatedAt"> · {{ t('lbUpdated', { date: page.updatedAt }) }}</span>
        </p>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page.page <= 1"
            @click="setPage(page.page - 1)"
          >{{ t('lbPrev') }}</button>

          <span class="tabular-nums text-xs text-gray-400">{{ page.page }} / {{ page.pages }}</span>

          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="page.page >= page.pages"
            @click="setPage(page.page + 1)"
          >{{ t('lbNext') }}</button>
        </div>
      </div>
    </div>

    <!-- The line every page of the site signs off with: the wordmark over the brand line, drawn
         exactly as the character pages draw it. -->
    <footer class="relative z-20 container mx-auto flex flex-col items-center gap-1.5 px-4 pb-2 text-xs text-gray-500">
      <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-7 w-auto" />
      <SiteFooter />
    </footer>

    <SupportButton />
  </div>
</template>
