<script setup lang="ts">
/**
 * The wait every page of the site is read through: one wheel on one pane of glass, over the page
 * that is on its way out.
 *
 * It is drawn here, once, and no view draws a wheel of its own any more - a wait is a fact about the
 * site rather than about the block that happened to ask for the data (see `usePageLoading`), and the
 * reader who clicks a tab on the character page and the reader who clicks a row in the hall of fame
 * are asking the same thing: is anything happening?
 *
 * When it is *not* drawn is the other half of the design, and it is the half that keeps the site
 * feeling immediate. A wait that ends inside `SHOW_AFTER_MS` is never drawn at all: an answer that
 * arrives in a tenth of a second is not a wait, and a pane that flashes for one frame reads as a
 * glitch rather than as news. A wait that *is* drawn stays for `KEEP_MS` however quickly it ends,
 * because a wheel that appears and vanishes within two frames is a flicker - the reader is told
 * something happened, but not what. Both are deliberately short: the site's pages are kept on the
 * server (see `server/utils/swrCache.ts`), so the ordinary navigation is faster than the first of
 * these numbers and is never interrupted by a wheel at all, while a cold read - a character
 * Blizzard has not been asked for in two hours - gets one that stays as long as the read does.
 *
 * The pane is not skip-able by a click, and that is the point of it: while the site is between two
 * pages, a second click on a tab or a row would start a second navigation, and the reader would
 * arrive somewhere they did not ask for.
 *
 * It is the site's liquid glass in the cut a control wears (`.hoa-liquid-glass`, the material the tabs
 * and the buttons are made of) rather than the wider pane a menu hangs in (`.hoa-pop`): a wait is one
 * small thing standing on the page for a moment, and nothing is ever opened out of it, so it wears the
 * frost itself and needs none of the layering a pane that drops a pane is rearranged with (see
 * `hoa-pop-layered` in `main.css`). The scrim under it is deliberately left a plain tint of the page's
 * own dark (`bg-wow-dark/75`) with no frost of its own: a `backdrop-filter` there would make the scrim
 * the *backdrop* of the card, and the card's frost could then only sample the scrim - the same double
 * blur that leaves a control inside a frosted block reading washed. The card takes no pointer at all,
 * so every click of the wait lands on the scrim, nothing behind the pane is reached through it, and the
 * glass never lights up under a hand that is only passing over the screen (the material's `hover:`).
 *
 * The site's own mark stands above the wheel - the emblem the header is led by (`hoa-emblem`), not the
 * wordmark, which belongs to the card a character is shared as. It is the one thing a reader who has
 * just clicked a row wants to be told while nothing has arrived yet: that they are still on this site
 * and not on a page that has failed to load. It is the artwork itself and is decoration here, so it is
 * drawn quietly (`AppIcon` hides it from a screen reader, which is the wheel's `label` to say), and it
 * is left still while the ring turns, because the only motion in the pane is the wheel's.
 */
const { waiting } = usePageLoading()

/** How long a wait must last before it is drawn, in milliseconds. */
const SHOW_AFTER_MS = 140

/** How long it stays drawn once it is, so that it is never a flicker, in milliseconds. */
const KEEP_MS = 260

const shown = ref(false)
let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
/** When the pane went up, which is what the shortest time it may stay is measured from. */
let shownAt = 0

watch(waiting, (busy) => {
  if (busy) {
    // A wait that arrived while the pane was on its way out keeps it up: the reader is still
    // waiting, and taking the pane down would only be to put it back a moment later.
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = undefined
    if (shown.value || showTimer) return
    showTimer = setTimeout(() => {
      showTimer = undefined
      shownAt = Date.now()
      shown.value = true
    }, SHOW_AFTER_MS)
    return
  }

  if (showTimer) clearTimeout(showTimer)
  showTimer = undefined
  if (!shown.value) return

  hideTimer = setTimeout(
    () => {
      hideTimer = undefined
      shown.value = false
    },
    Math.max(0, KEEP_MS - (Date.now() - shownAt))
  )
})

onBeforeUnmount(() => {
  if (showTimer) clearTimeout(showTimer)
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <!-- The pane is always on the page and only ever fades: one that is mounted on demand would be
       rendered for the first time by the very navigation it is meant to announce, and the wheel
       inside it is not drawn until it is actually up, so nothing spins behind a hidden cover. -->
  <div
    class="fixed inset-0 z-[70] grid place-items-center bg-wow-dark/75 px-6 opacity-0 transition-opacity duration-200"
    :class="shown ? 'opacity-100' : 'pointer-events-none'"
    :aria-hidden="!shown"
    data-hoa-preloader
  >
    <!-- The card is the site's own glass with the site's own mark on it (see above), and it is
         `pointer-events-none` on purpose: the scrim is what a stray click reaches, which is what keeps
         a second navigation from starting behind the pane, and the material's `hover:` never fires on a
         surface nobody can point at. -->
    <div
      v-if="shown"
      class="hoa-liquid-glass flex flex-col items-center gap-5 rounded-2xl border-wow-gold/25 px-8 py-7 pointer-events-none"
    >
      <AppIcon name="hoa-emblem" class="h-12 w-12" />
      <LoadingWheel :label="$t('loading')" />
    </div>
  </div>
</template>
