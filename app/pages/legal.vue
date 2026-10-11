<script setup lang="ts">
/**
 * The legal and trademark notice: the one page that says, in the plainest words available, whose game this
 * is and whose site this is not.
 *
 * It is short on purpose. A fan site is not obliged to explain its relationship to Blizzard, but a reader -
 * and the community's own conventions - is owed a page that says it outright rather than leaving it to be
 * inferred from a footer, and everything such a page has to say fits in three paragraphs: the site is free
 * and non-commercial, the game and its assets are Blizzard's, and nothing here is endorsed by them. The
 * data's provenance belongs in the same breath, because it is the part the notice can actually promise:
 * everything shown is read through Blizzard's official Web API, under the terms that come with it.
 *
 * The frame - the backdrop, the header, the pane, the foot - is `app/components/SiteDocument.vue`, which the
 * privacy policy is drawn by as well, so a reader who arrives here from the foot of a page finds the page
 * they were on.
 */
definePageMeta({ alias: '/ru/legal' })

import backdrop from '~/assets/img/bg-05.webp'

const { t } = useI18n()

usePageSeo({
  title: () => t('legalTitle'),
  description: () => t('legalSeoDescription')
})

/**
 * The notice, as the one section it is: three paragraphs and no headings, because there is nothing here to
 * look up mid-page - a reader either reads it whole or leaves.
 */
const SECTIONS = [{ body: 'legalBody' }]
</script>

<template>
  <SiteDocument :image="backdrop" title="legalTitle" meta="legalMeta" :sections="SECTIONS">
    <template #references>
      <a href="https://www.blizzard.com" target="_blank" rel="noopener noreferrer">Blizzard Entertainment</a>
      <a href="https://develop.battle.net/documentation" target="_blank" rel="noopener noreferrer">
        {{ t('legalTerms') }}
      </a>
    </template>
  </SiteDocument>
</template>
