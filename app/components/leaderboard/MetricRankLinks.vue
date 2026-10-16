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
 *
 * Those links are chips of equal width in one row (`MetricRankLink.vue`), and the row is a grid of exactly as
 * many columns as there are places: a scope nobody holds a place in is left out, and what the reader is left
 * with is a line that never wraps onto a second one - which is what a row of labelled figures does the moment
 * the column it stands in is narrow, and what it used to do in the accordion of a comparison board.
 */
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
     * How the block is laid out: a block under a row of a comparison board, or the middle column of a plate.
     *
     * The links are the same three either way - the scopes and the places - and only their clothes differ: in a
     * column of the comparison board the block leads a line and stands against the left edge, while in the centre
     * of the plate it is the thing a reader looks for, so its heading and its row are centred.
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

/**
 * How many columns the row of chips has, which is how many places the answer carried.
 *
 * One class per count rather than a computed `grid-template-columns`, because each of these is a rule Tailwind
 * can see written in this file: a class built by interpolation is a class no build can find, and the row would
 * quietly fall back to a single column.
 */
const columns = computed(() => {
  if (links.value.length >= 3) return 'grid-cols-3'
  return links.value.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
})

/** Whether the block is the middle column of a plate, which is the centred of the two shapes. */
const plate = computed(() => props.variant === 'plate')
</script>

<template>
  <div class="flex flex-col gap-2" :class="plate ? 'items-center text-center' : ''">
    <!-- The heading of the block, over the row rather than beside it: the three places are one reading at three
         scopes, and a reader who has just opened a row is told what the row of figures under it is. -->
    <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">{{ t('lbMetricRanks') }}</p>

    <!-- The answer is on its way: a place is worth waiting a moment for, and the block says so rather than
         showing a dash that would read as "no place". -->
    <p v-if="pending && !rank" class="animate-pulse text-xs text-gray-500">{{ t('lbMetricRanksLoading') }}</p>

    <p v-else-if="failed" class="text-xs text-red-400">{{ t('lbMetricRanksError') }}</p>

    <!-- Not in the ranking at all, or in it with no figure read: two different facts, and the block names the one
         it is. The history and the distribution chart stay above and below this line - nothing about them moves. -->
    <p v-else-if="rank && !rank.participating" class="text-xs text-gray-400">{{ t('lbMetricNotRanked') }}</p>

    <p v-else-if="rank && rank.value === null" class="text-xs text-gray-400">{{ t('lbMetricNoFigure') }}</p>

    <!-- The places, one chip each, in a row of equal columns: the three scopes are read against each other at a
         glance, and a scope nobody holds a place in leaves the row narrower rather than leaving a hole in it. -->
    <div v-else-if="links.length" class="grid w-full gap-2" :class="columns">
      <MetricRankLink
        v-for="link in links"
        :key="link.key"
        :label="link.label"
        :metric="label"
        :rank="link.rank"
        :total="link.total"
        :to="link.to"
        :query="link.query"
      />
    </div>
  </div>
</template>
