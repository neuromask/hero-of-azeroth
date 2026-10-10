<script setup lang="ts">
// The summary the grid draws, and the shape of a category row inside it.
import type { AchievementSummary } from '#shared/data/achievementsSchema'
import { ACHIEVEMENT_LABEL_KEYS } from '#shared/data/achievementsSchema'
// Counts are written by the site's one rule, so a card reads its figures the way every page prints them.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * The root achievements page: the character's whole log as one running total over a grid of category
 * tiles.
 *
 * Each tile is the same Liquid Glass block the rest of the site is cut from - a frosted pane with a
 * hairline rim and a lift under the pointer - standing as a link into that category's shelf. The
 * names come from the message keys rather than from a shelf, because the menu names the categories
 * before any shelf has been read, and a card reads the same name the menu does.
 */
const props = defineProps<{
  summary: AchievementSummary
  /** The achievements subtree of this character, which the cards hang from. */
  path: string
}>()

const localeUrl = useLocaleUrl()
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6">
    <!-- The running total: what the character has earned of everything it could, drawn as one bar
         over the whole log. -->
    <section class="hoa-panel p-4 sm:p-5">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
          {{ $t('achievementsOverall') }}
        </h2>
        <span class="hoa-tag whitespace-nowrap text-gray-300">
          <span class="tabular-nums text-wow-goldLight">{{ formatNumber(props.summary.collected) }}</span>
          <span class="tabular-nums">/{{ formatNumber(props.summary.total) }}</span>
          <span class="text-gray-500">({{ formatNumber(props.summary.percent) }}%)</span>
        </span>
      </div>

      <div class="h-2.5 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
        <div
          class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
          :style="{ width: `${props.summary.percent}%` }"
        />
      </div>
    </section>

    <!-- The categories, as tiles: one frosted block per category, its own count and its own bar,
         each a link into that category's shelf. -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <NuxtLink
        v-for="row in props.summary.categories"
        :key="row.category"
        :to="localeUrl(`${props.path}/${row.category}`)"
        class="hoa-panel hoa-panel-interactive group flex flex-col gap-3 p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-bold uppercase tracking-wider text-white sm:text-[15px]">
            {{ $t(ACHIEVEMENT_LABEL_KEYS[row.category]) }}
          </h3>
          <span class="hoa-tag shrink-0 whitespace-nowrap text-[11px] text-gray-300">
            {{ formatNumber(row.percent) }}%
          </span>
        </div>

        <div class="mt-auto">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="tabular-nums text-lg font-extrabold text-wow-goldLight">
              {{ formatNumber(row.collected) }}
            </span>
            <span class="tabular-nums text-xs text-gray-400">/ {{ formatNumber(row.total) }}</span>
          </div>

          <div class="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
            <div
              class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
              :style="{ width: `${row.percent}%` }"
            />
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
