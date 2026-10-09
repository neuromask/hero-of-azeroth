<script setup lang="ts">
/**
 * The wheel a page waits at.
 *
 * The block that is still being read, the shelf that is being switched, the view being navigated to:
 * to the reader these are one thing - the site is not ready - so they are drawn as one picture rather
 * than as four spellings of the same ring of utilities that can drift apart. It belongs to
 * `app/components/PagePreloader.vue`, which is the one place that decides *when* a wait is shown; a
 * view that wants the wheel up registers its wait rather than drawing one (see `usePageLoading`).
 *
 * Not every turning thing on the site is this wheel, and the ones that are not are not oversights: the
 * glyph the refresh button turns, the small dark ring inside the search button, a download that says
 * "Загрузка" in its own label - each of those is the state of a *control* the reader is holding, and
 * it stays with that control, on the surface the control is made of.
 *
 * `label` is the line under the wheel, given where the reader has leisure to read it (the site-wide
 * preloader) rather than where the wait is a flicker in the corner of the eye.
 */
defineProps<{
  /** The line under the wheel, or nothing when the wheel speaks for itself. */
  label?: string
}>()
</script>

<template>
  <!-- `role="status"` is what tells a screen reader the wait is a state of the page rather than a
       picture in it, and the label it announces is the same line the sighted reader gets. -->
  <span
    class="inline-flex flex-col items-center gap-3"
    role="status"
    :aria-label="label || $t('loading')"
  >
    <span
      class="h-12 w-12 animate-spin rounded-full border-4 border-wow-gold border-t-transparent"
      aria-hidden="true"
    ></span>
    <span v-if="label" class="text-sm font-medium text-gray-300">{{ label }}</span>
  </span>
</template>
