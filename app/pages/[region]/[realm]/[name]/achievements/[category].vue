<script setup lang="ts">
// The slug the address names, checked against the shelves the site serves before a shelf is read.
import { isAchievementCategory, type AchievementCategory } from '#shared/data/achievementsSchema'

const route = useRoute()
const param = String(route.params.category || '')

if (!isAchievementCategory(param)) {
  throw createError({ statusCode: 404, statusMessage: 'Unknown achievement category' })
}

const category: AchievementCategory = param
</script>

<template>
  <main class="relative z-20 container mx-auto flex-1 px-4 py-6">
    <AchievementShelf :category="category" />
  </main>
</template>
