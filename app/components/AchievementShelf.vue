<script setup lang="ts">
// The category the shelf draws, and the name it reads its heading under.
import { ACHIEVEMENT_LABEL_KEYS, type AchievementCategory } from '#shared/data/achievementsSchema'
// Counts are written by the site's one rule, as on the grids below this heading.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * One shelf of a character's achievements - a category, with its heading, its switch and its grid.
 *
 * It is the collections shelf with the collection's own pair of switches left off: an achievement the
 * game has retired is drawn only where the character has earned it (that is the server's ruling, not
 * a switch here), so the only thing a visitor chooses is whether the tiles they already hold are
 * shown - the `collected` switch, which is where a shelf opens.
 *
 * Which category is being read is the address the page was reached on, and the choice between them is
 * the menu on the character's own navigation above, so the page carries no second navigation bar of
 * its own.
 */
const props = defineProps<{ category: AchievementCategory }>()

const view = useAchievementView()
const legendOpen = ref(false)

/** The two things the note says about the numbers, in the order it says them. */
const LEGEND = [
  { title: 'achievementsLegendAvailableTitle', text: 'achievementsLegendAvailableText' },
  { title: 'achievementsLegendLegacyTitle', text: 'achievementsLegendLegacyText' }
] as const

const { data, pending, error, refresh } = await useAchievementPage(() => props.category)

// A shelf read again for another category is not a navigation, so nothing but this would say the site
// is working; the wait is the preloader's to draw.
usePageLoading().follow('character:achievements', pending)
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div v-if="pending" class="py-20" />

    <div v-else-if="error" class="mx-auto max-w-3xl py-16 text-center">
      <p class="mb-4 text-lg font-semibold text-red-400">{{ $t('achievementsError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="refresh()">
        {{ $t('achievementsRetry') }}
      </button>
    </div>

    <template v-else-if="data">
      <div class="hoa-panel mb-6 p-4 sm:p-5">
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ $t(ACHIEVEMENT_LABEL_KEYS[props.category]) }}
          </h2>
          <span class="hoa-tag whitespace-nowrap text-gray-300">
            <span class="tabular-nums text-wow-goldLight">{{ formatNumber(data.collected) }}</span>
            <span class="tabular-nums">/{{ formatNumber(data.total) }}</span>
            <span class="text-gray-500">({{ formatNumber(data.percent) }}%)</span>
          </span>
        </div>

        <div class="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
          <div
            class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
            :style="{ width: `${data.percent}%` }"
          />
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            role="switch"
            :aria-checked="Boolean(view.collected)"
            class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-2 pr-3 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
            @click="view.collected = !view.collected"
          >
            <span
              class="relative h-4 w-7 shrink-0 rounded-full border border-transparent shadow-[0_0_0_1px_var(--hoa-ring)] transition-colors duration-200"
              :class="view.collected ? '[--hoa-ring:rgba(248,183,0,0.6)] bg-wow-gold/25' : '[--hoa-ring:rgba(255,255,255,0.15)] bg-black/50'"
            >
              <span
                class="absolute left-0.5 top-0.5 h-2.5 w-2.5 rounded-full transition-all duration-200"
                :class="
                  view.collected
                    ? 'translate-x-3 bg-wow-goldLight shadow-[0_0_6px_rgba(248,183,0,0.55)]'
                    : 'translate-x-0 bg-gray-500'
                "
              />
            </span>
            {{ $t('collectionsShowCollected') }}
          </button>

          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-white/25 hover:bg-white/[0.08] hover:text-gray-100"
            aria-controls="achievements-legend"
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

        <div
          v-if="legendOpen"
          id="achievements-legend"
          class="mt-3 grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2"
        >
          <div v-for="point in LEGEND" :key="point.title" class="rounded-xl border border-white/5 bg-black/25 p-3">
            <p class="text-xs font-semibold uppercase tracking-wider text-wow-goldLight">
              {{ $t(point.title) }}
            </p>
            <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ $t(point.text) }}</p>
          </div>
        </div>
      </div>

      <AchievementShelfGrid :page="data" />
    </template>
  </div>
</template>
