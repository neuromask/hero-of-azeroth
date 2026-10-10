<script setup lang="ts">
// The character the page is about, and the collections subtree its cards hang from.
const route = useRoute()
const region = regionFromPath(String(route.params.region || ''))
const realm = String(route.params.realm || '')
const name = String(route.params.name || '')
const path = `/${regionPath(region)}/${realm}/${name}/collections`

// Every shelf's total, under one running total: the root the collections menu opens on.
const { data, pending, error, refresh } = await useCollectionSummary()
usePageLoading().follow('character:collections', pending)
</script>

<template>
  <main class="relative z-20 container mx-auto flex-1 px-4 py-6">
    <div v-if="pending" class="py-20" />

    <div v-else-if="error" class="mx-auto max-w-3xl py-16 text-center">
      <p class="mb-4 text-lg font-semibold text-red-400">{{ $t('collectionsError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="refresh()">
        {{ $t('collectionsRetry') }}
      </button>
    </div>

    <CollectionSummaryGrid v-else-if="data" :summary="data" :path="path" />
  </main>
</template>
