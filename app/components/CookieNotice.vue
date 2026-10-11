<script setup lang="ts">
/**
 * The question the site asks about cookies, exactly once.
 *
 * It is one line rather than a panel: a mark, one sentence carrying the only thing a reader needs before
 * answering (what the sign-in cookie is, and that the counter is optional), a way to read the whole of it on
 * the policy page, and the two answers. A banner that explains the law in four sentences is a banner nobody
 * reads, and the part that is actually the reader's to decide is one switch - so the sentence says what the
 * switch does, and the page it links to says everything else (`app/pages/privacy.vue`).
 *
 * Once answered it never comes back: the click is the decision, the banner goes away, and the answer is
 * remembered in the reader's own storage - `cookie_consent`, holding `'true'` for yes and `'false'` for no -
 * which is what makes the next visit a page with no question on it
 * (`app/composables/cookieConsent.ts`). That is the whole reason there is no way in to it from anywhere on
 * the site - `open` is false the moment an answer exists, and nothing has to remember to keep it that way.
 *
 * It rises from the bottom edge and drops away again when it is answered. The step is a few pixels and no
 * more, because the pane is frosted: a block moved further than that is rasterized again at a new offset for
 * as long as the transition runs, which reads as the type in it shimmering (`main.css` documents the same
 * rule for the cards that answer the pointer). A fade rides along with the step, so the mark never arrives
 * as a hard edge.
 *
 * It stands at the foot of the page, centred, and it is why: the two corners below are already held by
 * floating plates of their own (`SupportButton` the bottom right, `BackToTop` the bottom left). It is a pane
 * over the page rather than a block of it (`.hoa-pop`), because that is what it is - nothing about it is a
 * dialog: no scrim, no focus to trap, and signing in with Battle.net works while it stands, since the
 * session cookie is not the reader's to withhold (`shared/utils/consent.ts`).
 *
 * Nothing of it is drawn by the server. The answer it reflects lives in the reader's own storage, and a
 * question rendered into the first paint of a reader who answered a year ago would be a flash of the thing
 * they already answered.
 */
const { t } = useI18n()
const localeUrl = useLocaleUrl()
const { open, decide } = useCookieConsent()
</script>

<template>
  <!-- It steps up rather than appearing, and the step is deliberately short: the pane is frosted, and a
       block moved by a few pixels is rasterized again at a new offset for as long as the transition runs -
       which reads as the type in it shimmering and re-measures the frost every frame (the same reason no
       card of the site's moves under the pointer, see `main.css`). The fade rides along with the step, so
       the mark never arrives as a hard edge. -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="translate-y-3 opacity-0"
    leave-active-class="transition duration-150 ease-in"
    leave-to-class="translate-y-3 opacity-0"
  >
    <!-- The wrapper is the pointer's: it is as wide as the window so the pane stays centred, and it takes
         no clicks of its own, or a reader could not reach the page under the strip on either side of the
         pane. Only the pane itself is interactive. -->
    <div v-if="open" class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:bottom-6">
      <div
        role="region"
        :aria-label="t('cookieTitle')"
        class="hoa-pop pointer-events-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4"
      >
        <AppIcon name="hoa-emblem" class="h-5 w-5 opacity-80" />

        <p class="min-w-0 flex-1 text-xs leading-snug text-gray-300">{{ t('cookieBody') }}</p>

        <!-- The whole of it, for a reader who wants the whole of it: the policy page the foot of the site
             keeps (`app/pages/privacy.vue`), which is where the same question says the rest. -->
        <NuxtLink
          :to="localeUrl('/privacy')"
          class="shrink-0 text-xs text-gray-400 underline decoration-dotted underline-offset-2 outline-none transition-colors hover:text-wow-goldLight focus-visible:text-wow-goldLight"
        >
          {{ t('cookieMore') }}
        </NuxtLink>

        <!-- A reader who has answered is never asked again, so there is no way in to this pane and no way
             out of it that is not an answer: the two plates below are the whole of it. -->

        <!-- The two answers, and they are literally the two words the storage holds: `'true'` lets the
             counter count, `'false'` refuses it, and either of them is an answer - which is what takes the
             pane away for good. `h-8` is a plate one size down, because this pane is a line rather than a
             panel. -->
        <div class="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" class="hoa-plate h-8" @click="decide('false')">{{ t('cookieDecline') }}</button>
          <button type="button" class="hoa-plate hoa-plate-gold h-8" @click="decide('true')">
            {{ t('cookieAccept') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
