<script setup lang="ts">
/**
 * Where one character of a comparison stands in the ranking of the metric whose row is open: the world, their
 * region, and their realm.
 *
 * It is a block of three links rather than a number, because a place is only worth reading if a reader can go and
 * look at it: each label is a link into the very ranking it names
 * (`/leaderboards/mounts?rank=12002`, `/leaderboards/mounts/eu?rank=1102`, `/leaderboards/mounts/eu/gordunni?rank=46`),
 * and the ranking it opens is already turned to that character's row (`useMetricLeaderboardView` reads `rank`).
 *
 * The three numbers are not three answers to one question - they are one answer read at three scopes - so they
 * come from a single request (`server/api/leaderboard/metric-ranks`) and are computed independently per scope. A
 * label and the `rank` in its link are the same computed place by construction: both are printed from the one
 * number the answer carried, so a link can never point somewhere other than where it says.
 *
 * Three states are told apart rather than drawn as one dash, because they mean three different things: a
 * character who is *not in the ranking at all* (an alt that is neither its account's main nor a row of its own),
 * a member whose figure for this metric the site has never read, and a member holding a place. The first two
 * print a sentence instead of links - there is nothing to link to - and the last prints the links.
 */
import { formatNumber } from '#shared/utils/formatNumber'
import { metricLeaderboardPath, metricLeaderboardRankQuery } from '~/composables/metricLeaderboard'
import type { MetricLeaderboardRank, MetricLeaderboardSlug } from '#shared/data/leaderboardSchema'

const props = withDefaults(
  defineProps<{
    /** The ranking the open row is of, which is the address every link below is built from. */
    slug: MetricLeaderboardSlug
    /** The figure's own name, which the block is labelled by for a reader who cannot see the row above it. */
    label: string
    /** The character this block is about: the column's own side of the comparison. */
    region: string
    realm: string
    name: string
    /** Their places, or `undefined` while the answer is on its way and `null` when it carries none. */
    rank?: MetricLeaderboardRank | null
    pending?: boolean
    /** True when the read failed, which is said rather than drawn as an absence of places. */
    failed?: boolean
    /**
     * How the block is laid out: a line under a row of a comparison board, or the middle column of a plate.
     *
     * The links are the same three either way - the scopes and the places - and only their clothes differ: in a
     * column of the comparison board they are small and lead a line, while in the centre of the plate they are the
     * thing a reader looks for, so they are a little larger, centred, and their label stands over them rather than
     * beside them.
     */
    variant?: 'links' | 'plate'
  }>(),
  { variant: 'links' }
)

const { t } = useI18n()
const localeUrl = useLocaleUrl()

/**
 * The three scopes as links, each carrying the place it prints.
 *
 * A place is printed with the site's own thousands separators (`formatNumber`) while the `rank` in the link is
 * the plain whole number: the label is for a reader and the parameter is for the site, and a link that carried
 * `12 002` would name no place at all. A scope with no place - a member ranked in the world and not in a realm
 * they have just moved to - is left out rather than linked to a place that is not there.
 */
const links = computed(() => {
  const rank = props.rank
  if (!rank) return []

  const scopes = [
    { key: 'world', label: t('lbWorld'), rank: rank.worldRank, total: rank.worldTotal, to: metricLeaderboardPath(props.slug) },
    {
      key: 'region',
      label: t('lbRegion'),
      rank: rank.regionRank,
      total: rank.regionTotal,
      to: metricLeaderboardPath(props.slug, { region: props.region })
    },
    {
      key: 'realm',
      label: t('lbRealm'),
      rank: rank.realmRank,
      total: rank.realmTotal,
      to: metricLeaderboardPath(props.slug, { region: props.region, realm: props.realm })
    }
  ]

  return scopes
    .filter((scope) => typeof scope.rank === 'number')
    .map((scope) => ({
      key: scope.key,
      label: scope.label,
      rank: scope.rank as number,
      total: scope.total,
      to: localeUrl(scope.to),
      query: metricLeaderboardRankQuery(scope.rank as number)
    }))
})

/** The place, as a reader reads it: the grouped number and the population it was won among. */
function placeOf(rank: number, total: number): string {
  return t('lbMetricRankOf', { rank: formatNumber(rank), total: formatNumber(total) })
}

/** Whether the block is the middle column of a plate, which is the larger and centred of the two shapes. */
const plate = computed(() => props.variant === 'plate')
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-2 gap-y-1"
    :class="plate ? 'justify-center py-1 text-xs' : 'py-3 text-[12px]'"
  >
    <span class="font-semibold uppercase tracking-wider text-gray-500" :class="plate ? 'w-full text-center' : ''">
      {{ t('lbMetricRanks') }}
    </span>

    <!-- The answer is on its way: a place is worth waiting a moment for, and the block says so rather than
         showing a dash that would read as "no place". -->
    <span v-if="pending && !rank" class="animate-pulse text-gray-500">{{ t('lbMetricRanksLoading') }}</span>

    <span v-else-if="failed" class="text-red-400">{{ t('lbMetricRanksError') }}</span>

    <!-- Not in the ranking at all, or in it with no figure read: two different facts, and the block names the one
         it is. The history and the distribution chart stay above and below this line - nothing about them moves. -->
    <span v-else-if="rank && !rank.participating" class="text-gray-400">{{ t('lbMetricNotRanked') }}</span>

    <span v-else-if="rank && rank.value === null" class="text-gray-400">{{ t('lbMetricNoFigure') }}</span>

    <template v-else-if="links.length">
      <template v-for="(link, index) in links" :key="link.key">
        <span v-if="index" class="text-gray-600" aria-hidden="true">·</span>
        <NuxtLink
          :to="{ path: link.to, query: link.query }"
          class="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] font-semibold text-gray-300 transition-colors hover:border-wow-gold/60 hover:bg-wow-gold/10 hover:text-wow-goldLight focus-visible:border-wow-gold/60 focus-visible:bg-wow-gold/10 focus-visible:text-wow-goldLight focus-visible:outline-none"
          :class="plate ? 'px-2.5 py-1' : 'px-2 py-0.5'"
          :title="`${label} · ${link.label} · ${placeOf(link.rank, link.total)}`"
          :aria-label="`${label} · ${link.label} · ${placeOf(link.rank, link.total)}`"
        >
          <span>{{ link.label }}</span>
          <span class="tabular-nums text-wow-goldLight">[{{ formatNumber(link.rank) }}]</span>
        </NuxtLink>
      </template>
    </template>
  </div>
</template>
