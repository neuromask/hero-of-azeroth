<script setup lang="ts">
// What the shell shares (see the composable): the feed it may already have read, and the way to
// read it when it has not.
import { useCharacterView } from '~/composables/characterView'

const { activity, activityPending, activityError, loadActivity } = useCharacterView()

/**
 * The shell reads the feed when this address is opened directly - a deep link carries the
 * timeline in its first response, which is half the reason the feed has an address of its own -
 * but a switch from the other tab reuses the shell and does not come through that path, so the
 * view asks for the feed once, here. When the shell has already read it the call is a no-op.
 */
onMounted(() => {
  void loadActivity()
})
</script>

<template>
  <!-- The three states a lazy view can be in - still reading, failed, or holding the feed - and a
       character with nothing recent to show. -->
  <main class="relative z-20 container mx-auto px-4 py-6 flex-1">
    <div v-if="activityPending" class="flex items-center justify-center py-20">
      <div class="animate-spin rounded-full h-12 w-12 border-4 border-wow-gold border-t-transparent"></div>
    </div>

    <div v-else-if="activityError" class="mx-auto max-w-3xl text-center py-16">
      <p class="text-red-400 text-lg font-semibold mb-4">{{ $t('activityError') }}</p>
      <button type="button" class="hoa-tab hoa-tab-active" @click="loadActivity(true)">
        {{ $t('activityRetry') }}
      </button>
    </div>

    <ActivityFeed
      v-else-if="activity && activity.items.length"
      :items="activity.items"
      :total-points="activity.totalPoints"
    />

    <p v-else class="text-center text-gray-400 py-16">{{ $t('activityEmpty') }}</p>
  </main>
</template>