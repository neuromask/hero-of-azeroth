<script setup lang="ts">
/**
 * The front door, which is the hall of fame: the page the site is summed up on.
 *
 * It is a *summary* rather than a table, and the tables are the rankings the menu leads to
 * (`/leaderboards/<figure>`, at the world, a region or a realm). This page is what stands in front of them: the menu
 * of the site's fourteen entries - the hall of fame itself, and the thirteen figures - and the ten plates about the
 * population: how many members it holds and who is on it right now, the class most of them wear, and the leader of
 * each figure the site ranks. A reader who wants rows presses a plate (the leader's) or a menu entry; every one of
 * those is an address of its own, and the character this browser selected is one press away in the corner of the bar
 * (`app/components/SelectedCharacterChip.vue`), which the ranking pages wear with their own figure and scope.
 *
 * That is a change of shape rather than of purpose. For a while the site had two doors - a form to walk through and
 * a ranking to arrive at - and a reader had to choose between them before knowing which one they wanted; they became
 * one page, and the ranking that page drew has since become the thirteen rankings the menu names. What is left here
 * is the part of it that was never a list: who the site holds, who leads it, and where the reader stands.
 *
 * The address is `/` in English and `/ru` in Russian, exactly as it was, so every link the site has handed out still
 * lands where it said; the hall of fame's old address, `/leaderboard`, is a 301 to this one (`nuxt.config.ts`,
 * `routeRules`), and that is the site's only redirect - it buries an address rather than choosing a language, which
 * no other address of the site does.
 *
 * The row under the header is the site's own navigation, as one component (`app/components/SiteNav.vue`): the
 * character's six views - the profile under their own name, the collections, the achievements, the reputations,
 * the feed and the comparison - pointing at the character this browser opened last, and the site's own two entries
 * held apart from them past a hairline: the hall of fame and the search. They are drawn only once there is such a
 * character: an entry that leads to the page the reader is already on is worse than no entry at all, and before the
 * browser has been taught a character there is nothing to point at but the search. Nothing is learned here any more:
 * a character is remembered by opening their page, and a reader who has just arrived has the search to do it with.
 * Below `lg` the entries move into the panel that row drops, because a phone has room for the search and the panel's
 * button alone - and the language and the account travel in that panel too, which is where the header's corner hands
 * them over.
 *
 * The figures are the site's own, and they are asked for once: the aggregate behind the plates is one request
 * (`/api/leaderboard/stats`, an hour of caching keyed on the stamp of the data), it is rendered on the server, and
 * it costs no more whether the population holds ten characters or two hundred thousand.
 */
definePageMeta({ alias: '/ru' })

// The characters this browser has looked up, which is where the row's character views find the character they
// belong to (see the composable for the shape and the limit).
import type { SearchHistoryEntry } from '#shared/utils/savedCharacters'
import { useSearchHistory } from '~/composables/searchHistory'
// The shape the plates below are drawn from, shared with the endpoint that builds it. The figure the reader's own
// plate was about - the overall rating - is what this page hands the corner as its ranking (`ranking` below), and the
// chip of the selected character is built from it (`app/components/SelectedCharacterChip.vue`).
import type { LeaderboardStats } from '#shared/data/leaderboardSchema'
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

/**
 * The population, as the plates below read it - and the same object every widget of the page is drawn from
 * (`LeaderboardStats` in `#shared/data/leaderboardSchema`).
 *
 * It is awaited with the page, so the plates arrive with the first render rather than filling in behind the reader.
 * The request asks to be answered afresh (`no-cache`), because the population moves as the site's own pages are
 * rendered and an hour of it in a browser's store is an hour of figures that are no longer the site's.
 */
const { data: stats, pending } = await useFetch<LeaderboardStats>('/api/leaderboard/stats', {
  key: 'hoa-leaderboard-stats',
  headers: { 'cache-control': 'no-cache' }
})

/**
 * Who is on the site, which the population plate prints beside the count it holds.
 *
 * The list is fetched with the page - the first answer the server sends already carries it, so the figure is in the
 * HTML - and re-read every minute while the tab is visible (`app/composables/presence.ts`). The beat is everybody's,
 * so the read lives here rather than in the plugin, and the count is the only part of it this page has any use for:
 * the dots on the portraits went with the table.
 */
const { count: onlineCount } = await usePresence()

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
    name: SITE_NAME,
    url: publicConfig.siteUrl,
    description: t('homeDescription'),
    inLanguage: [...SUPPORTED_LOCALES]
  })
})

/**
 * The line under the page's name in the header: who the site holds, in the reader's language.
 *
 * It is the header's version of a character's class and realm - the facts the page is about, read in one glance -
 * and it comes off the same aggregate the plates below print, so it can never disagree with them. An empty string
 * until the answer lands, which the header prints as no line.
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
 * The character this page is about for this reader: the one the row of links under the header belongs to.
 *
 * The hall of fame is not a character, so the profile, the shelves and the feed it offers have to belong to
 * somebody - and for a reader who is signed in that somebody is **the main their account leads with**: the row
 * leads to *their* character page and offers *their* profile. A character this browser looked up last, on the other
 * hand, is somebody else's page being read: it is remembered as one lookup among others (`useSearchHistory`) and it
 * is *not* what the row stands for. Reading a visitor's last lookup as "you" was how a reader signed in as
 * themselves came to see their main in the row and be sent to an alt by the entry under it.
 *
 * A reader with no account has only the browser to go on, and there the last character looked at is exactly the
 * right answer: it is their own page coming back, which is what the row has always been (`MyProfile.vue` reads the
 * same history for the same reason).
 *
 * Before either is known - a first visit with no session, a crawler, a reader who followed a link - there is no
 * such character at all: the row below the header draws no character links and the bar offers the search instead
 * (see the note at the top of this file). The corner of the bar is the one place of the page that answers about the
 * *browser's* own selection rather than about this page's subject - the chip is the last character this device opened,
 * whether or not a main is signed in - and it is the one control of that corner a page has to ask for (`ranking`).
 */
const { history, load: loadHistory } = useSearchHistory()

/** The account's main, written as an entry the row under the header is read against (`useSearchHistory`). */
function mainEntry(): SearchHistoryEntry | null {
  const main = accountMain.value
  if (!main) return null

  // The realm's *name* is left as the slug on purpose: the row's entry prints a realm through the site's own list
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

// The history lives in the browser and the server has none, so it is read once the page is mounted: the first
// render carries no character at all - no character links in the row, and no chip about one in the corner of the
// header - and both sides render the same page at the same moment, so hydration has nothing to disagree about. It
// is the row's own entries that fill in, never the figures above them.
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
         views, the site's own two entries, and the search (`app/components/SiteNav.vue`). It is handed the overall
         rating as its ranking, which is the table this page is the front of: that is what draws the chip about the
         selected character in the corner, and what the chip's press finds their row in. -->
    <SiteHeader :title="t('lbTitle')" :meta="meta" :ranking="{ metric: 'score' }">
      <!-- Nothing stands on the right of this bar: this page offers no action of its own, and the corner of the bar
           is the reader's own group - the character this browser selected, the language and the account
           (`app/components/HeaderTools.vue`), which every page of the site wears. The fields a first visit is offered
           go to the row below this bar rather than to its corner: they are the search, and the search has a place of
           its own in that row. -->

      <!-- The whole row, and it is the same component a character page wears: the six views of whichever
           character this browser is reading, the site's own two entries held apart from them by the hairline,
           the search and, on a phone, the panel the entries move into (`app/components/SiteNav.vue`).

           The character is the one this reader came from, and it is also the one thing this page does
           differently from a character page: the row above is drawn only once this browser knows somebody,
           because the hall of fame used to lead these entries to the front door while no character was known -
           and the front door is now this page, where an entry pointing at the page it stands on is not a link.
           The hall of fame is one of the row's own entries and *is* the page being read, so the row is simply
           told which entry is lit and warms it with the gold without a special case. -->
      <SiteNav :character="reading" :label="t('lbTitle')" active="leaderboard">
        <!-- The search a first visit is offered, handed to the row and standing in the place the character's own
             entries take - which is empty exactly while this page has no character to lead them with. The fields
             are the same two, and the same button, as the sheet behind the button at the row's far end
             (`app/components/CharacterSearchForm.vue`, `compact`). They are drawn exactly while this browser
             knows no character and nobody is signed in: a reader who has looked somebody up has the button, and
             a reader who is signed in has their own main in this row. Below `lg` the row has room for the
             search's button alone, which opens the same fields, so the fields are left out there. -->
        <template #search>
          <span v-if="!reading && !account?.user" class="hidden lg:block">
            <CharacterSearchForm compact />
          </span>
        </template>
      </SiteNav>
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <!-- The site's tables, as one menu and nothing else: the front door draws no table, so the bar is told there
           is none (`filters`) and stands as the row of links it is - the hall of fame first, then the thirteen
           figures. It leads the page, because the tables are what the site is for and this page is what stands in
           front of them. -->
      <LeaderboardFilters :current="null" :filters="false" />

      <!-- And the plates about the population: how many members the site holds and who is on it right now, the
           class most of them wear, and the leader of each figure it ranks - each of those a door into the ranking
           it leads, and all ten of them drawn from one request (`/api/leaderboard/stats`). -->
      <LeaderboardStats class="mt-3" :stats="stats || null" :pending="pending" :online="onlineCount" />

      <!-- Under them, the population as a whole rather than one member at a time: where it lives (each realm a link
           into that realm's own ranking), what it plays, which side it plays for, and everything it has gathered
           between them with the day the table was last written. Same request, same block, and the part of the hub a
           reader who has no character of their own still has something to read in. -->
      <LeaderboardBreakdown class="mt-3" :stats="stats || null" :pending="pending" />
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
