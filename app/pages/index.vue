<script setup lang="ts">
/**
 * The front door, which is the hall of fame: the site's own public page, with the reader's own place above the
 * table's summary.
 *
 * For a while the site had two doors - a form to walk through and a ranking to arrive at - and a reader had to
 * choose between them before knowing which one they wanted. The form was the only page that could speak to
 * somebody who had never heard of the site and had no character in the table; the ranking was the only page that
 * showed what the site is worth looking at. They are one page now: a reader lands on the table, and the search
 * stands over the summary plates - the two fields and the button, in one row, in the place the plate of the
 * character this browser opened last takes as soon as there is one (`app/components/CharacterSearchForm.vue`) -
 * rather than as a page of its own.
 *
 * A first visit is the only one that needs the fields there. A reader who has looked somebody up has the search in
 * the row under the header (the `Search` tab, and `Ctrl`/`⌘`+`K` from anywhere), and a reader who is signed in is
 * shown their own main instead (`accountMain` below); so the two fields stand over the plates exactly while this
 * browser knows no character *and* nobody is signed in, and the plate the moment either is true. The row under the
 * header keeps the search for everybody, and the header itself keeps the language and the account.
 *
 * That is what the address says as well. This page is `/` in English and `/ru` in Russian, exactly as it was,
 * so every link and every ranking of the site's own front door is unchanged; the hall of fame's old address,
 * `/leaderboard`, is a 301 to this one (`nuxt.config.ts`, `routeRules`), and that is the site's only redirect
 * - it buries an address rather than choosing a language, which no other address of the site does.
 *
 * The row under the header is the site's own navigation, as one component (`app/components/SiteNav.vue`): the
 * character's six views - the profile under their own name, the collections, the achievements, the
 * reputations, the feed and the comparison - pointing at the character this browser opened last, and the
 * site's own two entries held apart from them past a hairline: the hall of fame and the search. They are
 * drawn only once
 * there is such a character: an entry that leads to the page the reader is already on is worse than no entry
 * at all, and before the browser has been taught a character there is nothing to point at but the search. The
 * table is where a character is learned - pressing a row opens their page, and that is the act that remembers
 * them - so the row is full on the next page a reader opens rather than invented here. Below `lg` the entries
 * move into the panel that row drops, because a phone has room for the search and the panel's button alone - and
 * the language and the account travel in that panel too, which is where the header's corner hands them over.
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
// Where a row of the table stands, which is what a character page's tile is answered with, and the two
// spellings of the question itself: which columns a link lights, and which row it asks for.
import { leaderboardRowFromQuery, LEADERBOARD_ROW_PARAM } from '~/composables/leaderboardView'
import type { LeaderboardPlayer, LeaderboardStanding } from '#shared/data/leaderboardSchema'
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
const route = useRoute()
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
 * somebody - and for a reader who is signed in that somebody is **the main their account leads with**: the plate
 * is about *them*, its link leads to *their* character page, and the button that finds them in the table walks to
 * the row of the main it just printed. A character this browser looked up last, on the other hand, is somebody
 * else's page being read: it is remembered as one lookup among others (`useSearchHistory`) and it is *not* what
 * the plate stands for. Reading a visitor's last lookup as "you" was how a reader signed in as themselves came to
 * see their main in the plate and be sent to an alt by the link under it.
 *
 * A reader with no account has only the browser to go on, and there the last character looked at is exactly the
 * right answer: it is their own page coming back, which is what the plate and the row of links have always been
 * (`MyProfile.vue` reads the same history for the same reason).
 *
 * Before either is known - a first visit with no session, a crawler, a reader who followed a link - there is no
 * such character at all: the row below the header draws no character links and the bar offers the search instead
 * (see the note at the top of this file).
 */
const { history, load: loadHistory } = useSearchHistory()

/** The account's main, written as an entry the plate and the row marks are read against (`useSearchHistory`). */
function mainEntry(): SearchHistoryEntry | null {
  const main = accountMain.value
  if (!main) return null

  // The realm's *name* is left as the slug on purpose: the plate prints a realm through the site's own list
  // (`realmLabel`), and the account stores only the slug, so there is nothing here for a language to spell
  // differently.
  return {
    name: main.name,
    realm: main.realmSlug,
    region: main.region === 'us' ? 'us' : 'eu',
    realmName: main.realmSlug
  }
}

/**
 * The character this browser is reading: the last one looked up here, or the main when it has looked up nobody.
 *
 * This is what the row of links under the header belongs to - the profile, the shelves and the feed it offers are
 * the character a reader is standing on, whoever that is - so a reader who looked somebody else up and came here
 * finds *that* character's links rather than their own account's.
 */
const reading = computed<SearchHistoryEntry | null>(() => history.value[0] || mainEntry())

/**
 * The reader's own character in the table, which is what the plate in the bar stands for.
 *
 * It is the last character this browser was reading - the one the plate then aims its own link and its button at
 * - with one exception, and the exception is the table's own rule: a character of the reader's account that is
 * not its main has no row in the hall of fame at all (`server/utils/leaderboardExclusions`: an account appears
 * with the character it leads with), so reading one of your own alts stands for the main, which is the row that
 * account really has. A stranger's character *is* in the table - looking them up is what put them there - so the
 * plate is about them, and a reader with no account has no such exception either: whatever they last looked at
 * is what the plate shows, exactly as it always did.
 */
const you = computed<SearchHistoryEntry | null>(() => {
  const read = reading.value
  const main = mainEntry()

  if (!main) return read
  if (!read) return main

  return rosterKeys.value.has(searchHistoryKey(read)) ? main : read
})

/**
 * The account's own characters, keyed the way the history keys them, which is what says whether the character
 * being read is one of the reader's own - the question `you` turns on. The roster arrives with the same payload
 * the main is read from, so this costs no second request.
 */
const rosterKeys = computed(
  () =>
    new Set(
      (account.value?.characters || []).map((character) =>
        searchHistoryKey({ region: character.region, realm: character.realmSlug, name: character.name })
      )
    )
)

/**
 * The identity of the character this browser was reading, which is what one of the table's rows is marked by.
 *
 * The mark is about the character the page is about rather than about who owns it: the page is a table of
 * characters, and the character a reader looked up here is exactly one of them - so that is the row it can point
 * at. The badge on that row says "selected", which is what it is, rather than claiming the row is the reader's
 * own. A reader who has looked nobody up on this device carries no such mark at all, and for a reader who is
 * signed in the plate stands for their main: the row *that* walks to is the one the account badge marks
 * (`ownerKey`), not this one.
 */
const meKey = computed(() => (history.value[0] ? searchHistoryKey(history.value[0]) : ''))

/**
 * The row the plate in the bar stands for, keyed the way a row is keyed, which is what its button walks to
 * (`revealRow`): the character `you` names - a signed-in reader's main, or a guest's last lookup. It is
 * deliberately a value of its own rather than one of the two badges: the plate is about one character, and the
 * badges are about two different questions.
 */
const plateKey = computed(() => (you.value ? searchHistoryKey(you.value) : ''))

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
 * How a row is found once the table has been asked for it.
 *
 * Two things lead to a row in this table, and both end here. The plate in the bar leads to the row of the
 * character it stands for - a signed-in reader's main, or the last character a guest looked up. A tile on a
 * character page leads to the row of the character whose page was pressed on: the tile's link carries that
 * character's key into this page's address (`leaderboardRowQuery`), and the table is turned to it below.
 *
 * A place is the one thing about a row the table can be asked for, and turning a place into a page is the
 * page's own step (`revealRank`); then the row has to be *seen*, and it is drawn one answer later - so the
 * scroll waits for that answer rather than looking for a row that is not on the screen yet. Every row carries
 * its own key (`data-key`, written by `LeaderboardTable` from the same `searchHistoryKey` the row is drawn
 * under), and that is what makes the walk an attribute rather than a position: the row is found wherever the
 * table happens to have put it, on whatever page, without the page counting rows.
 */
const scrollTarget = ref<string | null>(null)

/**
 * Brings a row into the middle of the window, by the key it is drawn under. The sticky header is why it is the
 * middle: a row scrolled to the top of the window would land under the bar.
 */
function scrollToRow(key: string) {
  nextTick(() => document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center' }))
}

/**
 * Walks to a row: the scroll when it is already drawn, and the page that holds it plus a scroll once that page
 * lands when it is not.
 *
 * A row already drawn is a scroll rather than a request, on purpose: the reader is looking at the table they
 * asked for, and reordering it would move the very row they have just found.
 */
function reveal(key: string, rank: number) {
  if (!key) return

  if (rows.value.some((player: LeaderboardPlayer) => searchHistoryKey(player) === key)) {
    scrollToRow(key)
    return
  }

  revealRank(rank)
  scrollTarget.value = key
}

/** Answers the plate's button: the reader's place, turned into the page that holds their row. */
function revealRow(rank: number) {
  reveal(plateKey.value, rank)
}

// The page the reader asked for arrives a moment after the request: `pending` falling is what says it is
// drawn, and the scroll happens once per row that was walked to, not once per page of the table.
watch(pending, (busy) => {
  if (busy || !scrollTarget.value) return

  const key = scrollTarget.value
  scrollTarget.value = null
  scrollToRow(key)
})

/**
 * The row a link into this table asked for: the character whose page the reader pressed it on.
 *
 * A tile on a character page is a link into the table - the figure under the reader's eye is a column of it -
 * and the reader pressing one is asking a question about *that* character: where do they stand among
 * everybody on this figure? Landing at the top of the table would answer a different question and leave the
 * reader to page through fifty screens for the one row they wanted, so the link names the row as well as the
 * column (`leaderboardRowQuery`), and this page turns the name into the place the overall table gives that
 * character and then walks to it.
 */
const askedKey = computed(() => leaderboardRowFromQuery(route.query[LEADERBOARD_ROW_PARAM]))

/**
 * The row that has already been walked to, so a link is followed once rather than on every render of the
 * table around it.
 */
const walked = ref<string | null>(null)

/**
 * Where the character a tile asked for stands - read in the browser, after the page has been drawn.
 *
 * A place is a question of its own, and one no other reader can be answered from, which is why it is a
 * request rather than part of the table's answer (`server/api/leaderboard/[region]/[realm]/[name]`). It is
 * asked for only when an address names a row, which is what makes the read lazy: a plain visit to the hall of
 * fame asks for the table and nothing else.
 *
 * It is asked for in the browser rather than while the page is being rendered, because what it leads to - the
 * scroll to the row - is something only a browser can do. The table itself is still rendered on the server,
 * with the columns the link named, so a reader arriving from a tile sees the figure they pressed from the
 * first frame while the place they hold on it is being looked up behind them.
 */
const { data: askedStanding, refresh: loadAskedStanding } = await useFetch<LeaderboardStanding | null>(
  () => {
    const key = askedKey.value
    if (!key) return ''

    const [region, realm, name] = key.split(':')
    if (!region || !realm || !name) return ''

    return `/api/leaderboard/${region}/${realm}/${encodeURIComponent(name)}`
  },
  { key: 'hoa-leaderboard-asked', immediate: false, default: () => null }
)

/**
 * And the walk to it, once the place is known.
 *
 * Two things make this read the way it does. The first is that the row may already be on the screen: the table
 * the reader is looking at is the answer the server sent, so a character in it is scrolled to without asking
 * for a place at all. The second is that an address asks once - `walked` remembers the row this page has
 * already been turned to, so a table that re-renders around it (a filter changed by hand, an answer landing)
 * does not drag the reader back to a row they have already seen.
 *
 * A place that cannot be read leaves the page exactly as it is: a character the table does not know - one of
 * an account's alts, which the hall of fame enters as the main its account leads with, or a character whose
 * page nobody has rendered yet - has no row to walk to, and the ask is simply left unanswered.
 */
watch(
  [askedKey, askedStanding],
  ([key, standing]) => {
    // A scroll is the browser's: a server render has no window to move, and the place is read there for the
    // answer alone (hence `immediate: false` above).
    if (!import.meta.client || !key) return
    if (walked.value === key) return

    if (!standing) {
      if (rows.value.some((player: LeaderboardPlayer) => searchHistoryKey(player) === key)) {
        walked.value = key
        scrollToRow(key)
        return
      }

      loadAskedStanding()
      return
    }

    // A place without a rank is not a place: the answer is only used once it says where the row stands.
    if (!standing.rank) return

    walked.value = key
    reveal(key, standing.rank)
  },
  { immediate: true }
)

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
         the reader's own corner on the right, and, under it, the very row those pages carry - the character's six
         views, the site's own two entries, and the search (`app/components/SiteNav.vue`). -->
    <SiteHeader :title="t('lbTitle')" :meta="meta">
      <!-- Nothing stands on the right of this bar: the plate of the character this reader came from, and the
           search a first visit needs, are drawn over the summary plates in the content below - where a reader
           looking for their own place among everybody else looks anyway - and the corner of the bar is the
           reader's own group, the language and the account (`app/components/HeaderTools.vue`), which every page
           of the site wears. The comment over the plate below says why it stands there rather than here. -->

      <!-- The whole row, and it is the same component a character page wears: the six views of whichever
           character this browser is reading, the site's own two entries held apart from them by the hairline,
           the search and, on a phone, the panel the entries move into (`app/components/SiteNav.vue`).

           The character is the one this reader came from, and it is also the one thing this page does
           differently from a character page: the row above is drawn only once this browser knows somebody,
           because the hall of fame used to lead these entries to the front door while no character was known -
           and the front door is now this page, where an entry pointing at the page it stands on is not a link.
           The hall of fame is one of the row's own entries and *is* the page being read, so the row is simply
           told which entry is lit and warms it with the gold without a special case. -->
      <SiteNav :character="reading" :label="t('lbTitle')" active="leaderboard" />
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <!-- The reader's own place in the table, drawn over the summary plates rather than in the bar - and the
           search a reader this browser knows nothing about is offered instead, in the same spot, for the same
           reason. The place is the first thing a reader who came to see where they stand is looking for: it is
           the page's own answer about them, of the same kind as the five plates under it, and it belongs where
           those are read rather than in a bar that every page of the site draws the same way. It is also the
           only block of this page that is about one character, so it is the one block that moves: a reader who
           looked somebody else up and came here finds their place above the population, and a reader who has
           looked nobody up is asked to rather than shown a pair of dashes (`app/components/LeaderboardYou.vue`).

           The search a first visit is given stands in the plate's place, with the fields the bar used to carry
           (`app/components/CharacterSearchForm.vue`, `compact`): the reader this waits for is one who has never
           looked anybody up on this browser and has no account, so the front door still opens with the way to
           look somebody up rather than with a table they cannot be found in. A reader who is signed in is left
           out of it, because the plate above is already about their main - which is the better answer to "who
           am I looking at" than a pair of empty fields. -->
      <LeaderboardYou v-if="you" class="mb-3" :character="you" @reveal="revealRow" />

      <CharacterSearchForm v-else-if="!account?.user" compact class="mb-3" />

      <!-- The page opens with what the table holds rather than with a block about the site: the widgets are the
           answer a reader who came for the ranking is looking for, and the search is one press away in the row
           above - either in the plate's place or in the row itself (`app/components/CharacterSearchDialog`). -->
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
           (`app/composables/characterLookup.ts`), which the sheet in the row above answers.

           The rows are handed their `you` no longer: a page walks to a row by the key the row itself carries,
           so what it needs to know is the key and not whether it happens to be the plate's. -->
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
