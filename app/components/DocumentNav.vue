<script setup lang="ts">
/**
 * The three documents, as the site's navigation row wears them.
 *
 * The about page, the legal notice and the policy are one set rather than three pages that happen to exist: a
 * reader who opens one is usually on the way to another, so they stand in the row the whole site is navigated
 * with - the `leading` slot of `app/components/SiteNav.vue`, in the place a character page puts the character's
 * own views (`app/components/SiteDocument.vue` hands them over).
 *
 * The chips are the site's own glass controls (`.hoa-liquid-glass` worn with `.hoa-tab`), at the size every
 * control in that row is drawn at. There used to be a rail beside the article, and a rail is what those entries
 * were; the row is where the site navigates, and a document's neighbours are entries of it rather than a
 * second, smaller kind of control.
 *
 * The list lives here rather than in the pages, because a page that named its own neighbours would have to be
 * edited whenever one of them was added - the third one would be a page that forgot to mention the fourth.
 * Every document reads the same three from this one list.
 *
 * The page being read is marked the way the site marks the page it is on: the gold of `.hoa-tab-active` and
 * `aria-current`, worked out from the address without the language it happens to name, so `/privacy` and
 * `/ru/privacy` are the same page to the row (`stripLocalePrefix`, `app/composables/urls.ts`).
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
  <nav class="flex flex-wrap items-center gap-2" :aria-label="t('docsNav')">
    <NuxtLink
      v-for="document in DOCUMENTS"
      :key="document.path"
      :to="localeUrl(document.path)"
      class="hoa-tab hoa-liquid-glass"
      :class="{ 'hoa-tab-active': current === document.path }"
      :aria-current="current === document.path ? 'page' : undefined"
    >
      {{ t(document.label) }}
    </NuxtLink>
  </nav>
</template>
