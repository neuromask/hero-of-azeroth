<script setup lang="ts">
/**
 * The privacy policy: what the site collects, what a sign-in stores, and what the counters are.
 *
 * The page is content rather than markup. The frame it is drawn in - the backdrop, the header, the pane and
 * the foot - belongs to `app/components/SiteDocument.vue`, which the legal notice is drawn by as well, and
 * what is decided here is only what the policy says. Two of its sections are deliberately specific, because a
 * policy is fiction the moment it drifts from what the site does: the sign-in section names what the account
 * actually stores (the id, the BattleTag, the roster) and the switch in the profile that keeps it out of the
 * table, and the analytics section says that nothing is kept on a visitor's device until the cookie question
 * is answered - the same promise `shared/utils/consent.ts` and `nuxt.config.ts` keep in code.
 *
 * The date at the top is part of that promise too: "updates are posted with a new date at the top" is a
 * sentence this page makes, so `privacyUpdated` has to move whenever the text under it does.
 *
 * `/privacy` and `/ru/privacy` are one route, as every page of the site is: the middleware applies the
 * language the address names (`app/middleware/lang.global.ts`).
 */
definePageMeta({ alias: '/ru/privacy' })

import backdrop from '~/assets/img/bg-04.webp'

const { t } = useI18n()

usePageSeo({
  title: () => t('privacyTitle'),
  description: () => t('privacySeoDescription')
})

/** The policy, in the order a reader asks the questions in. A section's shape is the frame's. */
const SECTIONS: Array<{ title: string; body: string }> = [
  { title: 'privacyWhatTitle', body: 'privacyWhatBody' },
  { title: 'privacySigninTitle', body: 'privacySigninBody' },
  { title: 'privacyAnalyticsTitle', body: 'privacyAnalyticsBody' },
  { title: 'privacyHowTitle', body: 'privacyHowBody' },
  { title: 'privacyStoreTitle', body: 'privacyStoreBody' },
  { title: 'privacyAccessTitle', body: 'privacyAccessBody' },
  { title: 'privacyUpdateTitle', body: 'privacyUpdateBody' }
]
</script>

<template>
  <SiteDocument
    :image="backdrop"
    title="privacyTitle"
    meta="privacyMeta"
    updated="privacyUpdated"
    :sections="SECTIONS"
  >
    <!-- Who the policy names, and where their own terms are. The Telegram address is the one the foot of
         every page carries (`app/components/SiteFooter.vue`), offered again here because this is the page a
         reader comes to when they want rows deleted. -->
    <template #references>
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
        Google — {{ t('privacyTitle') }}
      </a>
      <a href="https://develop.battle.net/documentation" target="_blank" rel="noopener noreferrer">Blizzard API</a>
      <a href="https://www.wowhead.com" target="_blank" rel="noopener noreferrer">Wowhead</a>
      <a href="https://t.me/neuromask" target="_blank" rel="noopener noreferrer">Telegram</a>
    </template>
  </SiteDocument>
</template>
