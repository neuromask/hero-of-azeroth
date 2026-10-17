<script setup lang="ts">
// The shelves the collections menu opens and the categories the achievements menu does, in the order those
// two menus list them. The panel a phone opens them in reads the same two lists, so the narrow screen can
// never offer a different set of entries than the row above it.
import { COLLECTION_KINDS } from '#shared/data/collectionsSchema'
import { ACHIEVEMENT_CATEGORIES, ACHIEVEMENT_LABEL_KEYS } from '#shared/data/achievementsSchema'
// The thirteen rankings the hall of fame's own menu drops, in the order it lists them (`HallOfFameMenu`).
import { METRIC_LEADERBOARDS } from '#shared/data/leaderboardSchema'
// The class a name is printed in, which is what tints the tab that carries the character's own name.
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
// The shape a character is remembered in, which is what the row's links and the tab's face are built from.
import type { SearchHistoryEntry } from '#shared/utils/savedCharacters'

/**
 * The navigation of the site: one row of entries in two groups, and the panel a phone opens them in.
 *
 * It is the *only* row the site has. The character shell draws it under the character's header, the hall of
 * fame draws it under its own, and `app/components/SiteHeader.vue` gives it to a page that has none of its own
 * (the account page, the documents) - so no page can wear the search twice, and a reader stepping between two
 * pages finds the same row in the same place. A page that is not about a character wears it with the first
 * group left out: what is left is the site's own two entries and the search, which is everything such a page
 * has.
 *
 * There are two kinds of entry in that row, and they answer two different questions. Five of them are about
 * the character being read - their profile, their collections, their achievements, their reputations and their
 * feed - and two are the site's own: the hall of fame the figures are ranked in and the search that opens the
 * next character. So the two are held apart from the five: they stand at the far end of the row, past a
 * hairline. One row still, so stepping between a character and the table keeps the bar and the entries exactly
 * where they are - but a reader can see which entries are about the character under the bar and which are
 * about the site they are on.
 *
 * The hall of fame is a control in two halves - the tab opens the hub, and the caret beside it drops the site's
 * thirteen rankings (`app/components/HallOfFameMenu.vue`) - and it is drawn the way the collections tab and its
 * caret are, because it answers the same kind of question: a page of its own to read, and a list of pages under it.
 *
 * The sixth view of a character is the comparison, and it does not stand as a tab of its own: it rides on the
 * character's own entry, as the second half of a split control beside the name. The name opens the profile and
 * the half beside it opens the comparison, drawn the way the collections tab and its caret are (`rounded-r-none`
 * on the first, `-ml-px rounded-l-none` on the second) so the two read as one control with two ends. The row is
 * where width is scarce, and a comparison is a question about *this* character rather than a section of their
 * own - so the entry carrying their name carries the way to read them against somebody else. That half is the
 * two arrows and nothing else, the one control of the row that says what it does rather than where it goes the
 * way the search's magnifier does; its words ride in its label and its tooltip. In the panel below `lg` the same
 * entry is a row of its own, because a list of rows has room for it and a phone reads a row better than a split
 * control.
 *
 * What the row does *not* carry is the reader. The language and the account stand in the header itself
 * (`app/components/HeaderTools.vue`), because they are properties of the reader rather than ways into a
 * section, and a page that drew them here as well would be showing the same two controls a finger's width
 * apart. Below `lg` they are rows of this panel instead, which is the one place a phone has for them.
 *
 * The first of the five carries the character's own name rather than the word "character", because that is
 * the one entry of the row whose subject the page knows: a reader looking at a bar wants to see *who* they
 * are looking at. It wears the class colour and the portrait the table's own rows do, so the tab and the row
 * a click later are recognisably the same character, and the word it stands for is not lost - it is the tab's
 * tooltip and the half of its accessible name that says which page it opens. It is also the entry the
 * comparison hangs off, so the two halves of it are the character's own page and the character read against
 * somebody else's.
 *
 * Below `lg` the row is not the row at all. A phone cannot hold the whole row, a divider and a corner in one
 * line, and a row that wraps to three lines costs a reader a whole screen of the page they came for. So the
 * entries that are *navigation* move into the panel the button opens: the character's own entries - the five
 * views, the comparison and the hall of fame - under the two headings they are grouped by. Inside the panel
 * the two menus keep their subtrees as
 * inline lists under the entry that opened them rather than as panes hanging off a caret - a pane opened
 * inside a pinned bar covers the panel it was opened from, and a phone reads an indented list under its
 * parent better than a second layer of glass. What stays in the row is the search, which is not a way of
 * reading the page but the way to the next character (`app/components/CharacterSearchDialog.vue`), and the
 * panel ends with the language and the account, which the header hands over to it at this width.
 *
 * The button is the row's own tab (`hoa-tab`) and states what it is doing the way every disclosure of the
 * site does: `aria-expanded` says whether the panel is out, its label swaps between opening and closing in the
 * reader's own language, and Escape, a press anywhere but the panel or the button, and a picked entry all shut
 * it again - the last of those because a link that has just been followed is the page being read, and the
 * panel would otherwise hang over it. `aria-controls` is deliberately not written: the panel is only in the
 * document while it is out (the same arrangement the search's own sheet makes,
 * `app/components/CharacterSearchDialog.vue`), and an attribute pointing at an element that is not there says
 * less than the state the button already reports. Both the button and the panel are drawn only below `lg`
 * (`lg:hidden`), so a wide screen never carries a second, unused copy of the row in its markup.
 */
const props = defineProps<{
  /**
   * The character whose views the row offers: the one the page is about, or the last one this browser read.
   * `null` on a page that knows nobody, where the character's entries are left out and only the site's two remain.
   */
  character?: SearchHistoryEntry | null
  /** What this navigation is the navigation of, which is what an assistive reader hears it called. */
  label: string
  /** The entry the address names, which is the one wearing the gold the rest of the site accents with. */
  active?: 'overview' | 'collections' | 'achievements' | 'reputations' | 'activity' | 'compare' | 'leaderboard' | null
}>()

const { t } = useI18n()
const route = useRoute()
const localeUrl = useLocaleUrl()

/**
 * The character's own views, as addresses - or `null` while this browser knows nobody, because then there is
 * nothing to point at and a link that guessed would point at the page being read.
 *
 * The three plain entries are handed whole addresses in the language being read; the two menus are handed
 * the subtrees they hang their entries from, and localise each entry themselves (see `CollectionMenu.vue`).
 */
const links = computed(() => {
  const character = props.character
  if (!character) return null

  const base = `/${regionPath(character.region)}/${character.realm}/${character.name}`

  return {
    overview: localeUrl(base),
    collections: `${base}/collections`,
    achievements: `${base}/achievements`,
    reputations: localeUrl(`${base}/reputations`),
    activity: localeUrl(`${base}/activity`),
    compare: localeUrl(`${base}/compare`)
  }
})

/** The colour the character's name and tab are tinted with: their class's own. */
const classHex = computed(() => classById(props.character?.classId ?? 0)?.hex || DEFAULT_CLASS_HEX)

/** The letter a tab without a portrait falls back to. */
const initial = computed(() => (props.character?.name || '').charAt(0).toUpperCase())

/** A portrait that failed to load, so the tab draws the monogram instead of a broken picture. */
const portraitBroken = ref(false)

/** Whether the phone's panel is out. */
const open = ref(false)
/** The two subtrees of the panel, which are lists inside it rather than panes dropped over it. */
const openCollections = ref(false)
const openAchievements = ref(false)
/** And the site's own list: the thirteen rankings of the hall of fame (`HallOfFameMenu`). */
const openRankings = ref(false)

/** The button and the panel, which is what a press has to land outside of to shut the panel. */
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

/**
 * Presses are read rather than clicks, the way the search's own sheet reads them: an entry of the panel shuts
 * the panel as the press lands, and a click listener would then be reported against an element that is no
 * longer in the document.
 *
 * A press inside the panel is the panel's own business, and so is a press on the button that opened it -
 * everything else shuts it, including the search button beside it, whose own sheet drops from the same row.
 */
function onDocumentPress(event: MouseEvent) {
  if (!open.value) return

  const target = event.target as Node
  if (panel.value?.contains(target) || trigger.value?.contains(target)) return

  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPress)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPress)
  document.removeEventListener('keydown', onKeydown)
})

/**
 * A panel that has just been opened shows where the reader stands: the subtree the page being read belongs to
 * opens with it - the shelves of the collections, the fifteen categories of the achievements, or the thirteen
 * rankings - and the others stay shut, so a reader already on a shelf sees the shelf they are on without a second
 * press.
 */
watch(open, (opened) => {
  if (!opened) return

  openCollections.value = props.active === 'collections'
  openAchievements.value = props.active === 'achievements'
  openRankings.value = props.active === 'leaderboard'
})

/** An entry that has just been picked is the page being read, so the panel is done with. */
watch(
  () => route.fullPath,
  () => {
    close()
  }
)

/** Whether `shelf` is the collections page being read, which is the sub-entry that is lit. */
function onShelf(shelf: string): boolean {
  return new RegExp(`/collections/${shelf}/?$`).test(route.path)
}

/** And whether `category` is the achievements page being read. */
function onCategory(category: string): boolean {
  return new RegExp(`/achievements/${category}/?$`).test(route.path)
}

/** And whether `slug` is the ranking being read, which is the site's own list's lit entry. */
function onRanking(slug: string): boolean {
  return String(route.params.metric || '') === slug
}

/** A row of the panel, and the two states it has - written whole, the way the site's panes write theirs. */
const ROW = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors'
const ROW_OFF = `${ROW} text-gray-200 hover:bg-white/10 hover:text-white`
const ROW_ON = `${ROW} bg-wow-gold/10 text-wow-goldLight`
/** A row of a subtree: indented past the entry that opened it, and quieter than its parent. */
const SUB_ROW = 'flex items-center rounded-lg px-3 py-2 text-sm transition-colors'
const SUB_OFF = `${SUB_ROW} text-gray-300 hover:bg-white/10 hover:text-white`
const SUB_ON = `${SUB_ROW} bg-wow-gold/10 text-wow-goldLight`
/** The heading a group of the panel is named by, in the reader's own words. */
const HEADING = 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500'
</script>

<template>
  <!-- The row fills whatever row it is handed (`flex-1`), and that is load-bearing rather than cosmetic: the
       two groups are pushed apart by `ml-auto` on the site's own, which only works while this box has free
       space in it. On a character page the box is a block child of the shell's `<nav>` and takes the width by
       itself; on a page whose row comes from `app/components/SiteHeader.vue` it is a *flex item* in that
       header's slot, where a box that sized itself to its content would leave the margin nothing to absorb -
       and the site's entries would then follow the character's instead of standing at the far end of the row.
       `min-w-0` is the other half: a box that may not shrink below its content would overflow the slot rather
       than wrap inside it. -->
  <div class="relative flex flex-1 min-w-0 flex-wrap items-center gap-2">
    <!-- The way into everything a phone cannot hold: drawn only below `lg`, where the row below it is not.
         It states what it does rather than where it goes, so it is a button carrying the state of a disclosure
         (`aria-expanded`) instead of a link - and its label swaps between opening and closing, which is what a
         reader on a screen reader hears as the panel comes and goes. -->
    <button
      ref="trigger"
      type="button"
      class="hoa-tab hoa-liquid-glass !px-3 lg:hidden"
      :class="{ 'hoa-tab-active': open }"
      :aria-expanded="open"
      :aria-label="open ? t('navMenuClose') : t('navMenuOpen')"
      :title="open ? t('navMenuClose') : t('navMenuOpen')"
      @click="open = !open"
    >
      <svg
        class="h-5 w-5 shrink-0"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <template v-if="open">
          <path d="M5.5 5.5l9 9" />
          <path d="M14.5 5.5l-9 9" />
        </template>
        <template v-else>
          <path d="M3.5 6h13" />
          <path d="M3.5 10h13" />
          <path d="M3.5 14h13" />
        </template>
      </svg>
    </button>

    <!-- The panel, and it stands before the entries it holds rather than after them: the sheet the search
         drops from the same row comes later in the document, and that ordering is what keeps a search the
         reader has just asked for over the panel they asked it from. It hangs the width of the row, scrolls
         inside itself (the fifteen categories alone are taller than a phone) and keeps its own scroll from
         travelling into the page behind it. -->
    <div
      v-if="open"
      ref="panel"
      class="hoa-pop absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto overscroll-contain p-2 lg:hidden"
    >
      <!-- The first group, named for what it is: the character being read, in their class colour. A page that
           is not about a character has no group here at all - the panel then carries the site's own entry
           alone, which is every entry such a page has. -->
      <p v-if="character" :class="HEADING">
        {{ t('navCharacterGroup') }}
        · <span :style="{ color: classHex }">{{ character.name }}</span>
      </p>

      <template v-if="character && links">
        <!-- The profile itself, wearing the character's face: the portrait and the name the table's row will
             carry a click later. The word the row's own tab stands for rides at its end, since the nickname
             alone does not say which page it opens. -->
        <NuxtLink
          :to="links.overview"
          :class="active === 'overview' ? ROW_ON : ROW_OFF"
          :aria-current="active === 'overview' ? 'page' : undefined"
          @click="close"
        >
          <span
            class="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border"
            :style="{ borderColor: `${classHex}66`, backgroundColor: `${classHex}1f` }"
          >
            <span class="text-xs font-extrabold" :style="{ color: classHex }">{{ initial }}</span>
            <img
              v-if="character.avatar && !portraitBroken"
              :src="character.avatar"
              :alt="character.name"
              loading="lazy"
              decoding="async"
              class="absolute inset-0 h-full w-full object-cover"
              @error="portraitBroken = true"
            />
          </span>
          <span class="truncate">{{ character.name }}</span>
          <span class="ml-auto shrink-0 text-[11px] font-normal uppercase tracking-wider text-gray-500">
            {{ t('tabOverview') }}
          </span>
        </NuxtLink>

        <!-- The collections and the achievements: a list under the entry that opened it rather than a pane
             dropped over the panel. What the page being read belongs to is the one that is open. -->
        <button
          type="button"
          :class="active === 'collections' ? ROW_ON : ROW_OFF"
          :aria-expanded="openCollections"
          aria-controls="hoa-mobile-collections"
          @click="openCollections = !openCollections"
        >
          <span class="flex-1 text-left">{{ t('tabCollections') }}</span>
          <svg
            class="h-4 w-4 shrink-0 transition-transform duration-200"
            :class="openCollections ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
          </svg>
        </button>
        <div v-show="openCollections" id="hoa-mobile-collections" class="mb-1 ml-4 border-l border-white/10 pl-1">
          <NuxtLink
            v-for="shelf in COLLECTION_KINDS"
            :key="shelf"
            :to="localeUrl(`${links.collections}/${shelf}`)"
            :class="onShelf(shelf) ? SUB_ON : SUB_OFF"
            :aria-current="onShelf(shelf) ? 'page' : undefined"
            @click="close"
          >
            {{ t(shelf) }}
          </NuxtLink>
        </div>

        <button
          type="button"
          :class="active === 'achievements' ? ROW_ON : ROW_OFF"
          :aria-expanded="openAchievements"
          aria-controls="hoa-mobile-achievements"
          @click="openAchievements = !openAchievements"
        >
          <span class="flex-1 text-left">{{ t('tabAchievements') }}</span>
          <svg
            class="h-4 w-4 shrink-0 transition-transform duration-200"
            :class="openAchievements ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
          </svg>
        </button>
        <div v-show="openAchievements" id="hoa-mobile-achievements" class="mb-1 ml-4 border-l border-white/10 pl-1">
          <NuxtLink
            v-for="category in ACHIEVEMENT_CATEGORIES"
            :key="category"
            :to="localeUrl(`${links.achievements}/${category}`)"
            :class="onCategory(category) ? SUB_ON : SUB_OFF"
            :aria-current="onCategory(category) ? 'page' : undefined"
            @click="close"
          >
            {{ t(ACHIEVEMENT_LABEL_KEYS[category]) }}
          </NuxtLink>
        </div>

        <NuxtLink
          :to="links.reputations"
          :class="active === 'reputations' ? ROW_ON : ROW_OFF"
          :aria-current="active === 'reputations' ? 'page' : undefined"
          @click="close"
        >
          {{ t('tabReputations') }}
        </NuxtLink>

        <NuxtLink
          :to="links.activity"
          :class="active === 'activity' ? ROW_ON : ROW_OFF"
          :aria-current="active === 'activity' ? 'page' : undefined"
          @click="close"
        >
          {{ t('tabActivity') }}
        </NuxtLink>

        <!-- The comparison: in the panel it is a row of its own rather than the second half of the character's
             own entry, which is what it is in the row above - a list of rows has room for it, and a phone reads
             a row better than a split control. It stands right after the feed, so a reader on a phone meets the
             entries in the order the row lays them out. -->
        <NuxtLink
          :to="links.compare"
          :class="active === 'compare' ? ROW_ON : ROW_OFF"
          :aria-current="active === 'compare' ? 'page' : undefined"
          @click="close"
        >
          <svg
            class="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          {{ t('tabVs') }}
        </NuxtLink>
      </template>

      <!-- And the site's own group under its own heading: the hall of fame, and the thirteen tables of the site
           under it. In a list of rows the split control of the row above has no room, so the pair is drawn the way
           the collections and the achievements are: a row that opens the tables it stands for. The hub itself is
           the brand in the header at every width, and it is what the row is lit as when it is being read.
           The search is not repeated here - it stands in the row above, one press away at every width and
           bound to `Ctrl`/`⌘`+`K` as well. -->
      <p class="mt-1 border-t border-white/10" :class="HEADING">{{ t('navSiteGroup') }}</p>

      <button
        type="button"
        :class="active === 'leaderboard' ? ROW_ON : ROW_OFF"
        :aria-expanded="openRankings"
        aria-controls="hoa-mobile-rankings"
        @click="openRankings = !openRankings"
      >
        <span class="flex-1 text-left">{{ t('lbNav') }}</span>
        <svg
          class="h-4 w-4 shrink-0 transition-transform duration-200"
          :class="openRankings ? 'rotate-180' : ''"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
        </svg>
      </button>
      <div v-show="openRankings" id="hoa-mobile-rankings" class="mb-1 ml-4 border-l border-white/10 pl-1">
        <NuxtLink
          v-for="entry in METRIC_LEADERBOARDS"
          :key="entry.slug"
          :to="localeUrl(metricLeaderboardPath(entry.slug))"
          :class="onRanking(entry.slug) ? SUB_ON : SUB_OFF"
          :aria-current="onRanking(entry.slug) ? 'page' : undefined"
          @click="close"
        >
          {{ t(entry.labelKey) }}
        </NuxtLink>
      </div>

      <!-- And the reader's own two settings, which the row above no longer carries: the language and the
           account, exactly as the header's corner draws them (`app/components/HeaderTools.vue`). The panel is
           where they land at this width, and it is the same two components in their panel shape - there is one
           place that draws a language and one that draws an account, so a phone and a window can never be
           offered different sets of them. Its heading is drawn by the account, whose group of the panel is the
           one they belong to. -->
      <HeaderTools variant="panel" />
    </div>

    <!-- A page's own switch, in the place a character page puts the character's views. The admin panel hands its
         two halves over here (`app/pages/admin.vue`), so the tabs stand in the navigation row rather than in a
         second row of their own - the row is the site's one row, and a page that has something of its own to
         switch says it there. -->
    <slot name="leading" />

    <!-- The character's own entries, on a screen wide enough to hold them: the profile under the
         character's own name, the two menus, the journal and the feed. The name is the tab's visible text and
         `tabOverview` leads its accessible name, so the entry says both which page it opens and whose it
         is - the label of a control always contains the words a reader can see on it. Its second half is the
         comparison: one control in two halves, split the way the collections tab and its caret are, and the half
         carries the two arrows and nothing else - a comparison is a question about this character rather than a
         section of their own, and this row is where width is scarce. -->
    <div v-if="links" class="hidden items-center gap-2 lg:flex">
      <div class="flex items-stretch">
        <NuxtLink
          :to="links.overview"
          class="hoa-tab hoa-liquid-glass max-w-[15rem] rounded-r-none"
          :class="{ 'hoa-tab-active': active === 'overview' }"
          :aria-current="active === 'overview' ? 'page' : undefined"
          :title="t('tabOverview')"
          :aria-label="`${t('tabOverview')}: ${character?.name}`"
        >
          <span
            class="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border"
            :style="{ borderColor: `${classHex}66`, backgroundColor: `${classHex}1f` }"
          >
            <span class="text-[10px] font-extrabold" :style="{ color: classHex }">{{ initial }}</span>
            <img
              v-if="character?.avatar && !portraitBroken"
              :src="character.avatar"
              :alt="character.name"
              loading="lazy"
              decoding="async"
              class="absolute inset-0 h-full w-full object-cover"
              @error="portraitBroken = true"
            />
          </span>
          <span class="truncate" :style="{ color: classHex }">{{ character?.name }}</span>
        </NuxtLink>

        <!-- The comparison, as the second half of that entry: the character read against somebody else. It is
             drawn against the name (`-ml-px` merges the shared rim) so the two read as one control, and it carries
             the word after the glyph rather than instead of it: the two arrows pointing opposite ways are the one
             thing in this row that says what the entry *does* rather than where it goes, and the word says it out
             loud for the reader who does not read glyphs. `shrink-0` is what keeps the word whole in a row that
             has run out of room, where the name beside it truncates instead - and the accessible name is the word
             itself, so no label has to be added on top of it. -->
        <NuxtLink
          :to="links.compare"
          class="hoa-tab hoa-liquid-glass -ml-px shrink-0 rounded-l-none"
          :class="{ 'hoa-tab-active': active === 'compare' }"
          :aria-current="active === 'compare' ? 'page' : undefined"
        >
          <svg
            class="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          <span class="whitespace-nowrap">{{ t('tabVs') }}</span>
        </NuxtLink>
      </div>

      <CollectionMenu :path="links.collections" :active="active === 'collections'" />
      <AchievementMenu :path="links.achievements" :active="active === 'achievements'" />

      <NuxtLink
        :to="links.reputations"
        class="hoa-tab hoa-liquid-glass"
        :class="{ 'hoa-tab-active': active === 'reputations' }"
        :aria-current="active === 'reputations' ? 'page' : undefined"
      >
        {{ t('tabReputations') }}
      </NuxtLink>

      <NuxtLink
        :to="links.activity"
        class="hoa-tab hoa-liquid-glass"
        :class="{ 'hoa-tab-active': active === 'activity' }"
        :aria-current="active === 'activity' ? 'page' : undefined"
      >
        {{ t('tabActivity') }}
      </NuxtLink>
    </div>

    <!-- The search a page hands the row, standing in the place the character's own entries take. It is the way to
         the next character rather than a way of reading this one, and while the row knows no character that place
         has nothing else to hold - so a page with somebody to offer hands the fields here rather than finding a
         spot of its own for them (`app/pages/index.vue`). It stands outside the site's own group, which is the
         row's far end and is left as it is: the hairline, the hall of fame and the button that opens the same
         fields as a sheet (`CharacterSearchDialog`). -->
    <slot name="search" />

    <!-- The other group, held at the far end of the row: the hairline is what says that what follows it is the
         site's own rather than this character's, and the gap around it is what makes the two read as a second
         group rather than as two more tabs. On a phone the hairline is not drawn - the panel names its own two
         groups with two headings - and the hall of fame travels inside that panel. -->
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <div class="hidden items-center gap-3 lg:flex">
        <span class="h-6 w-px bg-white/15" aria-hidden="true" />

        <!-- The hall of fame and the site's rankings, as one control in two halves: the tab opens the hub, and the
             caret beside it drops the thirteen tables of the site (`app/components/HallOfFameMenu.vue`) - the same
             pair the collections tab and its caret are, drawn the same way. -->
        <HallOfFameMenu :active="active === 'leaderboard'" />
      </div>

      <!-- The way to somebody who is not this character: the two fields, dropped as a sheet under this row. It
           is drawn at every width rather than kept in the panel, because it is not a way of reading this page
           but the way to the next character - and it brings `Ctrl`/`⌘`+`K` with it wherever it stands. The
           language and the account are not here: they belong to the header above this row, and this row ends
           with the search (`app/components/HeaderTools.vue`). -->
      <CharacterSearchDialog />
    </div>
  </div>
</template>
