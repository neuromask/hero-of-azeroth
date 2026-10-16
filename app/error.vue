<script setup lang="ts">
/**
 * The page an address is answered with when the address names nothing - and the page a broken render is
 * answered with.
 *
 * Nuxt draws this one itself, outside the router's pages, so it is the one page of the site that wears the
 * site's frame without being one of them: the backdrop, the header with the site's own row under it, the plate
 * and the sign-off, all of it drawn by `app/components/SiteMissing.vue` - which is the very page a character
 * the site could not read is given (`app/pages/[region]/[realm]/[name].vue`). Two mistakes, one page: a reader
 * who mistyped a character's address and a reader who mistyped a page's address asked the same wrong question.
 */
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const { t, locale, setLocale } = useI18n()
const route = useRoute()

/**
 * The language the address names, applied here rather than by the middleware.
 *
 * `app/middleware/lang.global.ts` reads the language off the address on every navigation - but an address that
 * matched no route at all is not a navigation the middleware is run on, and that is most of what this page
 * answers. So the same reading is made here, from the same helper: without it a Russian reader who mistyped a
 * Russian address is explained the mistake in English.
 */
const requested = localeFromPath(route.fullPath)
if (requested !== locale.value) await setLocale(requested)

/**
 * The status, as this build of Nuxt reports it.
 *
 * `status` is the field's current name and `statusCode` the name it had before this major; a failure carrying
 * neither - a render that threw something which is not an error at all - is answered as a server error, which
 * is the honest reading of a page that did not come back.
 */
const status = computed(() => Number(props.error.status || props.error.statusCode || 500))

/** The copy: an address that named nothing is a different answer from a page that broke. */
const title = computed(() => (status.value === 404 ? 'pageNotFoundTitle' : 'errorServerTitle'))
const body = computed(() => (status.value === 404 ? 'pageNotFoundBody' : 'errorServerBody'))

// The title carries the brand like every other page's, and the address is kept out of the index: an error is
// nobody's search result, and this one has no canonical address to offer a crawler.
useHead({ title: () => titleWithBrand(t(title.value)) })
useSeoMeta({ robots: 'noindex, nofollow' })
</script>

<template>
  <SiteMissing :status="status" :title="title" :body="body" :address="route.fullPath" />
</template>
