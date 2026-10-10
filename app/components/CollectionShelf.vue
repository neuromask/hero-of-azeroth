<script setup lang="ts">
// The shelf the endpoint serves, and the shape the view names it with.
import type { CollectionKind } from '#shared/data/collectionsSchema'
// Counts are written by the site's one rule (`#shared/utils/formatNumber`), as on the shelves the
// grid below this heading draws.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * One shelf of a character's collections - mounts, pets or toys - with its heading, its switches and
 * its grid.
 *
 * The three shelves share this view because they are the same page with a different list behind it:
 * the heading, the running total and the grid are identical, and only the endpoint's `kind` changes.
 * Which shelf is being read is the address the page was reached on, and the choice between them is the
 * menu on the character's own navigation above, so the page carries no second navigation bar of its
 * own.
 *
 * The switches sit under the bar they change: the collected items first, which is where a shelf opens,
 * then SimpleArmory's own pair - the items the game has done away with and the ones it has not shipped
 * yet (see `useCollectionView`). Each is drawn as a switch with a knob rather than as a lit chip, so
 * whether it is on is read at a glance, and the note beside them folds out the three reasons this shelf
 * reads lower than the game's own counter - it is a button with an arrow, because the area it opens is
 * below it.
 */
const props = defineProps<{ kind: CollectionKind }>()

const view = useCollectionView()
const legendOpen = ref(false)

/**
 * The three switches, in the order they are drawn. The collected items come first because that is the
 * one a collector reaches for most: turning it off leaves the shelf as a list of what is still missing.
 */
const SWITCHES = [
  { key: 'collected', label: 'collectionsShowCollected' },
  { key: 'unobtainable', label: 'collectionsShowUnobtainable' },
  { key: 'upcoming', label: 'collectionsShowUpcoming' }
] as const

/** The three things the note says about the numbers, in the order it says them. */
const LEGEND = [
  { title: 'collectionsLegendAvailableTitle', text: 'collectionsLegendAvailableText' },
  { title: 'collectionsLegendLegacyTitle', text: 'collectionsLegendLegacyText' },
  { title: 'collectionsLegendGameTitle', text: 'collectionsLegendGameText' }
] as const

const { data, pending, error, refresh } = await useCollection(() => props.kind, view)

// A shelf is read again when its kind changes and when a switch is flipped, and neither of those is a
// navigation: the page stays where it stands, so nothing but this would say the site is working. The
// wait is the site-wide preloader's to draw, and the view keeps the room the shelf will take.
usePageLoading().follow('character:collections', pending)
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <!-- The wait itself is the site-wide preloader's to draw (see `PagePreloader.vue`); keeping the
         room of the grid here is what stops the page jumping while the shelf is read. -->
    <div v-if="pending" class="py-20" />

    <div v-else-if="error" class="mx-auto max-w-3xl py-16 text-center">
      <p class="mb-4 text-lg font-semibold text-red-400">{{ $t('collectionsError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="refresh()">
        {{ $t('collectionsRetry') }}
      </button>
    </div>

    <template v-else-if="data">
      <!-- The heading of the shelf: what is being read and how much of it the character holds. -->
      <div class="hoa-panel mb-6 p-4 sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-bold text-white sm:text-xl">{{ $t(props.kind) }}</h2>
          <span class="text-sm font-bold tabular-nums whitespace-nowrap text-wow-goldLight">
            {{ formatNumber(data.collected) }}/{{ formatNumber(data.total) }}
            <span class="text-gray-400">({{ formatNumber(data.percent) }}%)</span>
          </span>
        </div>
        <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full border border-white/10 bg-black/60 p-0.5">
          <div
            class="h-full rounded-full bg-gradient-to-r from-wow-gold to-amber-300 transition-[width] duration-700"
            :style="{ width: `${data.percent}%` }"
          />
        </div>

        <!-- The two switches and the note: a switch is a small track with a knob that slides across it
             and lights up in the brand gold, so on and off are told apart without reading a word - and
             the note is a button carrying an arrow, because what it opens lands under it. -->
        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            v-for="item in SWITCHES"
            :key="item.key"
            type="button"
            role="switch"
            :aria-checked="Boolean(view[item.key])"
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2 pr-3 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
            @click="view[item.key] = !view[item.key]"
          >
            <span
              class="relative h-4 w-7 shrink-0 rounded-full border transition-colors duration-200"
              :class="view[item.key] ? 'border-wow-gold/60 bg-wow-gold/25' : 'border-white/15 bg-black/50'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-200"
                :class="
                  view[item.key]
                    ? 'translate-x-3 bg-wow-goldLight shadow-[0_0_6px_rgba(248,183,0,0.55)]'
                    : 'translate-x-0 bg-gray-500'
                "
              />
            </span>
            {{ $t(item.label) }}
          </button>

          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-100"
            aria-controls="collections-legend"
            :aria-expanded="legendOpen"
            @click="legendOpen = !legendOpen"
          >
            {{ $t('collectionsLegendTitle') }}
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


        <!-- The note itself: one small card per reason, side by side on a wide screen so the shelf is
             not pushed down by a paragraph, stacked on a phone where three columns would be unreadable. -->
        <div
          v-if="legendOpen"
          id="collections-legend"
          class="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-3"
        >
          <div
            v-for="point in LEGEND"
            :key="point.title"
            class="rounded-xl border border-white/5 bg-black/25 p-3"
          >
            <p class="text-xs font-semibold uppercase tracking-wider text-wow-goldLight">
              {{ $t(point.title) }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ $t(point.text) }}</p>
          </div>
        </div>
      </div>

      <CollectionsGrid :page="data" />
    </template>
  </div>
</template>

