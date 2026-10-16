<script setup lang="ts">
/**
 * One region's ranking of one metric: `/leaderboards/mounts/eu`.
 *
 * Two things are checked here rather than drawn, and both are facts about the address: the figure, against the
 * site's own whitelist, and the region, against the regions the site serves. A realm is *not* checked in this
 * route - there is none in it. The Russian copy of it is this page under `/ru` (`alias`).
 */
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'

definePageMeta({ key: (route) => route.fullPath, alias: '/ru/leaderboards/:metric/:region' })

const route = useRoute()

const metric = metricLeaderboardOf(String(route.params.metric || '').toLowerCase())
if (!metric) throw createError({ statusCode: 404, statusMessage: 'Unknown leaderboard metric' })

// The region in the address: `eu`, and the spelling a character page's own address uses (`region-eu`) is read
// the same way, so a copied link still lands on the scope it names.
const region = regionFromPath(String(route.params.region || ''))
if (!region) throw createError({ statusCode: 404, statusMessage: 'Unknown region' })
</script>

<template>
  <MetricLeaderboard :metric="metric!" :region="region" />
</template>
