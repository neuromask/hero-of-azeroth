<script setup lang="ts">
// The ladders the collection numbers and the Mythic+ rating are coloured by are shared with the
// card, which draws the same tiers into its own SVG: one table, so a page and its card can never
// disagree.
import { collectionPercent, mPlusQualityTextClass, wowQualityTextClass } from '#shared/utils/wow-quality'
// Counts are written by the site's one rule (`#shared/utils/formatNumber`): thousands grouped by a
// space, so a tile reads `1 200` here exactly as it does on the card drawn from it.
import { formatNumber } from '#shared/utils/formatNumber'
// The profile the shell fetched (see the composable). The tiles and the summary are the
// overview's alone, so everything they draw is computed here.
import { useCharacterView } from '~/composables/characterView'
// Where a tile leads: the ranking of the figure it prints, carrying the place this character holds in it. Both
// halves of that address - which ranking, and where in it - come from one composable, which is the same one the
// drawer under the summary plate reads, so the two halves of the page cannot spell one address differently.
import { useCharacterRanks } from '~/composables/characterRanks'
// The figures a tile stands for are the site's own rankings, so the keys below are that type rather than any
// string: a tile added for a figure the site ranks nowhere would not compile.
import type { MetricLeaderboardSlug } from '#shared/data/leaderboardSchema'

const { character } = useCharacterView()
const { t } = useI18n()

/**
 * The places this character holds in the site's rankings, which is what every tile below links with.
 *
 * Read while the page is being rendered rather than after it, because a place travels in the *address* of a link
 * (`?rank=`, see `tileUrl`) - and an address written after the first frame is an address a reader who follows the
 * link before it lands does not carry. The answer is one request for the whole page, cached on the server under
 * the stamp of the data (`app/composables/characterRanks`).
 */
const { urlFor } = await useCharacterRanks()

/**
 * The rating wears the tier it has reached, off the same Mythic+ bands the card colours the
 * figure with. The item level beside it stays plain white: it is a single number with no ladder
 * of its own to be read against, so it is left to read as a fact.
 */
const mPlusColor = computed(() => mPlusQualityTextClass(character.value?.mPlusScore ?? 0))

/**
 * The overall rating of the page: the number the profile carries, rather than one worked out here.
 *
 * The figures the tiles print are the account's, and the rating of those very figures was computed where
 * they were put together - on the server, once (`server/utils/accountPool`). A page that works one out for
 * itself assembles its own list of the six figures, and a list written by hand beside a formula is a list
 * that loses a figure the day the formula gains one: this page used to print a score without its
 * reputation term, thousands of points below the table it was taken from.
 */
const totalScore = computed(() => character.value?.score ?? 0)

interface StatTile {
  /** The figure the tile stands for, which is also the ranking it opens. */
  key: MetricLeaderboardSlug
  /** File name in `~/assets/icons`, which `<AppIcon>` draws. */
  icon: string
  label: string
  /** Whose figures the tile prints - the account's, or the character's own (`accountWide`/`perCharacter`). */
  note: string
  /** The tier colour the count is set in, from the shared quality ladder. */
  color: string
  display: string
  percent: number
  /** The count and its total, which the bar and the ratio beside it are drawn from. */
  count: number
  total: number
}

/**
 * The stat tiles with their progress bars, split into the two columns they are
 * laid out in around the character. Achievements lead the right column.
 *
 * Under every label stands whose figures the tile prints. The collection numbers come from the
 * account's own pool (`server/utils/accountPool`) whenever there is one - the reader brought the
 * account, so the page speaks for it, and every tile says so. A character whose owner never came
 * back with an account has no pool to read: mounts and reputations are then only the character's
 * own reading, while pets, toys, decor and the achievement points are the collections Blizzard
 * keeps for the account, so those keep saying the account's. The server tells the two cases apart
 * with `character.pooled`, which is set where the pool is applied.
 *
 * The count carries the tier its collection has reached rather than a fixed colour, so the
 * number says how far along the tile is at a glance. The ladder is the shared one, off the
 * same thresholds the card colours its own numbers by (`shared/utils/wow-quality.ts`).
 */
const tileColumns = computed<StatTile[][]>(() => {
  const c = character.value
  if (!c) return []

  /** Kinds Blizzard only ever reports for the character itself, so an accountless one has no pool to offer. */
  const characterOwned = ['mounts', 'reputations']

  const noteFor = (key: string) =>
    c.pooled || !characterOwned.includes(key) ? t('accountWide') : t('perCharacter')

  const tiles: Array<{ key: MetricLeaderboardSlug; icon: string; label: string; count: number; total: number }> = [
    { key: 'mounts', icon: 'mounts', label: t('mounts'), count: c.stats.mounts.count, total: c.stats.mounts.total },
    { key: 'toys', icon: 'toys', label: t('toys'), count: c.stats.toys.count, total: c.stats.toys.total },
    { key: 'reputations', icon: 'exalted-rep', label: t('reputations'), count: c.stats.reputations.count, total: c.stats.reputations.total },
    { key: 'achievements', icon: 'achievments', label: t('achievements'), count: c.stats.achievements.count, total: c.stats.achievements.total },
    { key: 'pets', icon: 'pets', label: t('pets'), count: c.stats.pets.count, total: c.stats.pets.total },
    { key: 'decor', icon: 'decor', label: t('decor'), count: c.stats.decor.count, total: c.stats.decor.total }
  ]

  const withBar = tiles.map((tile) => ({
    ...tile,
    // Whose figures this tile prints, read off the same character the numbers came from.
    note: noteFor(tile.key),
    // The count wears the tier its collection has reached, the way the card's numbers do.
    color: wowQualityTextClass(tile.count, tile.total),
    display: formatNumber(tile.count),
    percent: collectionPercent(tile.count, tile.total)
  }))

  return [withBar.slice(0, 3), withBar.slice(3)]
})

/**
 * Where a tile leads: the ranking of the figure it prints, over the whole population - and, in the address's own
 * `?rank=`, the place this character holds in that ranking, so the table opens the page their row stands on and
 * brings it into view (`useCharacterRanks`, which is the same answer the drawer under the summary plate reads).
 *
 * The tile shows one figure of one character, and the table behind it is the site's ranking of that very figure -
 * the same figure the hall of fame has a column for and the comparison board a row for, read from the same rows
 * (`METRIC_LEADERBOARDS` in `#shared/data/leaderboardSchema`). So pressing "Mounts 1 266" opens the mount ranking,
 * and the number under the reader's eye is the ranking's own figure.
 *
 * The world rather than the character's realm or region: what a tile is a door into is the *table*, and the table
 * the site keeps is the whole population. A realm-scoped page is a handful of rows - the site has read a few
 * characters on most realms - so it answers "who else is here" rather than "where do I stand among everybody", and
 * a reader who wants their own corner of it narrows it from the filters that page carries (which are the same two
 * scopes the plate at the top of it links to).
 *
 * A character the table does not hold - an alt that is neither its account's main nor a row of its own - is linked
 * to the ranking without a place: a row that is not there cannot be turned to, and the door is still a door. A
 * figure whose place the site cannot work out without asking the table something extra - the score is a column of
 * figures rather than a statistic of the profile - is not a tile, so every tile here names a ranking that exists.
 */
function tileUrl(key: MetricLeaderboardSlug) {
  return urlFor(key)
}
</script>

<template>
  <main class="relative z-20 container mx-auto px-4 py-6 flex-1 flex flex-col justify-center">
    <!-- The character render, fixed behind the tiles so it holds its place while the page moves
         over it. Blizzard draws it on a 1600x1200 canvas with the model floating in the middle, so
         the image is blown up and shifted until the feet sit on the bottom edge of the window. It
         belongs to the overview alone: the feed is a list and has no model behind it.
         "Behind" is what the layer says: a negative `z-index` inside this page's own `z-20` layer puts the
         model under everything the page stands in front of it - the tiles are laid over its feet, which is
         the whole point of a backdrop - while it stays over the artwork the site itself is drawn on. The
         positive layer it used to carry (`z-[5]`) painted the model *over* the tiles: a fixed box above a
         row of `z-auto` panels covers them, and the plates this page is read for were behind a picture. -->
    <div class="pointer-events-none fixed inset-0 -z-10 hidden items-center justify-center lg:flex" aria-hidden="true">
      <div class="relative h-[78vh] max-h-[820px] w-[62vh] overflow-hidden">
        <img
          v-if="character?.renderUrl"
          :src="character.renderUrl"
          :alt="character.name"
          class="absolute left-1/2 top-0 h-[145%] max-w-none -translate-x-1/2 -translate-y-[13%] object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.9)]"
        />
      </div>
    </div>

    <!-- The tile columns carry a 20% wider box than the original (100% - 45vw) / 2 rows, which is
         about 32% of the row here: a column of (100% - gap) / 2 with a 36% gap works out at 32%,
         and that lands within a percent of the 20%-wider width at every container size. The gap is
         a share of the padded row rather than of the viewport on purpose: `container` stops growing
         at a breakpoint while `vw` does not, so a viewport-based gap keeps widening and squeezes
         the boxes on large screens. -->
    <div class="relative grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-[36%] items-center">
      <div v-for="(column, columnIndex) in tileColumns" :key="columnIndex" class="hoa-stagger space-y-4">
        <NuxtLink
          v-for="tile in column"
          :key="tile.key"
          :to="tileUrl(tile.key)"
          class="hoa-panel hoa-panel-interactive hoa-enter-frost block p-3 sm:p-4"
        >
          <!-- Two columns of two rows. The first row carries the glyph, the label and the big
               number, which share one line so their centres line up. The second row carries the
               note under the label it belongs to and the `total / %` under the number: whose figures
               the tile prints on the left, and how much of everything there is to collect on the
               right. The glyph is 1.5x the 1.15em it used to be (1.725em, so it scales with the
               label at both breakpoints) and sits in a square box, which is the 1:1 `viewBox` every
               icon file is drawn on, so nothing is stretched.

               The whole tile is a link into the ranking of the figure it prints (`tileUrl`) - the world's, with
               every filter open, because the table the site keeps is the population's and a realm of it is a
               handful of rows: the number under the reader's eye is the ranking's own figure, so the table is one
               press away rather than a trip through a menu. It is a link rather than a button because it goes
               somewhere, and it keeps the frame the statistics above it wear - the panel is `block` here, since a
               link is inline by default and would otherwise lay its own grid out as one. -->
          <div class="grid grid-cols-[1fr_auto] items-center gap-x-3 mb-2">
            <span class="flex min-w-0 items-center gap-2.5 text-base font-bold uppercase tracking-wider text-gray-200 sm:text-lg">
              <AppIcon :name="tile.icon" class="h-[1.725em] w-[1.725em] shrink-0" />
              <span class="truncate text-[22px]">{{ tile.label }}</span>
            </span>
            <span class="text-2xl sm:text-3xl font-extrabold whitespace-nowrap text-right" :class="tile.color">{{ tile.display }}</span>
            <!-- Indented past the glyph, so the note stands under the label it belongs to rather
                 than under the icon. -->
            <span class="truncate px-10 text-[12px] font-normal uppercase text-gray-400">{{ tile.note }}</span>
            <span class="whitespace-nowrap text-right text-[12px] font-normal text-gray-400 tabular-nums">
              {{ formatNumber(tile.total) }} / {{ formatNumber(tile.percent) }}%
            </span>
          </div>
          <div class="w-full bg-black/60 h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div class="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full transition-all duration-1000" :style="{ width: tile.percent + '%' }"></div>
          </div>
        </NuxtLink>
      </div>
    </div>
  </main>

  <!-- The summary figures sit centred under the tiles, where the download button used to stand.
       Only from `lg` up does the two-column grid leave the middle of the row free, so that is
       where the negative top margin may pull the block up towards the model; while the tiles are
       still stacked in one column (phones and tablets) it keeps an ordinary gap so it never rests
       on the last box. -->
  <div class="relative z-30 container mx-auto px-4 mt-6 sm:mt-8 lg:-mt-8 pb-6 flex flex-col items-center gap-2">
    <!-- The plate and the drawer that belongs to it share one box, which is what makes them one width. The box
         hugs the plate the way the plate used to hug its three figures (`lg:w-auto` once the grid leaves the
         middle of the row free), and the drawer - out of the flow and anchored to the plate's own top edge
         (`bottom-full`) - is stretched across that same width, so the panel, the label on it and the plate all
         measure the same. Anchoring it to the plate's top edge rather than laying it out above is also what makes
         it open upward: the plate never moves a pixel, the way a drawer pulled out from under a shelf behaves.
         The plate is a layer above the drawer (`z-10` against the drawer's own layer), which is what lets the
         drawer's bottom edge slide under the plate - by exactly the plate's corner radius (`translate-y-3`, the
         `rounded-xl` of `.hoa-panel`), so the plate's own curve is what the label disappears behind. -->
    <div class="relative w-full lg:w-auto">
      <StatDrawer class="absolute inset-x-0 bottom-full translate-y-3" />

      <!-- The three figures the page leads with: the rating, the item level and the Mythic+ score. -->
      <div class="hoa-panel hoa-panel-interactive relative z-10 flex w-full items-center justify-between gap-3 px-4 py-2.5 sm:gap-6 sm:px-5 sm:py-3">
        <!-- The overall rating leads the row, the way it leads the table: the one figure that sums up
             everything beside it. -->
        <!-- The overall rating, as the door into its own ranking: the score is the one figure of this plate the
             site keeps a table of (`tileUrl('score')` - the hall of fame's own, over the whole population, like
             every other tile of the page). The label warms on the hover rather than the plate lighting up whole,
             because the two figures beside it lead nowhere - and the pointer is not put on the plate itself, whose
             rim is shared by all three. -->
        <NuxtLink
          :to="tileUrl('score')"
          class="group block text-center"
          :title="`${$t('lbColScore')} — ${$t('rankOpenTitle')}`"
        >
          <span class="text-xs text-gray-200 uppercase tracking-wider block font-semibold transition-colors group-hover:text-white">{{ $t('lbColScore') }}</span>
          <span class="text-2xl sm:text-3xl font-extrabold text-wow-goldLight inline-flex items-center justify-center gap-2 whitespace-nowrap">
            <AppIcon name="trophy" class="h-[0.85em] w-[0.85em]" />
            {{ formatNumber(totalScore) }}
          </span>
        </NuxtLink>
        <div class="h-8 w-[1px] bg-white/15"></div>
        <div class="text-center">
          <span class="text-xs text-gray-200 uppercase tracking-wider block font-semibold">{{ $t('itemLevel') }}</span>
          <span class="text-2xl sm:text-3xl font-extrabold text-white inline-flex items-center justify-center gap-2 whitespace-nowrap">
            <AppIcon name="item-level" class="h-[0.85em] w-[0.85em]" />
            {{ formatNumber(character?.ilvl) }}
          </span>
        </div>
        <div class="h-8 w-[1px] bg-white/15"></div>
        <div class="text-center">
          <span class="text-xs text-gray-200 uppercase tracking-wider block font-semibold">{{ $t('mPlus') }}</span>
          <span class="text-2xl sm:text-3xl font-extrabold inline-flex items-center justify-center gap-2 whitespace-nowrap" :class="mPlusColor">
            <AppIcon name="key" class="h-[0.85em] w-[0.85em]" />
            {{ formatNumber(character?.mPlusScore) }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
