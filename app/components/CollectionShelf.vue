<script setup lang="ts">
// The shelf the endpoint serves, and the shape the view names it with.
import type { CollectionKind } from '#shared/data/collectionsSchema'

/**
 * One shelf of a character's collections - mounts, pets or toys - with its heading and its grid.
 *
 * The three shelves share this view because they are the same page with a different list behind it:
 * the heading, the running total and the grid are identical, and only the endpoint's `kind` changes.
 * Which shelf is being read is the address the page was reached on, and the choice between them is
 * the menu on the character's own navigation above, so the page carries no second navigation bar of
 * its own.
 */
const props = defineProps<{ kind: CollectionKind }>()

const { data, pending, error, refresh } = await useCollection(() => props.kind)
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <div v-if="pending" class="flex items-center justify-center py-20">
      <div class="h-12 w-12 animate-spin rounded-full border-4 border-wow-gold border-t-transparent" />
    </div>

    <div v-else-if="error" class="mx-auto max-w-3xl py-16 text-center">
      <p class="mb-4 text-lg font-semibold text-red-400">{{ $t('collectionsError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="refresh()">
        {{ $t('collectionsRetry') }}
      </button>
    </div>

    <template v-else-if="data">
      <!-- The heading of the shelf: what is being read and how much of it the character holds. -->
      <div class="hoa-panel mb-6 p-4 sm:p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="text-lg font-bold text-white sm:text-xl">{{ $t(props.kind) }}</h2>
          <span class="text-sm font-bold tabular-nums text-wow-goldLight">
            {{ data.collected }}/{{ data.total }}
            <span class="text-gray-400">({{ data.percent }}%)</span>
          </span>
        </div>
        <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full border border-white/10 bg-black/60 p-0.5">
          <div
            class="h-full rounded-full bg-gradient-to-r from-wow-gold to-amber-300 transition-[width] duration-700"
            :style="{ width: `${data.percent}%` }"
          />
        </div>
      </div>

      <CollectionsGrid :page="data" />
    </template>
  </div>
</template>
