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
// character they belong to (see the composable for the shape and the limit). The key it keeps them
// under is also what marks the reader's own row in the table below.
import { useSearchHistory, searchHistoryKey } from '~/composables/searchHistory'
import { formatNumber } from '#shared/utils/formatNumber'

// The picture the page stands on: the hall of fame's own artwork (`app/assets/img`), which is part
// of the build, so it costs no network request at all.
import backdrop from '~/assets/img/hf-bg_01.webp'

const { t } = useI18n()
const localeUrl = useLocaleUrl()

const {
  filters,
  search,
  columns,
  toggleColumn,
  page,
  rows,
  stats,
  pending,
  error,
  refresh,
  revealRank,
  setSort,
  setFaction,
  setRealm,
  setPage
} = useLeaderboardView()

usePageSeo({
  title: () => t('lbSeoTitle'),
  description: () => t('lbSeoDescription')
})

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
    players: formatNumber(current.players),
    realms: formatNumber(current.realms),
    classes: formatNumber(current.classes)
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

/**
 * The identity of the character this browser opened last, which is what one of the table's rows is
 * marked by.
 *
 * The mark is about the character being read rather than about who owns it: the page is a table of
 * characters, and the browser knows exactly one of them - the one it last opened - so that is the row
 * it can point at. The badge on that row says "selected", which is what it is, rather than claiming
 * the row is the reader's own.
 */
const meKey = computed(() => (current.value ? searchHistoryKey(current.value) : ''))

/**
 * The account's own main, which the table marks with a second badge.
 *
 * The two marks say different things and can stand on the same row: the first says which character is
 * being read (the one this browser opened last), and this one says which character is the reader's -
 * the main their account leads with. A reader looking at somebody else's character sees exactly one
 * badge, and on their own main both.
 *
 * The payload is the same `/api/profile` the header's account chip reads, under the same key, so the
 * two share one request rather than making two.
 */
const { data: account } = await useFetch<{
  user: { mainCharacterId: number | null } | null
  characters: { region: string; realmSlug: string; name: string; isMain: boolean }[]
}>('/api/profile', { key: 'profile-identity' })

const ownerKey = computed(() => {
  if (!account.value?.user) return ''

  const characters = account.value.characters || []
  const main = characters.find((entry) => entry.isMain) || characters[0]
  return main ? searchHistoryKey({ region: main.region, realm: main.realmSlug, name: main.name }) : ''
})

/**
 * How the reader's own row is reached from the plate above the filters.
 *
 * The plate knows the place the reader holds, and a place is the one thing about a row that the table
 * can be asked for. Turning it into a page is the page's own step (`revealRank`), and then the row has
 * to be *seen*: it is drawn one request later, so the scroll to it waits for the answer rather than
 * looking for a row that is not on the screen yet. The row marks itself (`data-you`) for that scroll,
 * which is what keeps a row's address inside the table where rows are drawn.
 */
const scrollToMe = ref(false)

/** Brings the marked row into the middle of the window. The sticky header is why it is the middle. */
function scrollToRow() {
  nextTick(() => document.querySelector('[data-you="true"]')?.scrollIntoView({ block: 'center' }))
}

/** Answers the plate's button: the reader's place, turned into the page that holds their row. */
function revealRow(rank: number) {
  // A row already drawn is a scroll rather than a request: the reader is looking at the table they
  // asked for, and reordering it would move the very row they just found.
  if (meKey.value && rows.value.some((player) => searchHistoryKey(player) === meKey.value)) {
    scrollToRow()
    return
  }

  revealRank(rank)
  scrollToMe.value = true
}

// The page the reader asked for arrives a moment after the request: `pending` falling is what says it
// is drawn, and the scroll happens once per button, not once per page of the table.
watch(pending, (busy) => {
  if (busy || !scrollToMe.value) return
  scrollToMe.value = false
  scrollToRow()
})

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
/** The achievements subtree of that character, which the menu's entries hang from. */
const achievementsPath = computed(() => `${characterPath.value}/achievements`)

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
      <!-- What the bar carries on the right: the plate of the character this browser opened last - its
           portrait, the place it holds in the table and the way to that row. It stands where an account
           chip would on a site that had accounts, and the account itself is in the row below, beside
           the languages. A browser that has opened nobody draws no plate at all, and the right side of
           this bar is then empty by design.

           Its own glass is switched off here (`before:hidden`), because the bar already carries a
           frosted layer of its own and a pane of glass inside a pane can only sample the pane - the
           plate would read as a washed copy of the bar. What is left is the frame, drawn in the gold
           that marks the character the page is about. -->
      <template #actions>
        <LeaderboardYou
          v-if="current"
          class="before:hidden !border-wow-gold/40 !bg-black/25 !shadow-none"
          :character="current"
          @reveal="revealRow"
        />
      </template>

      <!-- The character's own views, pointing at the character this reader came from. The menu of
           shelves is the very component the character page's row carries, so the dropdown, its
           entries and their addresses are the ones a reader has already met. -->
      <NuxtLink :to="overviewUrl" class="hoa-tab hoa-liquid-glass">{{ t('tabOverview') }}</NuxtLink>

      <CollectionMenu v-if="current" :path="collectionsPath" :active="false" />
      <NuxtLink v-else :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass">{{ t('tabCollections') }}</NuxtLink>

      <!-- The achievements are the same pair - the summary tab and the categories menu - right after
           the collections, so a reader who came from a character has the whole log a click away. -->
      <AchievementMenu v-if="current" :path="achievementsPath" :active="false" />
      <NuxtLink v-else :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass">{{ t('tabAchievements') }}</NuxtLink>

      <NuxtLink :to="activityUrl" class="hoa-tab hoa-liquid-glass">{{ t('tabActivity') }}</NuxtLink>

      <!-- And the hall of fame itself, which is the page being read. -->
      <NuxtLink
        :to="localeUrl('/leaderboard')"
        class="hoa-tab hoa-liquid-glass hoa-tab-active"
        aria-current="page"
      >{{ t('lbNav') }}</NuxtLink>

      <!-- And the way to add somebody who is not in the table yet: the front page's own two fields,
           dropped as a sheet under this row when the button is pressed. It closes this row rather than
           standing beside the character's plate, because the row is where a page's controls live - and
           while this browser knows nobody yet, it is the only control in the bar at all. -->
      <CharacterSearchDialog />
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <LeaderboardStats :stats="stats" :pending="pending" />

      <LeaderboardFilters
        class="mt-3"
        :faction="filters.faction"
        :realm="filters.realm"
        :search="search"
        :columns="columns"
        :stats="stats"
        @update:faction="setFaction"
        @update:realm="setRealm"
        @update:search="search = $event"
        @toggle-column="toggleColumn"
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
        :columns="columns"
        :offset="offset"
        :pending="pending"
        :highlight="meKey"
        :owner="ownerKey"
        @update:sort="setSort"
      />

      <div v-if="page && page.total" class="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p class="text-xs text-gray-500">
          {{ t('lbShowing', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(page.total) }) }}
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
    <footer class="relative z-20 container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>

    <!-- Back to the top once the table has run past the window, and the support plate, which holds
         the other bottom corner. -->
    <BackToTop />
    <SupportButton />
  </div>
</template>
