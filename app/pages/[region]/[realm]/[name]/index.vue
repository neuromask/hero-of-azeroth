<script setup lang="ts">
// The ladders the collection numbers and the Mythic+ rating are coloured by are shared with the
// card, which draws the same tiers into its own SVG: one table, so a page and its card can never
// disagree.
import { collectionPercent, mPlusQualityTextClass, wowQualityTextClass } from '#shared/utils/wow-quality'
// The profile the shell fetched (see the composable). The tiles and the summary are the
// overview's alone, so everything they draw is computed here.
import { useCharacterView } from '~/composables/characterView'

const { character } = useCharacterView()
const { t } = useI18n()

/** Formats counts the same way on the server and in the browser. */
const formatCount = (value: number) => value.toLocaleString('en-US')

/**
 * The rating wears the tier it has reached, off the same Mythic+ bands the card colours the
 * figure with. The item level beside it stays plain white: it is a single number with no ladder
 * of its own to be read against, so it is left to read as a fact.
 */
const mPlusColor = computed(() => mPlusQualityTextClass(character.value?.mPlusScore ?? 0))

interface StatTile {
  key: string
  /** File name in `~/assets/icons`, which `<AppIcon>` draws. */
  icon: string
  label: string
  /** The scope in small print under the label: whose numbers this tile shows. */
  note: string
  /** The tier colour the count is set in, from the shared quality ladder. */
  color: string
  display: string
  percent: number
}

/**
 * The stat tiles with their progress bars, split into the two columns they are
 * laid out in around the character. Achievements lead the right column.
 *
 * Every tile names the scope of its number in small print, because the six do not come
 * from the same place: pets, toys and decor arrive account-wide from Blizzard - they are
 * identical for every character of an account - while mounts and the achievement points
 * are the character's own, and reputations are too - deliberately so, because a character
 * is only ever on one side of the faction war while the account's characters are not, so a
 * count across the account would mix the two sides and have no reachable total to sit
 * under. The tile counts the ladders this character has finished itself - the Exalted
 * factions, plus a renown faction at its last renown level and a delve companion at its
 * last level, which have no Exalted tier at all. Its denominator is what a character of
 * this faction can reach, not Blizzard's whole faction index - see `reputationTotal`.
 *
 * The count carries the tier its collection has reached rather than a fixed colour, so the
 * number says how far along the tile is at a glance. The ladder is the shared one, off the
 * same thresholds the card colours its own numbers by (`shared/utils/wow-quality.ts`).
 */
const tileColumns = computed<StatTile[][]>(() => {
  const c = character.value
  if (!c) return []

  const accountWide = t('accountWide')
  const perCharacter = t('perCharacter')

  const tiles = [
    { key: 'mounts', icon: 'mounts', label: t('mounts'), note: perCharacter, count: c.stats.mounts.count, total: c.stats.mounts.total },
    { key: 'toys', icon: 'toys', label: t('toys'), note: accountWide, count: c.stats.toys.count, total: c.stats.toys.total },
    { key: 'reputations', icon: 'exalted-rep', label: t('reputations'), note: perCharacter, count: c.stats.reputations.count, total: c.stats.reputations.total },
    { key: 'achievements', icon: 'achievments', label: t('achievements'), note: perCharacter, count: c.stats.achievements.count, total: c.stats.achievements.total },
    { key: 'pets', icon: 'pets', label: t('pets'), note: accountWide, count: c.stats.pets.count, total: c.stats.pets.total },
    { key: 'decor', icon: 'decor', label: t('decor'), note: accountWide, count: c.stats.decor.count, total: c.stats.decor.total }
  ]

  const withBar = tiles.map((tile) => ({
    ...tile,
    // The count wears the tier its collection has reached, the way the card's numbers do.
    color: wowQualityTextClass(tile.count, tile.total),
    display: formatCount(tile.count),
    percent: collectionPercent(tile.count, tile.total)
  }))

  return [withBar.slice(0, 3), withBar.slice(3)]
})
</script>

<template>
  <main class="relative z-20 container mx-auto px-4 py-6 flex-1 flex flex-col justify-center">
    <!-- The character render, fixed behind the tiles so it holds its place while the page moves
         over it. Blizzard draws it on a 1600x1200 canvas with the model floating in the middle, so
         the image is blown up and shifted until the feet sit on the bottom edge of the window. It
         belongs to the overview alone: the feed is a list and has no model behind it. -->
    <div class="pointer-events-none fixed inset-0 z-[5] hidden items-center justify-center lg:flex" aria-hidden="true">
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
      <div v-for="(column, columnIndex) in tileColumns" :key="columnIndex" class="space-y-4">
        <div
          v-for="tile in column"
          :key="tile.key"
          class="hoa-panel hoa-panel-interactive p-3 sm:p-4"
        >
          <!-- Two columns of two rows. The first row carries the glyph, the label and the big
               number, which share one line so their centres line up. The second row carries the
               scope of the number and the `total / %`, written in the same style so the two read as
               one line. The glyph is 1.5x the 1.15em it used to be (1.725em, so it scales with the
               label at both breakpoints) and sits in a square box, which is the 1:1 `viewBox` every
               icon file is drawn on, so nothing is stretched. -->
          <div class="grid grid-cols-[1fr_auto] items-center gap-x-3 mb-2">
            <span class="flex min-w-0 items-center gap-2.5 text-base font-bold uppercase tracking-wider text-gray-200 sm:text-lg">
              <AppIcon :name="tile.icon" class="h-[1.725em] w-[1.725em] shrink-0" />
              <span class="truncate text-[22px]">{{ tile.label }}</span>
            </span>
            <span class="text-2xl sm:text-3xl font-extrabold whitespace-nowrap text-right" :class="tile.color">{{ tile.display }}</span>
            <!-- Under the first row: whose numbers the tile shows, and how much of everything there
                 is to collect they cover. -->
            <span class="truncate text-[12px] uppercase px-10 font-semibold text-gray-400">{{ tile.note }}</span>
            <span class="whitespace-nowrap text-right text-[12px] font-semibold text-gray-400 tabular-nums">{{ formatCount(tile.total) }} / {{ tile.percent }}%</span>
          </div>
          <div class="w-full bg-black/60 h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
            <div class="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full transition-all duration-1000" :style="{ width: tile.percent + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- The summary figures sit centred under the tiles, where the download button used to stand.
       Only from `lg` up does the two-column grid leave the middle of the row free, so that is
       where the negative top margin may pull the block up towards the model; while the tiles are
       still stacked in one column (phones and tablets) it keeps an ordinary gap so it never rests
       on the last box. -->
  <div class="relative z-30 container mx-auto px-4 mt-6 sm:mt-8 lg:-mt-8 pb-6 flex flex-col items-center gap-2">
    <!-- The summary figures have taken the place the download button held, and with it the glass
         the tiles above are cut from: the same frame, the same blur and the same lift under the
         pointer, so the row reads as one more block of statistics. -->
    <div class="hoa-panel hoa-panel-interactive flex w-full items-center justify-between gap-3 px-4 py-2.5 sm:gap-6 sm:px-5 sm:py-3 lg:w-auto">
      <div class="text-center">
        <span class="text-xs text-gray-200 uppercase tracking-wider block font-bold">{{ $t('itemLevel') }}</span>
        <span class="text-2xl sm:text-3xl font-bold text-white inline-flex items-center justify-center gap-2">
          <AppIcon name="item-level" class="h-[0.85em] w-[0.85em]" />
          {{ character?.ilvl }}
        </span>
      </div>
      <div class="h-8 w-[1px] bg-white/15"></div>
      <div class="text-center">
        <span class="text-xs text-gray-200 uppercase tracking-wider block font-bold">{{ $t('mPlus') }}</span>
        <span class="text-2xl sm:text-3xl font-bold inline-flex items-center justify-center gap-2" :class="mPlusColor">
          <AppIcon name="key" class="h-[0.85em] w-[0.85em]" />
          {{ character?.mPlusScore }}
        </span>
      </div>
    </div>
  </div>
</template>