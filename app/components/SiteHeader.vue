<script setup lang="ts">
/**
 * The site's own header: the brand, what the page is, and the site's navigation under it.
 *
 * It is the frame a character page wears, drawn for a page that is not about a character. Where the
 * character shell prints the character's name, its title and the row of facts under it, this prints
 * the page's name and one line about the page - and where the shell offers Refresh and Download on
 * the right, this leaves that side to whatever the page hands it through the `actions` slot.
 *
 * The reader's own corner is this header's, not a page's: the language and the account are drawn by
 * `app/components/HeaderTools.vue` after the slot, on the far side of a hairline, so the pair stands in the
 * same place on every page of the site and no page can hand over a second copy of either. A page's own
 * actions are what the slot is for, and the hairline is drawn only when there are some.
 *
 * The row underneath is the site's navigation, and it is one component (`app/components/SiteNav.vue`) for
 * every page of the site - this header included: a page that draws a row of its own (the hall of fame hands
 * over the character's views beside the site's own) writes it into the slot, and a page that has no row of its
 * own is given the same component, which is what every page ends up wearing. Nothing about that row is this
 * header's - not the search, which is the way to the next character, and not the panel a phone opens the
 * entries in - so a page can no more carry the row twice than it can wear two bars: it is the same row a
 * character page wears, so stepping between the pages keeps the bar, the entries and the language exactly
 * where they are. The fade under the bar belongs here rather than to the row, because it is the bar that is
 * pinned and the fade that lets the page dissolve under it.
 *
 * The bar is pinned to the top of the window (`sticky`), above the page (`z-40`), and its panel
 * keeps only its bottom corners rounded because it stands flush against the top edge - all of it
 * copied from the character shell on purpose, so the two headers are the same object to the eye.
 * It wears `hoa-bar`, which marks the bar as a context of its own: the panel and the tabs are the
 * surfaces Chromium can leave showing a stale, unblurred strip of the page behind them once the bar is
 * pinned, and the bar's own isolation is what keeps a repaint of the page below from being measured as
 * a change of the bar (`app/assets/css/main.css`).
 */
defineProps<{
  /** The page's name, printed where a character page prints the character's. */
  title: string
  /** One line under it: the facts the page is about, in the page's own language. */
  meta?: string
}>()

const localeUrl = useLocaleUrl()
</script>

<template>
  <header class="hoa-bar sticky top-0 z-40 container mx-auto px-4">
    <!-- The bar's own frost is drawn by a layer of it (`hoa-panel-layered`), because the reader's own group of
         glass stands in the bar - its plate, and the two dropdowns that hang out of it and down over the
         page - and every way to the character's own pages is a control of that same glass. A `backdrop-filter`
         on the bar would make the bar the backdrop of those controls, and a control can only read the block it
         stands in as a washed copy of it, which is what made them read lighter than the page they were over.
         With the frost on a layer the bar is a plain box and the plate's own buttons and panes keep the page as
         their backdrop, exactly as the tabs of the row below do. Nothing else about the bar moves: its tint,
         its hairline and its drop are still its own. -->
    <div
      class="hoa-panel hoa-panel-layered hoa-panel-flush relative z-30 flex flex-col items-start justify-between gap-4 rounded-t-none border-t-0 px-4 py-1.5 sm:px-6 sm:py-3.5 lg:flex-row lg:items-center"
    >
      <div class="flex items-center gap-4 sm:gap-6">
        <!-- The brand mark is the artwork itself (`app/assets/icons/hoa-emblem.svg`): a gold plate
             with the emblem cut from it, so it keeps its own frame and stays sharp at any size. -->
        <NuxtLink
          :to="localeUrl('/')"
          aria-label="HeroOfAzeroth"
          class="block h-20 w-20 shrink-0 transition-transform hover:scale-105"
        >
          <AppIcon name="hoa-emblem" class="h-full w-full" />
        </NuxtLink>

        <div class="min-w-0">
          <h1 class="text-2xl font-extrabold tracking-wide text-white drop-shadow sm:text-4xl">
            {{ title }}
          </h1>
          <p v-if="meta" class="text-base text-gray-400 sm:text-lg">{{ meta }}</p>
        </div>
      </div>

      <!-- Whatever the page puts on the right, and the reader's own corner beside it: the language and the
           account are drawn by `app/components/HeaderTools.vue` on every page of the site, so a page hands over
           its own actions alone and never the corner. The hairline stands between the two and is drawn only
           when there is something to hold apart - a page that offers no action of its own ends in the corner,
           as a document does and as the hall of fame does. -->
      <div class="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
        <slot name="actions" />

        <span v-if="$slots.actions" class="hidden h-6 w-px shrink-0 bg-white/10 lg:block" aria-hidden="true" />

        <HeaderTools />
      </div>
    </div>

    <nav class="relative pt-3" :aria-label="title">
      <!-- The fade the row sits on, so the page below dissolves into the bar rather than
           poking at its edge. It is kept under everything and light enough to dim rather than
           black out. -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-0 h-12 bg-gradient-to-b from-wow-dark/90 via-wow-dark/55 to-transparent"
        aria-hidden="true"
      />

      <div class="relative flex flex-wrap items-center gap-2">
        <!-- The page's own row. It is the whole site's navigation, drawn by one component for every page of
             the site (`app/components/SiteNav.vue`): the character's six views when the page is about a
             character, the site's own two entries, the search, the language pair and the account. A page that
             draws a row of its own hands it over through the slot; a page that has none - the account page, a
             document - is given the site's, which is what every page ends up wearing. The corner is that
             component's, never this header's: only one thing draws the languages and the account, so no page
             can carry them twice. -->
        <slot>
          <SiteNav :label="title" />
        </slot>
      </div>
    </nav>
  </header>
</template>
