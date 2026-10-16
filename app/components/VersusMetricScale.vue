<script setup lang="ts">
/**
 * How full one collection is, as a bar with its own arithmetic beside it.
 *
 * Drawn above the places and the charts of an open row of the comparison board, and it is the same reading the
 * character page's tiles draw (`app/pages/[region]/[realm]/[name]/index.vue`): a bar over what a character
 * holds of everything it could, the two figures it was worked out from (`1 234 / 5 925`), and the share those
 * two make, rounded by the site's one rule for it (`collectionPercent`).
 *
 * It is offered only where a maximum is *known* - the collections whose totals travel with the reading, and the
 * three figures an operator states a ceiling for (`#shared/data/siteSettings`) - and the board leaves it out
 * everywhere else. That is the whole reason this is a component rather than a few lines in the board: a bar is
 * a claim about an end, and a row whose end nobody knows is a row without a bar rather than a row measured
 * against a guess.
 *
 * The count wears the colour of the share it is (`wowQualityTextClass`, the ladder the tiles are read against),
 * so a near-complete collection reads as a near-complete one at a glance, while the bar itself keeps the brand
 * gold the site draws its own totals in.
 */
import { collectionPercent, wowQualityTextClass } from '#shared/utils/wow-quality'
import { formatNumber } from '#shared/utils/formatNumber'

const props = defineProps<{
  /** The message key naming the figure this bar is about, which is the row's own label. */
  metric: string
  /** What the character holds. */
  count: number
  /** What there is to hold - the denominator, which is never zero here (the board checks it). */
  total: number
  /** Whether the figure is the account's own, which the note under the bar says. */
  accountWide: boolean
}>()

/** The share, by the site's one rule: clamped at a hundred, so a figure past its maximum reads as full. */
const percent = computed(() => collectionPercent(props.count, props.total))
</script>

<template>
  <section
    class="rounded-xl border border-white/10 bg-black/25 p-3"
    role="group"
    :aria-label="`${$t(metric)} — ${$t('vsFillTitle')}`"
  >
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
      <h4 class="text-[11px] font-bold uppercase tracking-wider text-gray-300">{{ $t('vsFillTitle') }}</h4>

      <!-- The arithmetic, in the shape the site already prints a ratio in (`CollectionSummaryGrid.vue`): what is
           held, what could be, and the share - so a reader can check the bar's length against its own numbers. -->
      <span class="hoa-tag whitespace-nowrap text-[11px] text-gray-300">
        <span class="font-bold tabular-nums" :class="wowQualityTextClass(count, total)">{{ formatNumber(count) }}</span>
        <span class="tabular-nums text-gray-500">/ {{ formatNumber(total) }}</span>
        <span class="font-semibold tabular-nums" :class="wowQualityTextClass(count, total)">({{ percent }}%)</span>
      </span>
    </div>

    <div class="h-2.5 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
      <div
        class="h-full rounded-full bg-gradient-to-r from-wow-gold to-amber-300 transition-[width] duration-700"
        :style="{ width: `${percent}%` }"
      />
    </div>

    <!-- Whose figure the bar is, said the way the row above says it: the account's own in the brand gold, the
         character's own in grey. -->
    <p
      class="mt-2 text-[10px] font-semibold uppercase tracking-wider"
      :class="accountWide ? 'text-wow-goldLight/80' : 'text-gray-500'"
    >
      {{ accountWide ? $t('accountWide') : $t('perCharacter') }}
    </p>
  </section>
</template>
