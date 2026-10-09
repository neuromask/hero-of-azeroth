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
 * small thing standing on the page for a moment, and it is drawn as the panes of the site are rather
 * than as an element of one. The glass itself is a layer of the card, not a filter on it
 * (`hoa-liquid-glass-layered`): the card stands on the scrim below, which is a surface of its own laid
 * over the page, and a `backdrop-filter` on the card would make the card the backdrop of everything
 * inside it - the site's own glass is worn this way everywhere a pane or a control may follow, and the
 * wait is no exception. The scrim under it keeps a plain tint of the page's own dark (`bg-wow-dark/75`)
 * with no frost of its own: a `backdrop-filter` there would make the scrim the *backdrop* of the card,
 * and the card's frost could then only sample the scrim - the same double blur that leaves a control
 * inside a frosted block reading washed. The card takes no pointer at all, so every click of the wait
 * lands on the scrim, nothing behind the pane is reached through it, and the glass never lights up
 * under a hand that is only passing over the screen (the material's `hover:`).
 *
 * The site's own name stands at the foot of the card, under the line the wheel reads by - the wordmark
 * the footer and the front page are led by (`hoa-logotype`), drawn quietly a size under the heading of
 * a pane. It is the one thing a reader who has just clicked a row wants to be told while nothing has
 * arrived yet: whose page they are still on, and that it has not failed to load. The mark that leads
 * the header is deliberately not the one here - the emblem reads as a place in the bar where a reader
 * returns to, and the wordmark is the site *named*, which is what a wait has to say. It is content, not
 * decoration, so it is given its `alt` (`AppIcon` announces it rather than hiding it), and it is left
 * still while the ring turns, because the only motion in the pane is the wheel's.
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
    <!-- The card is the site's own glass with the site's own name on it (see above), and it is
         `pointer-events-none` on purpose: the scrim is what a stray click reaches, which is what keeps
         a second navigation from starting behind the pane, and the material's `hover:` never fires on a
         surface nobody can point at. `relative` with a `z-index` is what holds the layer the glass is
         drawn by under the card's content (`hoa-liquid-glass-layered`). The wordmark is the last thing
         in it - the foot of the card, under the line the wheel is read by. -->
    <div
      v-if="shown"
      class="hoa-liquid-glass hoa-liquid-glass-layered relative z-0 flex flex-col items-center gap-5 rounded-2xl border-wow-gold/25 px-8 py-7 pointer-events-none"
    >
      <LoadingWheel :label="$t('loading')" />
      <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-6 w-auto" />
    </div>
  </div>
</template>
