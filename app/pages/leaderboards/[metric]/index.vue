<script setup lang="ts">
/**
 * The world ranking of one metric: `/leaderboards/mounts`.
 *
 * The address names the figure and nothing else, so this route's whole job is to say whether that figure is one
 * the site ranks and to hand it to the page. A slug the whitelist does not hold is a 404 - the address names a
 * page that does not exist, and answering it with an empty table would be the site inventing a ranking.
 *
 * The page is keyed by its own address (`definePageMeta`), which is what makes stepping from one ranking to
 * another (`/leaderboards/mounts` to `/leaderboards/pets`) rebuild this component rather than reuse it: the
 * figure is read once, when the page is set up, and a reused instance would keep drawing the one it was built
 * with.
 *
 * The Russian copy is the same page under `/ru` (`alias`), which is how every other address of this site is
 * served in the other language: the i18n module keeps `no_prefix` and the middleware reads the language off
 * whichever of the two addresses was asked for (`app/middleware/lang.global.ts`).
 */
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'

definePageMeta({ key: (route) => route.fullPath, alias: '/ru/leaderboards/:metric' })

const route = useRoute()

const metric = metricLeaderboardOf(String(route.params.metric || '').toLowerCase())
if (!metric) throw createError({ statusCode: 404, statusMessage: 'Unknown leaderboard metric' })
</script>

<template>
  <MetricLeaderboard :metric="metric!" />
</template>
