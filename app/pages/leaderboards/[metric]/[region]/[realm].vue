<script setup lang="ts">
/**
 * One realm's ranking of one metric, inside its region: `/leaderboards/mounts/eu/gordunni`.
 *
 * The realm is the realm *of that region*, which is why the two are read together and why an address without a
 * region never reaches this route: `gordunni` in EU and a realm of the same slug in US are two different realms,
 * and a slug alone names neither (`MetricLeaderboardScope` in `#shared/data/leaderboardSchema`).
 *
 * Whether the realm exists is deliberately not decided here. The realm list is Blizzard's and the site reads it
 * for the names it prints in any case, so the page asks it once it has it and says plainly that the address names
 * a realm the game does not have - rather than refusing the page because a list that could not be read said
 * nothing (`app/components/leaderboard/MetricLeaderboard.vue`). The Russian copy of it is this page under `/ru`
 * (`alias`).
 */
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'

definePageMeta({ key: (route) => route.fullPath, alias: '/ru/leaderboards/:metric/:region/:realm' })

const route = useRoute()

const metric = metricLeaderboardOf(String(route.params.metric || '').toLowerCase())
if (!metric) throw createError({ statusCode: 404, statusMessage: 'Unknown leaderboard metric' })

const region = regionFromPath(String(route.params.region || ''))
if (!region) throw createError({ statusCode: 404, statusMessage: 'Unknown region' })

/** The realm's slug, lowercased the way a record and an address keep it. */
const realm = String(route.params.realm || '').trim().toLowerCase()
if (!realm) throw createError({ statusCode: 404, statusMessage: 'Unknown realm' })
</script>

<template>
  <MetricLeaderboard :metric="metric!" :region="region" :realm="realm" />
</template>
