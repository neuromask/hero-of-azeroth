<script setup lang="ts">
/**
 * The front door, which is the hall of fame: the site's own public page, with its search above the table.
 *
 * For a while the site had two doors - a form to walk through and a ranking to arrive at - and a reader had to
 * choose between them before knowing which one they wanted. The form was the only page that could speak to
 * somebody who had never heard of the site and had no character in the table; the ranking was the only page that
 * showed what the site is worth looking at. They are one page now: a reader lands on the table, and the search
 * stands in the header above it - the two fields and the button, in one row, where the plate of the character
 * this browser opened last stands once there is one (`app/components/CharacterSearchForm.vue`) - rather than as
 * a page of its own.
 *
 * A first visit is the only one that needs the fields there. A reader who has looked somebody up has the search in
 * the row under the header (the `Search` tab, and `Ctrl`/`⌘`+`K` from anywhere), and a reader who is signed in is
 * shown their own main instead (`accountMain` below); so the bar carries the fields exactly while this browser
 * knows no character *and* nobody is signed in, and the plate the moment either is true. What the row keeps for
 * everybody is the rest: the search sheet, the languages and the account.
 *
 * That is what the address says as well. This page is `/` in English and `/ru` in Russian, exactly as it was,
 * so every link and every ranking of the site's own front door is unchanged; the hall of fame's old address,
 * `/leaderboard`, is a 301 to this one (`nuxt.config.ts`, `routeRules`), and that is the site's only redirect
 * - it buries an address rather than choosing a language, which no other address of the site does.
 *
 * The row under the header carries the character's own links - the profile, the collections, the achievements,
 * the reputations, the feed - pointing at the character this browser opened last. They are drawn only once
 * there is such a character: a tab that leads to the page the reader is already on is worse than no tab at
 * all, and before the browser has been taught a character there is nothing to point at but the search. The
 * table is where a character is learned - pressing a row opens their page, and that is the act that remembers
 * them - so the row is full on the next page a reader opens rather than invented here.
 *
 * What the page does not own is the data. Every filter, every preset and every page number is one request to
 * `/api/leaderboard`, which is cached for an hour and answers from memory (see
 * `server/api/leaderboard/index.ts`), and the first page of the table is rendered on the server and arrives
 * inside the document - so a reader sees the hall of fame immediately, and the site's TTFB does not move
 * whether the table holds ten characters or ten thousand.
 */
definePageMeta({ alias: '/ru' })

// The characters this browser has looked up, which is where the row's character views and the plate in the bar
// find the character they belong to (see the composable for the shape and the limit). The key it keeps them
// under is also what marks the reader's own row in the table below.
import { useSearchHistory, searchHistoryKey, type SearchHistoryEntry } from '~/composables/searchHistory'
// The way into the search from outside it: the empty table asks for it on the name that matched nothing
// (see the composable for why the ask is shared state rather than a prop).
import { useCharacterLookup } from '~/composables/characterLookup'
import { formatNumber } from '#shared/utils/formatNumber'

// The picture the page stands on: the hall of fame's own artwork (`app/assets/img`), which is part of the
// build, so it costs no network request at all.
import backdrop from '~/assets/img/hf-bg_01.webp'

// The preview image of the front door: a still of the site, as it has always been - 1200x630, the size every
// network lays a large preview out for, and a JPEG while the default is the PNG of the shared card, so the
// tags describe this file rather than another one. Vite resolves it to a URL carrying a content hash, which
// `usePageSeo` then makes absolute on the public host.
import hoaPrev from '~/assets/img/hoa-prev.jpg'

const { t } = useI18n()
const localeUrl = useLocaleUrl()
const publicConfig = useRuntimeConfig().public

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

/**
 * Who is on the site, which is what the dots on the portraits are drawn from.
 *
 * The list is fetched with the page - the first answer the server sends already carries it, so the dots are
 * in the HTML - and re-read every minute while the tab is visible (`app/composables/presence.ts`). Only the
 * table draws anything with it, which is why the read lives here rather than in the plugin: the beat is
 * everybody's, and the list is this page's.
 */
const { online, count: onlineCount } = await usePresence()

/**
 * The front door's own head: the site-wide title and description, the still of the site as its preview image, and
 * the `WebSite` node behind the brand in a search result.
 *
 * The two sentences and the picture are the ones this address carried when the page was nothing but a form
 * (`i18n/locales/en.json` and `ru.json`, `homeTitle` and `homeDescription`): the page changed what it *shows* -
 * the ranking stands on it now, under the search - and what it is *called* in a search result and in a link
 * preview is the promise it has always made, which is the card and the figures. A character is described by their
 * own page, which is where that content is; the front door says what the site is for.
 *
 * The `WebSite` node is the one piece of structured data a page with no subject of its own can offer: it names the
 * site and the languages it serves.
 */
usePageSeo({
  title: () => t('homeTitle'),
  description: () => t('homeDescription'),
  image: hoaPrev,
  imageType: 'image/jpeg',
  jsonLd: () => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'HeroOfAzeroth',
    url: publicConfig.siteUrl,
    description: t('homeDescription'),
    inLanguage: [...SUPPORTED_LOCALES]
  })
})

/**
 * The way out of an empty table: the name the reader tried is offered to the search.
 *
 * The table can tell a reader that nobody in it matches, and the one thing it cannot do about that is look a
 * character up - which is the act that reads a profile and writes a row. The ask travels through shared state
 * (`app/composables/characterLookup.ts`) and the sheet that answers it is the one standing in this page's own
 * row, which is what keeps the table and the search from having to know about each other.
 */
const { open: lookUp } = useCharacterLookup()

/** The first and the last rank on the page being drawn, for "showing 26–50 of 1 240". */
const from = computed(() => (page.value && rows.value.length ? (page.value.page - 1) * page.value.perPage + 1 : 0))
const to = computed(() => (page.value ? (page.value.page - 1) * page.value.perPage + rows.value.length : 0))

/** The rank the first row of the page carries, which is what a medal is measured against. */
const offset = computed(() => (page.value ? (page.value.page - 1) * page.value.perPage : 0))

/**
 * The line under the page's name in the header: who is in the table, in the reader's language.
 *
 * It is the header's version of a character's class and realm - the facts the page is about, read in one
 * glance - and it comes off the same aggregate the widgets print, so it can never disagree with them. An
 * empty string until the first answer lands, which the header prints as no line.
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
 * The account this browser is signed in with, which is half of who this page is about.
 *
 * `/api/profile` is the same request the header's account plate reads, under the same key, so a page that draws
 * one pays for one - and it is awaited with the page, which is what lets the main below arrive with the first
 * render rather than in a second round trip.
 */
const { data: account } = await useFetch<{
  user: { mainCharacterId: number | null } | null
  characters: { region: string; realmSlug: string; name: string; isMain: boolean }[]
}>('/api/profile', { key: 'profile-identity' })

/**
 * The main of the account the reader is signed in as, or `null` for a reader who is not signed in.
 *
 * `isMain` is the flag the site reads everywhere else for "the character an account leads with" - it is the row
 * the table marks and the dot the presence beat draws - and the payload arrives ordered by it; the search here is
 * a belt for a payload that a build ordered differently.
 */
const accountMain = computed(() => {
  if (!account.value?.user) return null

  const characters = account.value.characters || []
  return characters.find((entry) => entry.isMain) || characters[0] || null
})

/**
 * The character this page is about for this reader: the one the plate in the bar and the row of links belong to.
 *
 * The hall of fame is not a character, so the profile, the shelves and the feed it offers have to belong to
 * somebody - to the character this browser opened last (`useSearchHistory`), or, for a reader who has never looked
 * anybody up *on this device*, to the main of the account they are signed in as. The two are one answer to one
 * question, which is why they are read as one value: a reader who looked somebody up here is never overruled by a
 * login, and a reader who signed in somewhere else - or on a fresh phone - finds their own character in the bar
 * instead of a search box. Nothing is written into the browser's history for it, because the main is derived from
 * the account rather than remembered as a lookup: signing out leaves the browser exactly as knowledgeable as it
 * was.
 *
 * Before either is known - a first visit with no session, a crawler, a reader who followed a link - there is no
 * such character at all: the row below the header draws no character links and the bar offers the search instead
 * (see the note at the top of this file).
 */
const { history, load: loadHistory } = useSearchHistory()

const current = computed<SearchHistoryEntry | null>(() => {
  const remembered = history.value[0]
  if (remembered) return remembered

  const main = accountMain.value
  if (!main) return null

  // The shape the plate and the row marks are written against, as the history writes it. The realm's *name* is
  // left as the slug on purpose: the plate prints a realm through the site's own list (`realmLabel`), and the
  // account stores only the slug, so there is nothing here for a language to spell differently.
  return {
    name: main.name,
    realm: main.realmSlug,
    region: main.region === 'us' ? 'us' : 'eu',
    realmName: main.realmSlug
  }
})

/**
 * The identity of the character being read, which is what one of the table's rows is marked by.
 *
 * The mark is about the character the page is about rather than about who owns it: the page is a table of
 * characters, and this reader's own character is exactly one of them - so that is the row it can point at. The
 * badge on that row says "selected", which is what it is, rather than claiming the row is the reader's own. For a
 * signed-in reader who has looked nobody up it is their main, and that row then carries both badges (see below).
 */
const meKey = computed(() => (current.value ? searchHistoryKey(current.value) : ''))

/**
 * The reader's own row, written the way a row is keyed, which the table marks with its second badge.
 *
 * The two marks say different things and can stand on the same row: the first says which character is being read,
 * and this one says which character is the reader's - the main their account leads with. A reader looking at
 * somebody else's character sees exactly one badge, and on their own main both.
 */
const ownerKey = computed(() => {
  const main = accountMain.value
  if (!main) return ''

  return searchHistoryKey({ region: main.region, realm: main.realmSlug, name: main.name })
})

/**
 * How the reader's own row is reached from the plate in the bar.
 *
 * The plate knows the place the reader holds, and a place is the one thing about a row that the table can be
 * asked for. Turning it into a page is the page's own step (`revealRank`), and then the row has to be *seen*:
 * it is drawn one request later, so the scroll to it waits for the answer rather than looking for a row that
 * is not on the screen yet. The row marks itself (`data-you`) for that scroll, which is what keeps a row's
 * address inside the table where rows are drawn.
 */
const scrollToMe = ref(false)

/** Brings the marked row into the middle of the window. The sticky header is why it is the middle. */
function scrollToRow() {
  nextTick(() => document.querySelector('[data-you="true"]')?.scrollIntoView({ block: 'center' }))
}

/** Answers the plate's button: the reader's place, turned into the page that holds their row. */
function revealRow(rank: number) {
  // A row already drawn is a scroll rather than a request: the reader is looking at the table they asked for,
  // and reordering it would move the very row they just found.
  if (meKey.value && rows.value.some((player) => searchHistoryKey(player) === meKey.value)) {
    scrollToRow()
    return
  }

  revealRank(rank)
  scrollToMe.value = true
}

// The page the reader asked for arrives a moment after the request: `pending` falling is what says it is
// drawn, and the scroll happens once per button, not once per page of the table.
watch(pending, (busy) => {
  if (busy || !scrollToMe.value) return
  scrollToMe.value = false
  scrollToRow()
})

/**
 * The character's own views, as the row under the header draws them: the addresses the tabs and the two menus
 * point at.
 *
 * They are built as one object rather than as five computeds, because the row is one thing - it is drawn whole
 * or not at all - and `null` is the honest answer while this browser knows nobody: there is no address to
 * offer, and a link that guessed at one would point at the page the reader is already reading. The two menus
 * are handed the subtrees they hang their entries from; the tabs are handed the three whole addresses, in the
 * language being read.
 */
const links = computed(() => {
  const entry = current.value
  if (!entry) return null

  const base = `/${regionPath(entry.region)}/${entry.realm}/${entry.name}`

  return {
    overview: localeUrl(base),
    activity: localeUrl(`${base}/activity`),
    reputations: localeUrl(`${base}/reputations`),
    collections: `${base}/collections`,
    achievements: `${base}/achievements`
  }
})

// The history lives in the browser and the server has none, so it is read once the page is mounted: the first
// render carries no character at all - no plate in the bar, no character links in the row - and both sides
// render the same page at the same moment, so hydration has nothing to disagree about. It is the row that
// fills in, never the table.
onMounted(loadHistory)
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black"
  >
    <!-- The same backdrop the character pages stand on, with one of the site's own pictures in it rather than a
         character's class artwork (`app/components/SiteBackdrop.vue`). -->
    <SiteBackdrop :image="backdrop" />

    <!-- The same header the character pages wear: the brand, the page's name where a character's name would be,
         one line about the page under it, and the row of links below - the language pair and the account ending
         it, exactly where they sit on every other page (`app/components/SiteHeader.vue`). -->
    <SiteHeader :title="t('lbTitle')" :meta="meta">
      <!-- What the bar carries on the right, and it is one of two things depending on who is reading.

           A reader this browser has a character for is shown that character: the plate of the one it opened last -
           its portrait, the place it holds in the table and the way to that row. It stands where an account chip
           would on a site that had accounts, and the account itself is in the row below, beside the languages. Its
           own glass is switched off here (`before:hidden`), because the bar already carries a frosted layer of its
           own and a pane of glass inside a pane can only sample the pane - the plate would read as a washed copy
           of the bar. What is left is the frame, drawn in the gold that marks the character the page is about.

           And a reader this browser knows nothing about - a first visit, a crawler, somebody who followed a link -
           is shown the way to look somebody up instead: the site's own two fields and the button, in one row, in
           the bar rather than in a block over the table (`app/components/CharacterSearchForm.vue`, `compact`).
           That is the whole of a first visit: the search stands where a reader looks first, the ranking is what
           they see while they decide what to search for, and neither has to be scrolled past to reach the other. A
           reader who is signed in is left out of it, because their account's main already stands in the plate
           above - which is the other answer to "who am I looking at", and a better one than a pair of empty
           fields. -->
      <template #actions>
        <LeaderboardYou
          v-if="current"
          class="before:hidden !border-wow-gold/40 !bg-black/25 !shadow-none"
          :character="current"
          @reveal="revealRow"
        />

        <CharacterSearchForm v-else-if="!account?.user" compact />
      </template>

      <!-- The character's own views, pointing at the character this reader came from. They are drawn only once
           this browser knows one, which is the one thing this page does differently from every other: the hall of
           fame used to lead these to the front door while no character was known, and the front door is now this
           page - a tab pointing at the page it stands on is not a link. The two menus are the very components a
           character page's row carries, so their dropdowns, their entries and their addresses are the ones a
           reader has already met. -->
      <template v-if="links">
        <NuxtLink :to="links.overview" class="hoa-tab hoa-liquid-glass">{{ t('tabOverview') }}</NuxtLink>

        <CollectionMenu :path="links.collections" :active="false" />
        <AchievementMenu :path="links.achievements" :active="false" />

        <NuxtLink :to="links.reputations" class="hoa-tab hoa-liquid-glass">{{ t('tabReputations') }}</NuxtLink>
        <NuxtLink :to="links.activity" class="hoa-tab hoa-liquid-glass">{{ t('tabActivity') }}</NuxtLink>
      </template>

      <!-- And the hall of fame itself, which is the page being read: on a character's page this tab is the way
           here, and here it marks where the reader stands. -->
      <NuxtLink
        :to="localeUrl('/')"
        class="hoa-tab hoa-liquid-glass hoa-tab-active"
        aria-current="page"
      >{{ t('lbNav') }}</NuxtLink>

      <!-- And the way to somebody the table does not hold: the front door's own two fields, dropped as a sheet
           under this row when the button is pressed - and opened on the name the table was given when the table
           found nobody at all. It is the shortcut the whole page answers to as well (`Ctrl`/`⌘`+`K`). -->
      <CharacterSearchDialog />
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <!-- The page opens with what the table holds rather than with a block about the site: the search stands in
           the bar above it, and the widgets are the answer a reader who came for the ranking is looking for. -->
      <LeaderboardStats :stats="stats" :pending="pending" :online="onlineCount" />

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

      <!-- The table, with the name that matched nothing handed to the search when the answer comes back empty: a
           character the site has never rendered has no row here, and the field the reader filled in is not the
           place to find that out the hard way. The press leaves the table as an event and becomes an ask here
           (`app/composables/characterLookup.ts`), which the sheet in the row above answers. -->
      <LeaderboardTable
        class="mt-3"
        :players="rows"
        :sort="filters.sort"
        :columns="columns"
        :offset="offset"
        :pending="pending"
        :highlight="meKey"
        :owner="ownerKey"
        :online="online"
        @update:sort="setSort"
        @inspect="lookUp(search)"
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

    <!-- The line every page of the site signs off with: the wordmark over the brand line, drawn exactly as the
         character pages draw it. -->
    <footer class="relative container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>

    <!-- Back to the top once the table has run past the window, and the support plate, which holds the other
         bottom corner. -->
    <BackToTop />
    <SupportButton />
  </div>
</template>
