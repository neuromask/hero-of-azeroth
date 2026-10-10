<script setup lang="ts">
/**
 * The sign-off every page carries: the wordmark over the address the site answers on, the repository
 * it is built in, the credit, and the year.
 *
 * It is one component rather than a copy per page, because it is the same block wherever the site
 * shows it - the foot of a character page, of the hall of fame and of the box on the front page - and
 * every part of it is something that should only ever change in one place: the three addresses, the
 * credit and the year, which is read rather than written so the line does not go stale on the first
 * of January. The wordmark belongs to it for the same reason: it is the last thing every page says,
 * and a page that spelled it out beside this component would be one more place to keep in step.
 *
 * A page whose own header is the wordmark and which brings its own spacing - the front page, whose card
 * opens with the mark - passes `:standalone="false"`: the compact form drops the wordmark and the room
 * above the block, so the same page never says it twice and the card's own margin decides the gap.
 *
 * The line itself is a pill of the site's glass, the frosted pane every block of a page is cut from
 * (`.hoa-panel`), rather than loose grey text on the page. Every page stands on artwork, and grey
 * letters over a painting are the quietest thing on the screen and the hardest to read; the sheet
 * under them is what makes the sign-off legible, and wearing the material the page's own blocks wear is
 * what keeps the foot of a page part of it. The words stay grey and small, though - the point is to be
 * read, not to be the loudest block on the page - so the pill takes the material and adds nothing but
 * its own shape: the hairline's width, the curve at the corners and the room the line needs.
 *
 * The links are the site's three faces: the address it is served on and the repository it is built in
 * open in the tab the reader is already in, and the credit opens the author's Telegram in a new one,
 * so a reader who follows it keeps the page they were reading. The external link carries the pair of
 * `rel` values the rest of the site's external links carry (`WowheadLink.vue`).
 */
withDefaults(
  defineProps<{
    /**
     * Whether this is a page's own sign-off block (the default) or a line inside a page that already
     * carries the wordmark. The compact form drops the wordmark and the 36px kept above the block.
     */
    standalone?: boolean
  }>(),
  { standalone: true }
)

const SITE = 'https://heroofazeroth.com'
const REPOSITORY = 'https://github.com/neuromask/hero-of-azeroth'
const TELEGRAM = 'https://t.me/neuromask'

/**
 * The treatment every link on the line wears, so the three of them read as one row. A step brighter
 * than the line's own text, which is what makes them findable without a colour of their own.
 */
const LINK = 'text-gray-300 outline-none transition-colors hover:text-wow-goldLight focus-visible:text-wow-goldLight'

/** The separators and the year: the line's quiet parts, which the links are read against. */
const QUIET = 'text-gray-500'
</script>

<template>
  <!-- `pt-9` is 36px: the room the sign-off keeps above itself on every page, which is what separates
       the page from its signature without a rule or a shadow. The compact form takes none of it, and
       the wordmark is a step above the line rather than part of it, hence the gap. -->
  <div class="flex flex-col items-center gap-3" :class="standalone ? 'pt-9' : ''">
    <!-- `h-[2.45rem]` is `h-7` (1.75rem) times 1.4: the wordmark is the tallest thing in the footer, so
         a size read off the mark it used to be is easier to keep in step than a fresh number. -->
    <AppIcon v-if="standalone" name="hoa-logotype" alt="HeroOfAzeroth" class="h-[2.45rem] w-auto" />

    <!-- The pill: the site's frosted pane (`hoa-panel`), so the line is read against a sheet instead of
         against the artwork - the same block the plates above the foot are cut from. The letters stay
         grey and small: the sign-off should be legible over a painting, not the loudest thing on the
         page. What the pill brings of its own is its shape - `border` for the hairline the material only
         colours, `rounded-full` at the corners - and `flex-wrap`, because the line is longer than a
         phone is wide: the parts wrap and stay centred, and the pill grows a second row rather than
         pushing the page sideways (the curve is clamped by the height, so it stays a pill). -->
    <span
      class="hoa-panel hoa-panel-interactive border flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-full px-4 py-2 text-gray-400"
    >
      <a :href="SITE" :class="LINK">heroofazeroth.com</a><span :class="QUIET">&copy; {{ new Date().getFullYear() }}</span>
      <span :class="QUIET" aria-hidden="true">&middot;</span>
      <a :href="REPOSITORY" :class="LINK" target="_blank" rel="noopener noreferrer" title="GitHub">GitHub</a>
      <span :class="QUIET" aria-hidden="true">&middot;</span>
      <span>crafted by <a :href="TELEGRAM" target="_blank" rel="noopener noreferrer" title="Telegram" :class="LINK">neuromask</a></span>
    </span>
  </div>
</template>
