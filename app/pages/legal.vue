<script setup lang="ts">
/**
 * The legal and trademark notice: the one page that says, in the plainest words available, whose game this is
 * and whose site this is not.
 *
 * It is short on purpose. A fan site is not obliged to explain its relationship to Blizzard, but a reader -
 * and the community's own conventions - is owed a page that says it outright rather than leaving it to be
 * inferred from a footer, and everything such a page has to say fits in four sections: what the project is,
 * whose the game is, what this site is not, and where its figures come from. The four are the questions a
 * reader arrives with, in the order they ask them, which is why they are short headings rather than three
 * paragraphs of prose - and why each carries one of the site's own white glyphs beside it
 * (`app/assets/icons`: information, a copyright mark, a shield, a stack of discs).
 *
 * The section that has to be *true* rather than cautious is the last one: it names every source a reader's
 * page actually reads from, and nothing beyond them. That is Blizzard's own Web API for a character, their
 * collections and their reputations (`server/utils/blizzard`, and `server/utils/bnetOAuth` for an account's
 * own collections); Blizzard's media service for the portraits and the class artwork a page stands on;
 * Wowhead's ZamImg for the sprites of the items and achievements, and its Power widget for the tooltips
 * (`server/utils/collections`, `app/composables/wowheadPower`). The catalogue of collectables a shelf counts
 * against is assembled from publicly published community data when the site's data is refreshed rather than
 * read on a visit (`scripts/refresh-collections.mjs`), and saying so is the honest half of the same sentence.
 *
 * The frame - the backdrop, the header, the pane, the foot - is `app/components/SiteDocument.vue`, which the
 * privacy policy is drawn by as well, so a reader who arrives here from the foot of a page finds the page
 * they were on.
 */
definePageMeta({ alias: '/ru/legal' })

import backdrop from '~/assets/img/hf-bg_01.webp'

const { t } = useI18n()

usePageSeo({
  title: () => t('legalTitle'),
  description: () => t('legalSeoDescription')
})

/**
 * The notice, as the four short sections it is: what the project is, whose the game and its artwork are, what
 * the site is not, and where its figures come from. A section's shape is the frame's, and the glyph is the one
 * the frame draws beside its heading.
 */
const SECTIONS: Array<{ icon: string; title: string; body: string }> = [
  { icon: 'info', title: 'legalAboutTitle', body: 'legalAboutBody' },
  { icon: 'copyright', title: 'legalOwnershipTitle', body: 'legalOwnershipBody' },
  { icon: 'shield', title: 'legalIndependentTitle', body: 'legalIndependentBody' },
  { icon: 'database', title: 'legalSourcesTitle', body: 'legalSourcesBody' }
]
</script>

<template>
  <SiteDocument :image="backdrop" title="legalTitle" meta="legalMeta" :sections="SECTIONS">
    <!-- Who the notice names, and where their own terms are: the game's publisher, the terms the API is used
         under, and the site that serves the item sprites and the tooltips the shelves are read with. -->
    <template #references>
      <a href="https://www.blizzard.com" target="_blank" rel="noopener noreferrer">Blizzard Entertainment</a>
      <a
        href="https://www.blizzard.com/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ t('legalTerms') }}
      </a>
      <a href="https://www.wowhead.com" target="_blank" rel="noopener noreferrer">Wowhead</a>
    </template>
  </SiteDocument>
</template>
