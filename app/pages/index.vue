<script setup lang="ts">
// The Russian copy of this page is the same component under `/ru`; the middleware reads
// the language off whichever of the two addresses was asked for.
definePageMeta({ alias: '/ru' })

// The home page has no rendered card of its own, so its preview image is a still of
// the site. Vite resolves the file to a URL carrying a content hash, which `usePageSeo`
// then makes absolute on the public host - a new picture is a new URL, so a network
// reading the old one picks the new artwork up on its own.
import hoaPrev from '~/assets/img/hoa-prev.jpg'

/**
 * The artwork the page cycles through behind the form: the six community backgrounds in
 * `~/assets/img`, one after another and then back to the first. Vite resolves each file to a
 * URL carrying a content hash, and every picture is in the markup from the first render, so
 * the browser has all six before the first change and a fade never lands on a half-loaded
 * image - which is what makes the change a cross-fade rather than a flash.
 */
import bg01 from '~/assets/img/bg-01.webp'
import bg02 from '~/assets/img/bg-02.webp'
import bg03 from '~/assets/img/bg-03.webp'
import bg04 from '~/assets/img/bg-04.webp'
import bg05 from '~/assets/img/bg-05.webp'
import bg06 from '~/assets/img/bg-06.webp'

const backgrounds = [bg01, bg02, bg03, bg04, bg05, bg06]

/** How long one picture is held before the next one fades in. */
const SLIDER_INTERVAL = 6000

/**
 * Which picture is showing, and the id of the timer that walks through them. The server
 * renders the first one and the browser starts on that same index, so hydration sees the
 * markup it was given; the timer is only started in `onMounted`, so no rotation runs during
 * a render. `window` is named the way the character page names it, and it is where the id
 * of a browser timer comes from.
 */
const backgroundIndex = ref(0)
let backgroundTimer: number | null = null

/** Steps to the next picture, wrapping around at the end and back to the first. */
const showNextBackground = () => {
  backgroundIndex.value = (backgroundIndex.value + 1) % backgrounds.length
}

const { t } = useI18n()
const publicConfig = useRuntimeConfig().public

/**
 * The search page is the site's front door, so it carries the site-wide title and
 * description and the `WebSite` node behind the brand in a search result. The
 * characters are described by their own pages, which is where the content is.
 *
 * The `WebSite` node is the one piece of structured data a page without a subject
 * can offer: it names the site and the languages it serves.
 */
usePageSeo({
  title: () => t('homeTitle'),
  description: () => t('homeDescription'),
  // 1200x630, the size every network lays a large preview out for, and a JPEG while
  // the default is the PNG of the shared card, so the tags describe this file.
  image: hoaPrev,
  imageType: 'image/jpeg',
  jsonLd: () => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'HeroOfAzeroth',
    url: publicConfig.siteUrl,
    description: t('homeDescription'),
    inLanguage: [...SUPPORTED_LOCALES]
  })
})

onMounted(() => {
  // The rotation only exists in the browser: a server render has no timer, and the first
  // picture is already the one the markup was drawn with.
  backgroundTimer = window.setInterval(showNextBackground, SLIDER_INTERVAL)
})

onBeforeUnmount(() => {
  if (backgroundTimer !== null) window.clearInterval(backgroundTimer)
})
</script>

<template>
  <div class="relative min-h-screen bg-wow-dark flex flex-col items-center justify-center p-4">
    <!-- The community artwork (`app/assets/img/bg-01.webp` through `bg-06.webp`) covers the
         whole page, one picture at a time: the six are stacked on each other and the page
         fades between them, so the change is a cross-fade and never a blank frame. Every
         scene is a bright one, so a flat scrim plus a vignette dim whichever is showing
         just enough for the glass box and the gold accents to stay readable. -->
    <img
      v-for="(picture, index) in backgrounds"
      :key="picture"
      :src="picture"
      alt=""
      aria-hidden="true"
      class="fixed inset-0 h-full w-full object-cover transition-opacity duration-[3200ms] ease-in-out"
      :class="index === backgroundIndex ? 'opacity-100' : 'opacity-0'"
    />
    <div class="fixed inset-0 bg-wow-dark/45"></div>
    <div class="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(8,10,15,0.65)_100%)]"></div>

    <!-- The form is the same liquid glass as the boxes on the character page, and the two fields
         in it are the same component the hall of fame opens from its own row
         (`app/components/CharacterSearchForm.vue`): the site has one search, and everywhere it is
         offered it is the same fields, the same suggestions and the same progress. -->
    <div class="relative z-20 max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <!-- The wordmark carries the brand, so the heading is the artwork: it is
               sized to the cap height the text had before (text-3xl). -->
          <h1>
            <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-16 w-auto" />
          </h1>
          <p class="text-xs text-white-400 mt-2">{{ $t('tagline') }}</p>
        </div>

        <!-- The languages are the pair every page carries, so the switch a reader learns on the
             character page is the one they meet here (`app/components/LocaleSwitch.vue`). -->
        <LocaleSwitch />
      </div>

      <CharacterSearchForm />
    </div>

    <!-- The sign-off, drawn by the same component every page carries, so the two pages sign off
         identically. The column above centres the box and the line as one block, so the box keeps its
         place while the line stays the same. It is asked for the compact form: the card above opens
         with the wordmark, and this page brings its own `mt-4` rather than the component's 36px, so
         the gap under the card stays what it always was. -->
    <footer class="relative z-10 mt-4 text-xs">
      <SiteFooter :standalone="false" />
    </footer>

    <!-- Back to the top of the page, and the support plate - the two corners the site keeps a
         floating control in. -->
    <BackToTop />
    <SupportButton />
  </div>
</template>

