<script setup lang="ts">
/**
 * About: what Hero of Azeroth is for, who it is for, and what it costs - which is nothing.
 *
 * It is the one page of the site that is about the site rather than about a character, and it is written for
 * the reader who has just landed and wants to know who made this and why before they trust it with a name.
 * That is why it is laid out rather than written: the mark the site is known by opens it, the story of the
 * project is three short paragraphs, and what the site *does* is six cards with glyphs rather than a paragraph
 * each - because a visitor skims this page and stops at whichever one is their reason for being here. The
 * glyphs are the site's own files (`app/assets/icons`), the same ones the shelves, the tables and the card are
 * drawn with, so the page is made of the site rather than illustrated beside it - and they are white on
 * purpose, which is what makes them one set on dark glass.
 *
 * The frame - the backdrop, the header, the pane the article sits in, the foot, the two floating controls - is
 * `app/components/SiteDocument.vue`, shared with the privacy policy and the legal notice. The frame hands the
 * page a place above its prose (the `intro` slot, where the mark and the tagline go) and a place under it (the
 * default slot, where the cards, the principles and the closing actions go), so the words of the page stay in
 * the locale files like everything else the site says.
 *
 * Three things on the page have to stay true, and each is written the way the code behaves rather than the way
 * it reads best. The **collections counts** are the account's where the game shares them and the character's
 * own otherwise (`server/utils/accountPool`), which is why the card says both. The **table** holds the
 * characters the site has *read* - a lookup is what puts a row in it - and never every player in the game
 * (`server/utils/leaderboardRows`, and the table's own hint), which is why the card says so outright. And the
 * **analytics counter** is not switched off by a refusal: the container still loads, and Consent Mode still
 * lets Google answer a visit without cookies and without anything that identifies the reader - which is what
 * the privacy policy promises and what `shared/utils/consent.ts` and `nuxt.config.ts` do between them - so the
 * page says exactly that, in the same breath as the advertising switches, which stay denied whichever way the
 * reader answers.
 */
definePageMeta({ alias: '/ru/about' })

import backdrop from '~/assets/img/hf-bg_01.webp'
// The link component as an object rather than a tag: a card is a link or a plain pane, and that choice is
// made from the data above (`feature.to`), so the component has to be handed over by value - a tag name in
// `:is` is resolved against the app's own registry, and Nuxt's components are imported by the compiler
// instead (`#components`).
import { NuxtLink } from '#components'
// The character this browser opened last, which is the one comparison the page can offer a reader without
// making them look somebody up first (`app/composables/searchHistory.ts` reads the same list the front page
// and the search fields do).
import { useSearchHistory } from '~/composables/searchHistory'

const { t } = useI18n()
const localeUrl = useLocaleUrl()

usePageSeo({
  title: () => t('aboutTitle'),
  description: () => t('aboutSeoDescription')
})

/** Where the site is built in the open, and the one address the author answers on (`SiteFooter`'s own two). */
const REPOSITORY = 'https://github.com/neuromask/hero-of-azeroth'
const TELEGRAM = 'https://t.me/neuromask'

/**
 * The two pages of the site's own that a card and a closing action lead to, as the site spells them: the
 * overall rating of the hall of fame - one of the thirteen rankings the menu names, and the one the whole
 * table is ordered by (`METRIC_LEADERBOARDS`, slug `score`) - and the page a Battle.net sign-in opens
 * (`app/pages/profile.vue`, which offers the sign-in itself to a reader who has none).
 */
const FAME_PATH = '/leaderboards/score'
const ACCOUNT_PATH = '/profile'

/** A card of the shelf: the glyph it is read by, and the two messages it is written from. */
interface Feature {
  icon: string
  title: string
  body: string
  /**
   * The page the card leads to, where the card is about something a reader can open without a character of
   * their own. The four cards that are about *a character* have none: a page's card, its shelves, its
   * achievements and its comparison all belong to somebody the reader has to look up first, and a card that
   * guessed at an address would be a door onto nothing.
   */
  to?: string
}

/**
 * The six things the site does, each with the glyph the rest of the site already draws it by: the card to
 * download, the shelves of a collector, the achievements and reputations, the two crossed swords of a
 * comparison, the trophy of the hall, and the Battle.net mark of the account behind it.
 */
const FEATURES: Feature[] = [
  { icon: 'download-button', title: 'aboutFeatureCardsTitle', body: 'aboutFeatureCardsBody' },
  { icon: 'mounts', title: 'aboutFeatureCollectorsTitle', body: 'aboutFeatureCollectorsBody' },
  { icon: 'achievments', title: 'aboutFeatureAchievementsTitle', body: 'aboutFeatureAchievementsBody' },
  { icon: 'kills', title: 'aboutFeatureCompareTitle', body: 'aboutFeatureCompareBody' },
  { icon: 'trophy', title: 'aboutFeatureFameTitle', body: 'aboutFeatureFameBody', to: FAME_PATH },
  { icon: 'battlenet', title: 'aboutFeatureDashboardTitle', body: 'aboutFeatureDashboardBody', to: ACCOUNT_PATH }
]

/** The story of the project, as the frame's own section: one heading, and the paragraphs of its one message. */
const SECTIONS = [{ title: 'aboutIdeaTitle', body: 'aboutIntro' }]

/** What the project stands on, one sentence each, read as a list rather than as a second column of prose. */
const PRINCIPLES = [
  'aboutPrincipleFree',
  'aboutPrincipleNoAds',
  'aboutPrincipleIndependent',
  'aboutPrincipleSources',
  'aboutPrincipleAnalytics',
  'aboutPrincipleEvolving'
]

/** How a closing action is drawn: the site's quiet pane, lit gold under the pointer and under the keyboard. */
const ACTION =
  'inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm font-semibold text-gray-200 outline-none transition-colors hover:border-wow-gold/40 hover:bg-white/[0.07] hover:text-white focus-visible:border-wow-gold/60 focus-visible:text-white'

/**
 * The comparison of the character this browser opened last, or `null` for a reader who has opened none.
 *
 * A comparison is *two* characters, and the second half of that pair is picked on a character's own page
 * (`/compare/...`, `app/components/CharacterVersus.vue`), so an address for it exists only once a character
 * does. The site remembers the last one this browser read (`useSearchHistory`, the same list the row under a
 * page's header is filled from), so the action can be offered to the reader it belongs to and left out for
 * everybody else - which is the honest version of a link to a page that is not there yet. The list is read on
 * the client, because the server has no storage and no history: the first render carries no such action and
 * the browser adds it a moment later, exactly as the front page's own row of links does.
 */
const { history, load: loadHistory } = useSearchHistory()
onMounted(loadHistory)

const compareUrl = computed(() => {
  const [last] = history.value
  if (!last) return null

  return localeUrl(`/${regionPath(last.region)}/${last.realm}/${last.name}/compare`)
})
</script>

<template>
  <SiteDocument :image="backdrop" title="aboutTitle" meta="aboutMeta" :sections="SECTIONS">
    <!-- What the page opens with, over the prose of its story: the mark the site is known by, the one line it
         is summed up by, and the paragraph that says what it is. It is a pane of the brand's own gold rather
         than a second sheet of the site's glass - the article it stands in is already frosted, and a filter
         inside a filter can only sample the pane it sits in, which reads as a washed copy of it
         (`app/assets/css/main.css`). -->
    <template #intro>
      <div
        class="mb-6 rounded-2xl border border-wow-gold/20 bg-gradient-to-br from-wow-gold/[0.12] via-wow-gold/[0.04] to-transparent p-5 sm:p-6"
      >
        <AppIcon name="hoa-logotype" alt="Hero of Azeroth" class="h-8 w-auto max-w-full sm:h-10" />

        <p class="mt-3 text-base font-bold leading-snug text-wow-goldLight sm:text-lg">{{ t('aboutTagline') }}</p>
        <p class="mt-2 text-sm leading-relaxed text-gray-300">{{ t('aboutLead') }}</p>
      </div>
    </template>

    <template #default>
      <h2 class="mt-7 text-sm font-bold text-white sm:text-base">{{ t('aboutFeaturesTitle') }}</h2>

      <ul class="mt-3 grid gap-3 sm:grid-cols-2">
        <!-- A card is a flat pane rather than a second serving of the site's glass (see the note on the
             introduction above). The two cards that lead somewhere wear the brand's gold on their hairline
             under the pointer and under the keyboard; the four that are about a character of the reader's own
             do not answer the pointer at all, because there is nothing for them to open. -->
        <li v-for="feature in FEATURES" :key="feature.title" class="min-w-0">
          <component
            :is="feature.to ? NuxtLink : 'div'"
            :to="feature.to ? localeUrl(feature.to) : undefined"
            class="flex h-full gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4 outline-none transition-colors"
            :class="
              feature.to
                ? 'hover:border-wow-gold/40 hover:bg-white/[0.06] focus-visible:border-wow-gold/60 focus-visible:bg-white/[0.06]'
                : ''
            "
          >
            <AppIcon :name="feature.icon" class="mt-0.5 h-7 w-7 shrink-0 opacity-90" />

            <div class="min-w-0">
              <h3 class="text-sm font-bold text-white">{{ t(feature.title) }}</h3>
              <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t(feature.body) }}</p>
            </div>
          </component>
        </li>
      </ul>


      <!-- And what the project stands on, given the brand's gold the way the introduction is: the promises
           that are not a feature of the site but a fact about it. -->
      <div class="mt-7 rounded-xl border border-wow-gold/25 bg-wow-gold/[0.06] p-4">
        <p class="flex items-center gap-2 text-sm font-bold text-wow-goldLight">
          <AppIcon name="hoa-emblem" class="h-6 w-6" />
          {{ t('aboutPrinciplesTitle') }}
        </p>

        <ul class="mt-2 grid gap-1.5 sm:grid-cols-2">
          <li
            v-for="principle in PRINCIPLES"
            :key="principle"
            class="flex gap-2 text-sm leading-relaxed text-gray-300"
          >
            <span class="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-wow-gold/70" aria-hidden="true" />
            <span class="min-w-0">{{ t(principle) }}</span>
          </li>
        </ul>
      </div>

      <!-- The ways in, rather than a sign-off: every one of them is an address of the site or of the project,
           and the comparison among them is the one that can only be offered to a browser that remembers a
           character (`compareUrl` above). -->
      <h2 class="mt-7 text-sm font-bold text-white sm:text-base">{{ t('aboutCtaTitle') }}</h2>

      <ul class="mt-3 flex flex-wrap gap-2">
        <li>
          <NuxtLink :to="localeUrl('/')" :class="ACTION">
            <AppIcon name="user" class="h-[1.1em] w-[1.1em]" />
            {{ t('aboutCtaFind') }}
          </NuxtLink>
        </li>

        <li>
          <NuxtLink :to="localeUrl(FAME_PATH)" :class="ACTION">
            <AppIcon name="trophy" class="h-[1.1em] w-[1.1em]" />
            {{ t('aboutCtaFame') }}
          </NuxtLink>
        </li>

        <li v-if="compareUrl">
          <NuxtLink :to="compareUrl" :class="ACTION">
            <AppIcon name="kills" class="h-[1.1em] w-[1.1em]" />
            {{ t('aboutCtaCompare') }}
          </NuxtLink>
        </li>

        <li>
          <a :href="REPOSITORY" target="_blank" rel="noopener noreferrer" :class="ACTION">
            {{ t('aboutCtaGithub') }}
          </a>
        </li>

        <li>
          <a :href="TELEGRAM" target="_blank" rel="noopener noreferrer" :class="ACTION">
            {{ t('aboutCtaTelegram') }}
          </a>
        </li>
      </ul>
    </template>
  </SiteDocument>
</template>
