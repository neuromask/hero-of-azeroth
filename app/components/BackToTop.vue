<script setup lang="ts">
/**
 * The button that takes a reader back to the top of a long page.
 *
 * The hall of fame is a page a reader scrolls: the table runs past the window, and the way back to
 * the filters, the widgets and the search is a long drag or a keystroke they may not know. The
 * button appears once the page has actually been scrolled - it is not a permanent piece of furniture
 * - and it is the same glass the rest of the site's controls are cut from (`main.css`).
 *
 * It stands at the bottom left on purpose: the support button already holds the bottom right
 * (`SupportButton.vue`), and two floating plates in one corner would sit on top of each other.
 *
 * The scroll is watched from `onMounted`, because the server has no window and the button has no
 * business being drawn in the first response at all; `passive` keeps the listener off the scrolling
 * path, which is what keeps it from making the page feel heavy.
 */
/** How far down the page a reader has to be before the button appears. */
const VISIBLE_AFTER = 600

const { t } = useI18n()
const visible = ref(false)

function onScroll(): void {
  visible.value = window.scrollY > VISIBLE_AFTER
}

/** Back to the top, smoothly - which is what the browser's own reduced-motion setting still honours. */
function toTop(): void {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <button
    type="button"
    class="hoa-liquid-glass fixed bottom-4 left-4 z-40 grid h-11 w-11 place-items-center rounded-full border text-wow-goldLight transition-all duration-300 sm:bottom-5 sm:left-5"
    :class="visible ? 'opacity-100' : 'pointer-events-none opacity-0'"
    :aria-hidden="visible ? undefined : 'true'"
    :tabindex="visible ? undefined : -1"
    :title="t('lbBackToTop')"
    :aria-label="t('lbBackToTop')"
    @click="toTop()"
  >
    <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fill-rule="evenodd"
        d="M10 3.5a.75.75 0 0 1 .53.22l5 5a.75.75 0 1 1-1.06 1.06L10.75 6.06V16a.75.75 0 0 1-1.5 0V6.06L5.53 9.78A.75.75 0 0 1 4.47 8.72l5-5A.75.75 0 0 1 10 3.5Z"
        clip-rule="evenodd"
      />
    </svg>
  </button>
</template>
