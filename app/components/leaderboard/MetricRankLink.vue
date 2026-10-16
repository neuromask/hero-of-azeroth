<script setup lang="ts">
/**
 * One scope of a character's place: the world, their region, or their realm - and nothing else.
 *
 * A component of its own because it is one *thing* drawn in more than one place: the block of three under an open
 * row of the comparison board (`MetricRankLinks.vue`) and the middle column of the plate every ranking wears are
 * the same chip, and a scope added to the site (a battlegroup, a shard) is added here once.
 *
 * It is a link, because a place is only worth reading if a reader can go and look at it: the chip opens the very
 * ranking it names, already turned to this character's row (`useMetricLeaderboardView` reads `rank`). The place a
 * reader is *shown* and the place the link carries are the same number by construction - one is printed from the
 * other - so a chip can never point somewhere other than where it says.
 *
 * The layout is the whole of the design: the scope stands over its place rather than beside it, which is what
 * makes three chips read as one row of figures instead of three sentences, and the place is set at the size a
 * figure is set at elsewhere on the site. It used to be a word and a number in brackets, and a number in
 * brackets is a number apologising for itself.
 */
import { formatNumber } from '#shared/utils/formatNumber'

const props = defineProps<{
  /** The message key naming the scope: `lbWorld`, `lbRegion` or `lbRealm`. */
  label: string
  /** The figure the ranking is of, which leads the label a reader who cannot see the block is given. */
  metric: string
  /** The place itself, one-based. */
  rank: number
  /** The population it was won among, which the tooltip reads - the chip itself is a number alone. */
  total: number
  /** The ranking page the chip leads to, in the language being read. */
  to: string
  /** The query that turns that page to this character's row. */
  query: Record<string, string>
}>()

const { t } = useI18n()

/**
 * What the chip says on hover and to a screen reader: the figure, the scope, and the place among how many.
 *
 * It is the sentence the chip is too small to print, and it is built from the same two numbers the chip draws -
 * so the full answer and the short one can never disagree.
 */
const title = computed(() =>
  `${props.metric} · ${t(props.label)} · ${t('lbMetricRankOf', {
    rank: formatNumber(props.rank),
    total: formatNumber(props.total)
  })}`
)
</script>

<template>
  <NuxtLink
    :to="{ path: to, query }"
    class="group flex min-w-0 flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2.5 text-center transition-colors duration-200 hover:border-wow-gold/50 hover:bg-wow-gold/10 focus-visible:border-wow-gold/60 focus-visible:bg-wow-gold/10 focus-visible:outline-none"
    :title="title"
    :aria-label="title"
  >
    <span
      class="w-full truncate text-[10px] font-bold uppercase tracking-wider text-gray-500 transition-colors group-hover:text-gray-300"
    >
      {{ t(label) }}
    </span>

    <!-- The place, at the size the site sets a figure at, with the breath of glow the winner of a comparison row
         wears - it is the one number in the chip and it is the one thing a reader came here for. -->
    <span class="text-lg font-extrabold leading-none tabular-nums text-wow-goldLight [text-shadow:0_0_14px_rgba(248,183,0,0.35)]">
      {{ formatNumber(rank) }}
    </span>
  </NuxtLink>
</template>
