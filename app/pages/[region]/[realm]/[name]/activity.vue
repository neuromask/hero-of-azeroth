<script setup lang="ts">
// What the shell shares (see the composable): the feed it may already have read, and the way to
// read it when it has not.
import { useCharacterView } from '~/composables/characterView'

const { activity, activityPending, activityError, loadActivity } = useCharacterView()

// The wait for the feed is the site's rather than this view's: it is registered so the preloader keeps
// its wheel up until the timeline lands, and the view then draws only the room the feed will take. The
// switch into this view is over long before the read is - the shell was already on screen - so
// without this the reader would be looking at an empty list with nothing to say the click did anything.
const { track } = usePageLoading()

/**
 * The shell reads the feed when this address is opened directly - a deep link carries the
 * timeline in its first response, which is half the reason the feed has an address of its own -
 * but a switch from the other tab reuses the shell and does not come through that path, so the
 * view asks for the feed once, here. When the shell has already read it the call is a no-op.
 */
onMounted(() => {
  void track('character:activity', loadActivity())
})
</script>

<template>
  <!-- The three states a lazy view can be in - still reading, failed, or holding the feed - and a
       character with nothing recent to show. -->
  <main class="relative z-20 container mx-auto px-4 py-6 flex-1">
    <!-- The wait itself is the site-wide preloader's to draw (see `PagePreloader.vue`); what this
         view keeps is the room the timeline will take, so the page does not jump when it arrives. -->
    <div v-if="activityPending" class="py-20" />

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