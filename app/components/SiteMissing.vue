<script setup lang="ts">
/**
 * The page a reader is answered with when what they asked for is not here.
 *
 * Two things draw it, and they are the same answer: an address that matched no page at all (`app/error.vue`,
 * which Nuxt draws outside the router's pages), and a character the site could not read
 * (`app/pages/[region]/[realm]/[name].vue`, whose shell has nobody to put a header and a row of views over).
 * A reader who mistypes a character's address and a reader who mistypes a page's address have made the same
 * mistake, so they are owed the same page rather than a line of red text and a bare button.
 *
 * The frame is the site's, and it is the frame the documents are cut from (`app/components/SiteDocument.vue`):
 * the backdrop the hall of fame stands on, the header with the site's own row under it, the plate, and the
 * sign-off. What differs is the plate, and the plate is where the care went:
 *
 *   - the status is drawn as the one large figure of the page, in the site's own numerals and the brand gold,
 *     parted from what follows by the two hairlines a character's name is parted by;
 *   - the search stands in the middle of it, because the mistake this page answers most often is a mistyped
 *     character and the two fields are the whole repair - a 404 on this site is one lookup away from a page;
 *   - an address that was *asked for* is printed under the heading, so a reader can see the typo rather than
 *     being told only that there is nothing here;
 *   - and a failure that was the site's rather than the reader's (a read Blizzard did not answer, a page that
 *     did not render) is offered the other door: the same read again.
 *
 * The plate arrives in the site's own motion (`hoa-enter-frost`) - a drift and never a fade, because the plate
 * is glass and an `opacity` on a `backdrop-filter` surface makes it sample itself instead of the page
 * (`app/assets/css/main.css`).
 */
import backdrop from '~/assets/img/hf-bg_01.webp'

const props = withDefaults(
  defineProps<{
    /** The status the site answered with, printed as the plate's figure: `404`, `500`, `503`. */
    status: number
    /** The message key of the page's name, which the header prints. */
    title: string
    /** The message key of the sentence under the figure. */
    body: string
    /** What was asked for - the address, or the character - printed under the heading so a typo is visible. */
    address?: string
  }>(),
  { address: '' }
)

const { t } = useI18n()
const localeUrl = useLocaleUrl()

/**
 * The address as a reader can check it.
 *
 * A path in a browser's address bar is percent-encoded, so a Russian address reaches this page as
 * `/ru/%D0%BF%D0%B2%D0%BF%D0%B2` - which is not something anyone can hold against what they meant to type, and
 * this line exists for exactly that comparison. `decodeURI` leaves the characters an address is *made* of
 * alone and turns the escapes of the rest back into the letters that were typed; a path that is not valid
 * escapes at all - a lone `%` someone typed by accident - is shown as it arrived rather than thrown over.
 */
const readableAddress = computed(() => {
  if (!props.address) return ''

  try {
    return decodeURI(props.address)
  } catch {
    return props.address
  }
})

/**
 * Whether the plate offers the search, or the read again.
 *
 * The two mistakes are different: a `404` is a reader who named something that is not there (a typo, an old
 * link) and the site's search is the whole repair, while a `5xx` - and a `429`, which is the site asking a
 * reader to slow down rather than telling them anything about what they asked for - is the *site's* answer,
 * and offering them a search box would be pretending otherwise. So the figure's status decides: four hundred
 * is a lookup, five hundred is the same read once more.
 */
const wrongAddress = computed(() => props.status < 500 && props.status !== 429)

/** Asks for the same address again, which is the whole of what "try again" can honestly do. */
function reload(): void {
  window.location.reload()
}
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black"
  >
    <SiteBackdrop :image="backdrop" />

    <!-- The page's name and the address it answered for: the heading a page of this site wears, with the one
         fact the reader needs to see to correct themselves under it - decoded, so a Cyrillic name reads as the
         letters that were typed rather than as the escapes of them. The row beneath is the site's own
         navigation, which the header draws for a page that has none of its own. -->
    <SiteHeader :title="t(title)" :meta="readableAddress" />

    <main class="relative z-10 container mx-auto flex w-full flex-1 items-center justify-center px-4 py-10">
      <div class="hoa-panel hoa-ring-gold hoa-enter-frost w-full max-w-2xl p-6 text-center sm:p-10">
        <!-- The status as the page's one figure, between the two hairlines of the brand colour running out
             into the plate - the line the site parts a name from what it goes on to say with. -->
        <div class="flex items-center gap-4 sm:gap-6">
          <span class="h-px flex-1 bg-gradient-to-r from-transparent to-wow-gold/50" aria-hidden="true" />
          <p class="text-5xl font-extrabold leading-none tabular-nums text-wow-goldLight [text-shadow:0_0_30px_rgba(248,183,0,0.35)] sm:text-7xl">
            {{ status }}
          </p>
          <span class="h-px flex-1 bg-gradient-to-l from-transparent to-wow-gold/50" aria-hidden="true" />
        </div>

        <p class="mx-auto mt-5 max-w-md text-sm leading-relaxed text-gray-300 sm:text-[15px]">
          {{ t(body) }}
        </p>

        <!-- The one control that repairs a mistyped character, offered without a press: the fields are the
             same two the front door and every page's own row carry. -->
        <div v-if="wrongAddress" class="mx-auto mt-6 max-w-lg">
          <CharacterSearchForm compact />
        </div>

        <!-- And the way on, in the two shapes the site's controls wear: the pressed one is gold, and everything
             beside it is glass. -->
        <div class="mt-7 flex flex-wrap items-center justify-center gap-2">
          <NuxtLink :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass hoa-tab-active">
            {{ $t('lbTitle') }}
          </NuxtLink>

          <button v-if="!wrongAddress" type="button" class="hoa-tab hoa-liquid-glass" @click="reload">
            {{ $t('errorRetry') }}
          </button>
        </div>
      </div>
    </main>

    <footer class="relative container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>
  </div>
</template>
