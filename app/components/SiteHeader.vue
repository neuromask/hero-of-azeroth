<script setup lang="ts">
/**
 * The site's own header: the brand, what the page is, and the row of links under it.
 *
 * It is the frame a character page wears, drawn for a page that is not about a character. Where the
 * character shell prints the character's name, its title and the row of facts under it, this prints
 * the page's name and one line about the page - and where the shell offers Refresh and Download on
 * the right, this leaves that side to whatever the page hands it through the `actions` slot.
 *
 * The row underneath is the page's own links and the language pair, in one flat row - the same row a
 * character page wears, so that stepping between the two pages keeps the bar, the tabs and the switch
 * exactly where they are. The fade under the bar belongs here rather than to the row, because it is
 * the bar that is pinned and the fade that lets the page dissolve under it.
 *
 * The bar is pinned to the top of the window (`sticky`), above the page (`z-40`), and its panel
 * keeps only its bottom corners rounded because it stands flush against the top edge - all of it
 * copied from the character shell on purpose, so the two headers are the same object to the eye.
 * It wears `hoa-bar`, which is what marks the glass inside it as pinned: the panel and the tabs are
 * the surfaces Chromium can leave showing a stale, unblurred strip of the page behind them, and the
 * hint a pinned surface needs is applied by `.hoa-bar` in `app/assets/css/main.css`.
 */
defineProps<{
  /** The page's name, printed where a character page prints the character's. */
  title: string
  /** One line under it: the facts the page is about, in the page's own language. */
  meta?: string
  /** The page's own links, when it has any. The site's own two are added by `SiteNav`. */
  links?: { label: string; to: string; active?: boolean }[]
}>()

const localeUrl = useLocaleUrl()
</script>

<template>
  <header class="hoa-bar sticky top-0 z-40 container mx-auto px-4">
    <!-- The bar's own frost is drawn by a layer of it (`hoa-panel-layered`), because the identity chip
         stands in the bar and the way to the profile in that chip is a button of the site's glass - and
         every way to the character's own pages is one. A `backdrop-filter` on the bar would make the bar
         the backdrop of those buttons, and a control can only read the block it stands in as a washed
         copy of it, which is what made them read lighter than the page they were over. With the frost on
         a layer the bar is a plain box and the chip's buttons keep the page as their backdrop, exactly
         as the tabs of the row below do. Nothing else about the bar moves: its tint, its hairline and
         its drop are still its own. -->
    <div
      class="hoa-panel hoa-panel-layered relative z-30 flex flex-col items-start justify-between gap-4 rounded-t-none border-t-0 px-4 py-1.5 shadow-none sm:px-6 sm:py-3.5 lg:flex-row lg:items-center"
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

      <!-- Whatever the page puts on the right: a character page puts its Refresh and Download
           there, a page that is not about a character usually puts nothing. -->
      <slot name="actions" />
    </div>

    <nav class="relative pt-3" :aria-label="title">
      <!-- The fade the row of links sits on, so the page below dissolves into the bar rather than
           poking at its edge. It is kept under everything and light enough to dim rather than
           black out. -->
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-0 h-12 bg-gradient-to-b from-wow-dark/90 via-wow-dark/55 to-transparent"
        aria-hidden="true"
      />

      <div class="relative flex flex-wrap gap-2">
        <!-- The page's own tabs. A page whose row is plain links hands them over as `links`; a page
             whose row carries a control rather than a link - the hall of fame borrows the collections
             menu from a character page - writes the whole row into the slot instead. -->
        <slot>
          <NuxtLink
            v-for="link in links || []"
            :key="link.to"
            :to="link.to"
            class="hoa-tab hoa-liquid-glass"
            :class="{ 'hoa-tab-active': link.active }"
            :aria-current="link.active ? 'page' : undefined"
          >
            {{ link.label }}
          </NuxtLink>
        </slot>

        <!-- The languages sit at the far end of the row the links are on, exactly where a reader
             finds them on a character page. -->
        <LocaleSwitch class="ml-auto" />
      </div>
    </nav>
  </header>
</template>
