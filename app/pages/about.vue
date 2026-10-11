<script setup lang="ts">
/**
 * About: what the site is, what it does, and what it costs - which is nothing.
 *
 * It is the one page of the site that is about the site rather than about a character, and it is written for
 * the reader who has just landed and wants to know who made this and why before they trust it with a name.
 * That is why it is laid out rather than written: the four things the site does are cards with glyphs rather
 * than a paragraph each, because a visitor skims this page and stops at whichever one is their reason for
 * being here. The glyphs are the site's own files (`app/assets/icons`), the same ones the shelves and the
 * Hall of Fame's plates are drawn with, so the page is made of the site rather than illustrated beside it -
 * and they are white on purpose, which is what makes them one set on dark glass.
 *
 * The frame - the backdrop, the header, the pane the article sits in, the foot, the two floating controls - is
 * `app/components/SiteDocument.vue`, shared with the privacy policy and the legal notice. The frame hands the
 * introduction its section and the page adds its own layout to the frame's slot, so the prose of it stays in
 * the locale files like everything else the site says.
 *
 * The one claim on the page that has to stay true is the free one: there are no ads and no paid tiers, and the
 * analytics counter it mentions is the only optional thing on the site and is off until the reader allows it
 * (`shared/utils/consent.ts`). If that ever changes, this page changes with it.
 */
definePageMeta({ alias: '/ru/about' })

import backdrop from '~/assets/img/bg-02.webp'

const { t } = useI18n()
const localeUrl = useLocaleUrl()

usePageSeo({
  title: () => t('aboutTitle'),
  description: () => t('aboutSeoDescription')
})

/** Where the site is built in the open, which is the one address this page offers that the foot does not. */
const REPOSITORY = 'https://github.com/neuromask/hero-of-azeroth'

/**
 * The four things the site does, each with the glyph the rest of the site already draws it with: the card to
 * download, a shelf of collectables, the trophy of the hall, and the Battle.net mark of the account behind it.
 */
const FEATURES = [
  { icon: 'download-button', title: 'aboutFeatureCardsTitle', body: 'aboutFeatureCardsBody' },
  { icon: 'mounts', title: 'aboutFeatureCollectorsTitle', body: 'aboutFeatureCollectorsBody' },
  { icon: 'trophy', title: 'aboutFeatureFameTitle', body: 'aboutFeatureFameBody' },
  { icon: 'battlenet', title: 'aboutFeatureDashboardTitle', body: 'aboutFeatureDashboardBody' }
]

/** The introduction, which is prose like the documents': one message, its paragraphs split on the blank line. */
const SECTIONS = [{ body: 'aboutIntro' }]
</script>

<template>
  <SiteDocument :image="backdrop" title="aboutTitle" meta="aboutMeta" :sections="SECTIONS">
    <!-- What the page adds under the prose of its introduction: a shelf of cards rather than a column. -->
    <template #default>
      <h2 class="mt-7 text-sm font-bold text-white sm:text-base">{{ t('aboutFeaturesTitle') }}</h2>

      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <!-- A card is a flat pane rather than a second serving of the site's glass: the article it stands in is
             already frosted, and a filter inside a filter can only sample the pane it sits in, which reads as a
             washed copy of it (`app/assets/css/main.css`). What the pointer gets instead is the site's gold on
             the hairline, and a slightly brighter fill. -->
        <li
          v-for="feature in FEATURES"
          :key="feature.title"
          class="flex gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 transition-colors hover:border-wow-gold/35 hover:bg-white/[0.06]"
        >
          <AppIcon :name="feature.icon" class="mt-0.5 h-7 w-7 shrink-0 opacity-90" />

          <div class="min-w-0">
            <h3 class="text-sm font-bold text-white">{{ t(feature.title) }}</h3>
            <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t(feature.body) }}</p>
          </div>
        </li>
      </ul>

      <!-- And the promise that is not a feature, given the brand's gold: the site is free, and the one
           optional thing on it is the counter the reader was asked about. -->
      <div class="mt-7 rounded-xl border border-wow-gold/25 bg-wow-gold/[0.06] p-4">
        <p class="flex items-center gap-2 text-sm font-bold text-wow-goldLight">
          <AppIcon name="hoa-emblem" class="h-6 w-6" />
          {{ t('aboutFreeTitle') }}
        </p>

        <p class="mt-2 text-sm leading-relaxed text-gray-300">{{ t('aboutFreeBody') }}</p>
        <p class="mt-2 text-sm leading-relaxed text-gray-400">{{ t('aboutOutro') }}</p>
      </div>
    </template>

    <!-- The two ways of reaching the people behind it, and the way in to what it is for. -->
    <template #references>
      <a :href="REPOSITORY" target="_blank" rel="noopener noreferrer">GitHub</a>
      <a href="https://t.me/neuromask" target="_blank" rel="noopener noreferrer">Telegram</a>
      <NuxtLink :to="localeUrl('/')">{{ t('lbNav') }}</NuxtLink>
    </template>
  </SiteDocument>
</template>
