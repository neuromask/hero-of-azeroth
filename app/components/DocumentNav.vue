<script setup lang="ts">
/**
 * The rail of documents: the internal links the about page, the legal notice and the policy are walked with.
 *
 * The three are one set rather than three pages that happen to exist: a reader who opens one of them is
 * usually on the way to another - "who made this" leads to "what it may not do", which leads to "what it does
 * with my data" - and a foot-of-the-page link is a poor way to walk a set, because it is only ever met after
 * the page has been read to the end. So they stand beside the page they are read with, as the site's own quick
 * anchors do for the groups of a shelf (`app/assets/css/main.css`, `.hoa-anchors`).
 *
 * The chips are the site's own glass controls (`.hoa-liquid-glass` worn with `.hoa-tab`), and the sheet they
 * stand on is the quietest pane of the site on purpose: a rail of liquid glass reads as liquid glass only
 * while what is under it stays behind it, and two sheets of the same material stacked are mud.
 *
 * The arrangement is the shelf's own too, and for the same reason: a window wide enough holds the rail at a
 * fixed 13rem beside the article (`lg`), and a phone holds neither side by side - so the same list is a panel
 * of chips above the article, which wraps rather than scrolls because three short labels have no business
 * being a horizontal scroll area (the shelf's rail is the other case: it has twenty groups and is hidden
 * below `lg` for it).
 *
 * The list lives here rather than in the pages, because a page that named its own neighbours would have to be
 * edited whenever one of them was added - the third one would be a page that forgot to mention the fourth.
 * Both the rail and the foot of every page read the same three from their own copy of this list; adding a
 * document is one line in each and nothing else (`app/components/SiteFooter.vue`).
 *
 * The page being read is marked the way the site marks the page it is on: the gold of `.hoa-tab-active` and
 * `aria-current`, worked out from the address without the language it happens to name, so `/privacy` and
 * `/ru/privacy` are the same page to the rail (`stripLocalePrefix`, `app/composables/urls.ts`).
 */
const { t } = useI18n()
const localeUrl = useLocaleUrl()
const route = useRoute()

/** The three documents, in the order they are read in. */
const DOCUMENTS = [
  { path: '/about', label: 'aboutNav' },
  { path: '/legal', label: 'legalNav' },
  { path: '/privacy', label: 'privacyTitle' }
]

/** The document being read, as an address that names no language. */
const current = computed(() => stripLocalePrefix(route.path))
</script>

<template>
  <div class="hoa-anchors lg:w-52 lg:shrink-0">
    <nav class="flex flex-wrap gap-1 p-2 lg:flex-col" :aria-label="t('docsNav')">
      <NuxtLink
        v-for="document in DOCUMENTS"
        :key="document.path"
        :to="localeUrl(document.path)"
        class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs sm:text-xs lg:w-full lg:justify-start lg:whitespace-normal lg:text-left"
        :class="{ 'hoa-tab-active': current === document.path }"
        :aria-current="current === document.path ? 'page' : undefined"
      >
        {{ t(document.label) }}
      </NuxtLink>
    </nav>
  </div>
</template>
