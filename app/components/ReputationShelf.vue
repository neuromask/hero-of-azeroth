<script setup lang="ts">
// The journal the endpoint assembles, the group shape it comes in, and the one group whose name is a
// message key rather than a string.
import {
  REPUTATION_GROUP_KEYS,
  type ReputationGroup,
  type ReputationRow
} from '#shared/data/reputationsSchema'
// Counts are written by the site's one rule (`#shared/utils/formatNumber`), as on the shelves beside
// this one.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * A character's reputation journal: the factions the game tracks, filed by expansion the way its own
 * reputation pane files them, each with the stage the character stands on and the scale of its ladder.
 *
 * The journal is read two ways, which the switch under the heading asks for and remembers
 * (`app/composables/reputationView.ts`): the character's own payload, or the account's union across the
 * roster, where a row only another character has finished is marked with the site's star. Either way the
 * numbers a heading reads are the numbers of the rows drawn under it, and the note under the heading
 * spells out which reading is on - the character's own counter, or the account's maxima with this
 * character's own share of them.
 *
 * A row *is* the measure: one block with the faction's name set into its left and the stage it stands at,
 * with the numbers inside that stage, set into its right (`Почтение · 751 / 21 000`), and the fill standing
 * behind the words - so two hundred rows read down the page as one column of measures rather than a wall of
 * stripes. Hovering a row names the stage and the span it covers (`Honored · 9 000 – 21 000`), which is read
 * from the ledger the journal ships with it (`ReputationStep`, `server/utils/reputations.ts`).
 *
 * The page is laid out like the collections shelf beside it: the same pinned rail of quick anchors to the
 * left, the same panes for the groups, and the same blocks a subcategory is drawn in
 * (`.hoa-subgroups-container`, a name on a tag over its own rows). The rail mirrors the one the
 * collections grid carries, as `AchievementShelfGrid` mirrors that grid itself: it measures the character's
 * header, pins a chip per group and lights the one being read, and the two are kept in step by hand - a
 * change to one is a change to both.
 *
 * The search box and the two switches under the heading are the view's own and never leave the browser: the
 * box narrows the rows by name, one switch drops the factions the character has not started, the other the
 * ones they have finished, and none of them changes a count, because the journal was read whole. A group or
 * a heading whose every row was filtered away is not drawn at all - and the rail follows what is drawn, so a
 * chip is never a link to nothing.
 */
/**
 * Whose journal this is, which the shelf's own switch asks for and remembers
 * (`app/composables/reputationView.ts`): the account's reading marks the rows only another character of the
 * account has finished, and the endpoint gives it only where the site holds such a pool at all.
 */
const view = useReputationView()

const { data, pending, error, refresh } = await useReputationJournal(view)

/**
 * Whether the journal on screen is the account's reading. The note under the heading is written for it alone -
 * the endpoint names the account's maxima and this character's own share of them only there - so this is what
 * picks its first two lines, while the one naming the ladders under way is the same in both readings.
 */
const accountReading = computed(() => Boolean(data.value?.account && data.value.accountFinished !== undefined))

// The journal is read again only when the character or the language changes, which is a navigation the
// preloader already follows; the wait for the first read is registered here all the same, so the shelf
// and the collections beside it behave the same way.
usePageLoading().follow('character:reputations', pending)

const { t } = useI18n()

/** The search box's text, narrowed against a faction's name as the reader types. */
const search = ref('')
/** Whether the factions the character has not started are left out, which is off when the shelf opens. */
const hideUnstarted = ref(false)
/**
 * Whether the factions the character has already finished are left out too - which is the switch a journal
 * that is mostly done is read by: turning it on leaves what is still open in front of the reader.
 */
const hideFinished = ref(false)
/** Whether the note under the heading is open, which a click on its button toggles. */
const legendOpen = ref(false)

/** Whether one row survives the switches: it is in the state asked for, and its name carries what was typed. */
function keeps(row: ReputationRow, needle: string, whole: boolean): boolean {
  if (hideFinished.value && row.finished) return false
  if (hideUnstarted.value && !row.started && !row.finished) return false
  if (whole || !needle) return true

  return row.name.toLowerCase().includes(needle)
}

/**
 * The journal as the switches leave it: the rows that survive them, and every section and group that came
 * out empty dropped. The counts a heading carries are the journal's own rather than the filtered ones, so
 * a reader narrowing the list is never told the character has finished fewer factions than they have.
 *
 * A group or a heading whose own name carries what was typed keeps all of its rows, which is what makes a
 * search for "Pandaria" or "Альянс" read as that expansion's or that side's list rather than as nothing.
 */
const groups = computed(() => {
  const journal = data.value
  if (!journal) return []

  const needle = search.value.trim().toLowerCase()

  return journal.groups
    .map((group) => {
      const groupMatched = Boolean(needle) && labelOf(group).toLowerCase().includes(needle)

      const sections = group.sections
        .map((section) => {
          const whole = groupMatched || (Boolean(needle) && section.label.toLowerCase().includes(needle))

          return {
            id: section.id,
            label: section.label,
            finished: section.finished,
            total: section.total,
            rows: section.rows.filter((row) => keeps(row, needle, whole))
          }
        })
        .filter((section) => section.rows.length)

      return { group, sections }
    })
    .filter((entry) => entry.sections.length)
})

/** How many rows the switches left, which is what says whether the journal is worth drawing at all. */
const shown = computed(() =>
  groups.value.reduce(
    (total, entry) => total + entry.sections.reduce((sum, section) => sum + section.rows.length, 0),
    0
  )
)
/**
 * The quick anchors: a chip for every group of the journal, in a panel that stands to the left of the
 * shelf and stays under the character's header as the page is scrolled.
 *
 * The header is sticky and its height is not a constant - it is a column on a narrow screen and a row on a
 * wide one, and the character's name and title wrap - so the panel measures it rather than guessing a
 * `top`, and follows it as the window changes. The same measurement is handed to the groups as
 * `--hoa-anchor-offset` (see `.hoa-section`): the room a group keeps above itself when a chip scrolls to
 * it, so the group comes to rest below the header rather than under it.
 *
 * The rail is drawn only while there is more than one group to walk. A journal filtered down to a single
 * expansion is not something a rail helps with, and the shelf then takes the whole width instead of
 * standing beside a column nothing is drawn in.
 */
/** A group's heading: Blizzard's own name, or the message key the synthetic group is carried under. */
function labelOf(group: ReputationGroup): string {
  if (group.label) return group.label

  return group.id in REPUTATION_GROUP_KEYS ? t(REPUTATION_GROUP_KEYS[group.id as keyof typeof REPUTATION_GROUP_KEYS]) : ''
}

const railEl = ref<HTMLElement | null>(null)
const stickyTop = ref(0)
const anchorOffset = ref(128)
const activeGroup = ref(0)
const chipEls = new Map<number, HTMLElement>()
const groupEls = new Map<number, HTMLElement>()
let anchors: IntersectionObserver | null = null
let headerObserver: ResizeObserver | null = null

/** Whether the rail is drawn, which is what the grid beside the shelf is laid out by as well. */
const anchored = computed(() => groups.value.length > 1)

function measure(): void {
  const header = document.querySelector('header')
  stickyTop.value = header ? Math.round(header.getBoundingClientRect().height) : 0
  anchorOffset.value = stickyTop.value + 12
}

function setChip(index: number, element: Element | null): void {
  if (element) chipEls.set(index, element as HTMLElement)
  else chipEls.delete(index)
}

function setGroup(index: number, element: Element | null): void {
  if (element) groupEls.set(index, element as HTMLElement)
  else groupEls.delete(index)
}

/**
 * Scrolls a group into view. `html { scroll-behavior: smooth }` makes the travel a glide, and the
 * `scroll-margin-top` a group carries is what leaves the header and the rail their room.
 */
function jumpTo(index: number): void {
  activeGroup.value = index
  groupEls.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Keeps the chip of the group being read inside the panel, without moving the page: only the panel
 * scrolls, and only when the chip has left it.
 */
function centerChip(index: number): void {
  const chip = chipEls.get(index)
  if (!chip || !railEl.value) return
  chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

watch(activeGroup, centerChip)

/** Points the observer at whatever is drawn: a chip is only ever a link to a group that is on the page. */
function observeGroups(): void {
  if (!anchors) return
  anchors.disconnect()
  for (const element of groupEls.values()) anchors.observe(element)
}

/**
 * The groups whose rows are in the DOM.
 *
 * A journal holds every reputation the game tracks - two hundred rows, each with its own divisions - so
 * building all of them at once is thousands of nodes and a hydration to match, which is what the shelves
 * beside this one refuse to pay too. The first group is built with the page, because that is the one the
 * visitor is looking at, and every other joins it only as it comes near the viewport; the headings are
 * always drawn, so what the page first paints is a list of groups with one of them open.
 */
const revealed = ref<Set<number>>(new Set([0]))
let sections: IntersectionObserver | null = null

/** Builds `index`'s rows, which is what the observer below calls as a group comes into view. */
function reveal(index: number): void {
  if (revealed.value.has(index)) return
  revealed.value = new Set([...revealed.value, index])
}

/** Points the observer at whatever is drawn, as the anchor observer above is pointed at the same nodes. */
function observeSections(): void {
  if (!sections) return
  sections.disconnect()
  for (const element of groupEls.values()) sections.observe(element)
}

/**
 * A rough height for a group that is not built yet, so the page does not jump as it is built: one block per
 * row and the gap under it, plus the heading and the measure the group carries.
 */
function placeholderHeight(entry: { sections: { rows: unknown[] }[] }): string {
  const rows = entry.sections.reduce((sum, section) => sum + section.rows.length, 0)

  return `${rows * 36 + 70}px`
}

onMounted(() => {
  measure()
  const header = document.querySelector('header')
  if (typeof ResizeObserver !== 'undefined') {
    headerObserver = new ResizeObserver(measure)
    if (header) headerObserver.observe(header)
  }

  // Which chip is lit: the group the window is standing over. The strip it watches is the one just under
  // the header, and the last group in it is the one being read.
  anchors = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        activeGroup.value = Number((entry.target as HTMLElement).dataset.group)
      }
    },
    { rootMargin: `-${anchorOffset.value}px 0px -70% 0px` }
  )
  // The rows are built a group at a time, a screen ahead of the reader, so a journal of two hundred
  // factions is a list of headings until it is scrolled.
  sections = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        reveal(Number((entry.target as HTMLElement).dataset.group))
        sections?.unobserve(entry.target)
      }
    },
    { rootMargin: '600px 0px' }
  )
  observeSections()
})

onBeforeUnmount(() => {
  anchors?.disconnect()
  sections?.disconnect()
  headerObserver?.disconnect()
  anchors = null
  sections = null
  headerObserver = null
})

// The rail follows what is drawn: another filter leaves other groups, and they are the ones the observers
// have to be pointed at again - the first of them being what the rail opens on and what is built at once.
watch(groups, () => {
  activeGroup.value = 0
  revealed.value = new Set([0])
  nextTick(() => {
    observeGroups()
    observeSections()
  })
})

/** The three points the note under the heading makes, in the order it makes them. */
const LEGEND = [
  { title: 'reputationsLegendCharacterTitle', text: 'reputationsLegendCharacterText' },
  { title: 'reputationsLegendFinishedTitle', text: 'reputationsLegendFinishedText' },
  { title: 'reputationsLegendScaleTitle', text: 'reputationsLegendScaleText' }
] as const
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- The wait itself is the site-wide preloader's to draw (see `PagePreloader.vue`); keeping the room
         of the journal here is what stops the page jumping while it is read. -->
    <div v-if="pending" class="py-20" />

    <div v-else-if="error" class="mx-auto max-w-3xl py-16 text-center">
      <p class="mb-4 text-lg font-semibold text-red-400">{{ $t('reputationsError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="refresh()">
        {{ $t('reputationsRetry') }}
      </button>
    </div>

    <template v-else-if="data">
      <!-- The heading of the journal: how many factions the character has finished, over the whole of what
           they can raise, and the two switches that narrow the list without touching a count. Its bar is the
           brand gold every section's own total is drawn in, while the groups below keep the shelves'
           emerald. -->
      <section class="hoa-panel mb-6 p-4 sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-bold text-white sm:text-xl">{{ $t('reputationsOverall') }}</h2>
          <span class="whitespace-nowrap text-sm font-bold tabular-nums text-wow-goldLight">
            {{ formatNumber(data.finished) }}/{{ formatNumber(data.total) }}
            <span class="text-gray-400">({{ formatNumber(data.percent) }}%)</span>
          </span>
        </div>

        <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full border border-white/10 bg-black/60 p-0.5">
          <div
            class="h-full rounded-full bg-gradient-to-r from-wow-gold to-amber-300 transition-[width] duration-700"
            :style="{ width: `${data.percent}%` }"
          />
        </div>

        <!-- What the numbers above are, in one box, on the notice sheet the site's own explanations stand on
             (`app/pages/profile.vue`'s main hint), because this is the one block on the page that explains rather
             than counts. The icon stands on the first line and is there in either reading: the account's, which
             names the account's maxima and this character's own share of them, and the character's own, which
             names what it counts as closed. The last line is the same in both, because the ladders still under
             way are what is left of the figure above. Each sentence reads the reading that is on, so it agrees
             with the figure. -->
        <div class="mt-2 rounded-xl border border-[#00aeff]/30 bg-[#0074e0]/10 px-3 py-2 text-xs text-gray-200">
          <div class="flex items-start gap-2" role="note">
            <svg
              class="mt-0.5 h-4 w-4 shrink-0 text-[#4dc8ff]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
            </svg>

            <div class="min-w-0">
              <template v-if="accountReading">
                <p>
                  {{
                    $t('reputationsAccountMaxed', {
                      account: formatNumber(data.accountFinished ?? 0),
                      total: formatNumber(data.total)
                    })
                  }}
                </p>

                <p class="mt-1.5">
                  {{
                    $t('reputationsAccountOwn', {
                      own: formatNumber(data.characterFinished ?? 0),
                      allies: formatNumber((data.accountFinished ?? 0) - (data.characterFinished ?? 0))
                    })
                  }}
                </p>
              </template>

              <template v-else>
                <p>
                  {{ $t('reputationsCharacterFinished', { finished: formatNumber(data.finished) }) }}
                </p>

                <p class="mt-1.5 text-gray-400">{{ $t('reputationsCharacterFinishedNote') }}</p>
              </template>

              <p class="mt-1.5">
                {{
                  $t('reputationsInProgress', {
                    progress: formatNumber(data.inProgress ?? 0),
                    renown: formatNumber(data.inProgressRenown ?? 0)
                  })
                }}
              </p>
            </div>
          </div>
        </div>

        <!-- The search box, the switch and the note: the switch is the same track-with-a-knob the
             collections carry, and the note is a button carrying an arrow, because what it opens lands
             under it. -->
        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <label
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-3 pr-3 text-xs text-gray-300 transition-colors focus-within:border-white/25 hover:border-white/25 hover:bg-white/[0.08]"
          >
            <span class="sr-only">{{ $t('reputationsSearch') }}</span>
            <input
              v-model="search"
              type="search"
              :placeholder="$t('reputationsSearchPlaceholder')"
              class="w-40 bg-transparent text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none sm:w-52"
            />
          </label>

          <!-- Whose journal this is, where the site holds the account's own pool of finished factions at all
               (`ReputationJournal.accountAvailable`): the same pair of chips a collection shelf carries, in the
               same words (`ScopeSwitch.vue`), because it is the same question - and the lines under the heading
               say what the account's reading adds to the character's own numbers. -->
          <ScopeSwitch v-if="data.accountAvailable" v-model="view.byAccount" :label="$t('reputationsViewScope')" />

          <button
            type="button"
            role="switch"
            :aria-checked="hideUnstarted"
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2 pr-3 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
            @click="hideUnstarted = !hideUnstarted"
          >
            <span
              class="relative h-4 w-7 shrink-0 rounded-full border border-transparent shadow-[0_0_0_1px_var(--hoa-ring)] transition-colors duration-200"
              :class="hideUnstarted ? '[--hoa-ring:rgba(248,183,0,0.6)] bg-wow-gold/25' : '[--hoa-ring:rgba(255,255,255,0.15)] bg-black/50'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-200"
                :class="
                  hideUnstarted
                    ? 'translate-x-3 bg-wow-goldLight shadow-[0_0_6px_rgba(248,183,0,0.55)]'
                    : 'translate-x-0 bg-gray-500'
                "
              />
            </span>
            {{ $t('reputationsHideUnstarted') }}
          </button>

          <!-- The other half of the pair: the factions that are done, which is what a journal that is
               mostly finished is read past rather than through. -->
          <button
            type="button"
            role="switch"
            :aria-checked="hideFinished"
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2 pr-3 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
            @click="hideFinished = !hideFinished"
          >
            <span
              class="relative h-4 w-7 shrink-0 rounded-full border border-transparent shadow-[0_0_0_1px_var(--hoa-ring)] transition-colors duration-200"
              :class="hideFinished ? '[--hoa-ring:rgba(248,183,0,0.6)] bg-wow-gold/25' : '[--hoa-ring:rgba(255,255,255,0.15)] bg-black/50'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-200"
                :class="
                  hideFinished
                    ? 'translate-x-3 bg-wow-goldLight shadow-[0_0_6px_rgba(248,183,0,0.55)]'
                    : 'translate-x-0 bg-gray-500'
                "
              />
            </span>
            {{ $t('reputationsHideFinished') }}
          </button>

          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-100"
            aria-controls="reputations-legend"
            :aria-expanded="legendOpen"
            @click="legendOpen = !legendOpen"
          >
            {{ $t('reputationsLegendTitle') }}
            <svg
              class="h-3.5 w-3.5 transition-transform duration-200"
              :class="{ 'rotate-180': legendOpen }"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>

        <!-- The note itself: one small card per reason, side by side on a wide screen so the journal is
             not pushed down by a paragraph, stacked on a phone where three columns would be unreadable. -->
        <div
          v-if="legendOpen"
          id="reputations-legend"
          class="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-3"
        >
          <div v-for="point in LEGEND" :key="point.title" class="rounded-xl border border-white/5 bg-black/25 p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-wow-goldLight">
              {{ $t(point.title) }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ $t(point.text) }}</p>
          </div>
        </div>
      </section>

      <!-- The shelf itself and the rail beside it, laid out exactly as a collections shelf is: one grid
           whose first column is the pinned rail and whose second is the journal. The columns are named by
           whether the rail is drawn at all, because a grid that keeps its first column while nothing is in
           it would draw the journal in the width of a rail. -->
      <div
        class="lg:grid lg:items-start lg:gap-x-6 lg:gap-y-5 lg:space-y-0"
        :class="anchored ? 'space-y-5 lg:grid-cols-[13rem_minmax(0,1fr)]' : 'space-y-5 lg:grid-cols-[minmax(0,1fr)]'"
        :style="{ '--hoa-anchor-offset': `${anchorOffset}px`, '--hoa-sticky-top': `${stickyTop}px` }"
      >
        <!-- The quick anchors: a chip for every group of the journal, so a journal of fifteen expansions
             can be walked without hunting for one. The group being read is lit, and a chip scrolls the
             page to its group. A phone has no room for the panel beside the shelf and is given none. -->
        <div
          v-if="anchored"
          class="hoa-anchors sticky z-30 hidden lg:flex lg:max-h-[calc(100vh-var(--hoa-sticky-top)-2rem)] lg:w-52 lg:shrink-0"
          :style="{ top: `${stickyTop}px` }"
        >
          <nav
            ref="railEl"
            class="flex min-h-0 w-full flex-col gap-1 overflow-x-hidden overflow-y-auto p-2"
            :aria-label="$t('reputationsOverall')"
          >
            <button
              v-for="(entry, index) in groups"
              :key="entry.group.id"
              :ref="(element) => setChip(index, element as Element | null)"
              type="button"
              class="hoa-tab hoa-liquid-glass shrink-0 whitespace-nowrap px-3 py-1.5 text-xs lg:w-full lg:justify-start lg:whitespace-normal lg:text-left"
              :class="{ 'hoa-tab-active': index === activeGroup }"
              :aria-current="index === activeGroup ? 'true' : undefined"
              @click="jumpTo(index)"
            >
              {{ labelOf(entry.group) }}
            </button>
          </nav>
        </div>

        <!-- The journal: the column of panels the rail walks. -->
        <div class="min-w-0 flex-1 space-y-5">
          <section
            v-for="(entry, index) in groups"
            :key="entry.group.id"
            :ref="(element) => setGroup(index, element as Element | null)"
            :data-group="index"
            class="hoa-panel hoa-section"
          >
            <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
                {{ labelOf(entry.group) }}
              </h3>
              <span class="hoa-tag whitespace-nowrap text-gray-300">
                <span class="tabular-nums text-wow-goldLight">{{ formatNumber(entry.group.finished) }}</span>
                <span class="tabular-nums">/{{ formatNumber(entry.group.total) }}</span>
                <span class="text-gray-500">({{ formatNumber(entry.group.percent) }}%)</span>
              </span>
            </div>

            <!-- How much of the expansion is finished, drawn as a collections shelf draws a group's own
                 bar: the same emerald fill under a heading, so the two read alike - the gold above is the
                 journal's own total rather than a group's. -->
            <div class="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
              <div
                class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
                :style="{ width: `${entry.group.percent}%` }"
              />
            </div>

            <!-- The subcategories of the expansion, laid out as a collection's sources are: a run of
                 blocks side by side, each with its name on a tag over its own rows. -->
            <div v-if="revealed.has(index)" class="hoa-subgroups-container mt-4">
              <div
                v-for="section in entry.sections"
                :key="section.id || 'direct'"
                class="hoa-subgroup w-full"
              >
                <h4 v-if="section.label" class="hoa-subgroup-title">
                  <span class="hoa-tag">{{ section.label }}</span>
                </h4>
                <!-- One row to a line, and each row is the measure itself: a block as tall as a line of text
                     with the name set into its left, the stage into its right and the fill behind both. Hovering
                     it names the stage the character stands at, from the ledger the journal ships with it. -->
                <div class="flex w-full flex-col gap-y-1">
                  <ReputationRow
                    v-for="row in section.rows"
                    :key="row.id"
                    :row="row"
                    :steps="data.ledgers[row.ladder] || []"
                  />
                </div>
              </div>
            </div>

            <!-- Not built yet: its place is held so the groups below it do not shift as it opens. -->
            <div v-else class="mt-4" :style="{ minHeight: placeholderHeight(entry) }" aria-hidden="true" />
          </section>

          <p v-if="!shown" class="mx-auto max-w-3xl py-12 text-center text-sm text-gray-400">
            {{ $t('reputationsEmpty') }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
