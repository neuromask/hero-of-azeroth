<script setup lang="ts">
/**
 * The two languages the site is served in, as a pair of plates.
 *
 * The language is the first path segment and only the non-default one is written out, so the other
 * copy of whatever page is being read is one segment away (`app/composables/urls.ts`). The two
 * addresses are one route - the Russian one is an alias of the English one - and a router
 * navigation to the route it is already on is dropped as a duplicate, which is why a switch is a
 * link the browser follows rather than a `push`: the address is the only thing that has to change,
 * and a link is what changes it. It also means a crawler reads the pair, and the header switches
 * with no JavaScript at all.
 *
 * The plates are the ones the card on the front page wears, so the control reads the same wherever
 * a reader meets it: the language being read is the one warmed with the brand gold.
 */
import { SUPPORTED_LOCALES, type AppLocale } from '~/composables/lang'

const { locale, t } = useI18n()
const route = useRoute()

/** The address of `code`'s copy of the page being read. */
const hrefFor = (code: AppLocale): string => localePath(code, stripLocalePrefix(route.path))

/** What a plate says when it is pointed at, in the language's own words: a name needs no translating. */
const NAMES: Record<AppLocale, string> = { en: 'English', ru: 'Русский' }
</script>

<template>
  <div class="flex shrink-0 items-center gap-1.5" role="group" :aria-label="t('language')">
    <a
      v-for="code in SUPPORTED_LOCALES"
      :key="code"
      :href="hrefFor(code)"
      :hreflang="code"
      :title="NAMES[code]"
      :aria-current="code === locale ? 'true' : undefined"
      class="inline-flex items-center justify-center rounded-lg border px-2 py-1.5 text-xs font-semibold leading-none transition-all"
      :class="code === locale ? 'border-wow-gold bg-wow-gold/10' : 'border-white/10 bg-black/40 opacity-60 hover:opacity-100'"
    >{{ code.toUpperCase() }}</a>
  </div>
</template>
