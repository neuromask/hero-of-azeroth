<script setup lang="ts">
// The summary the grid draws, and the shape of a shelf row inside it.
import type { CollectionSummary, CollectionShelfSummary } from '#shared/data/collectionsSchema'
import { ACCOUNT_SHARED_KINDS } from '#shared/data/collectionsSchema'
// Counts are written by the site's one rule, so a card reads its figures the way every page prints them.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * The root collections page: the character's whole collection as one running total over a grid of
 * shelf tiles.
 *
 * Each tile is the same Liquid Glass block the rest of the site is cut from - a frosted pane with a
 * hairline rim and a lift under the pointer - standing as a link into that shelf. It is the
 * achievements summary with four tiles instead of fifteen, and the shelf names come from the message
 * keys the collections menu already uses (`mounts`, `pets`, `toys`, `decors`), so a tile reads the
 * same name the menu does.
 */
const props = defineProps<{
  summary: CollectionSummary
  /** The collections subtree of this character, which the cards hang from. */
  path: string
}>()

const localeUrl = useLocaleUrl()

/**
 * The scope the cards below are read in: the switch is the same control a shelf carries
 * (`CollectionScopeSwitch`), and the tag on each card says which of the two that card's numbers came from. It
 * is drawn only while the account's view is the one being read - a reader who has not asked for it is looking
 * at this character's collections, which needs no label - and only where the site has such a list to read.
 */
const view = useCollectionView()

/**
 * Whether a card's numbers are the account's, which is what its label says.
 *
 * There are two ways to be the account's, and the difference is worth keeping. A shelf the site has read the
 * account's own ids for (`row.account`) is the account's because it was counted from the account's list -
 * mounts, pets and toys, where two characters really do hold different numbers. A shelf that is shared by
 * nature is the account's whichever list it came from (`ACCOUNT_SHARED_KINDS`: housing decor, one collection
 * for every character of the account, so its figure is the account's even though Blizzard hands it over per
 * character). What is left is a shelf whose account list has simply not been read yet - that number is this
 * character's, and its card says so rather than passing for the account's.
 */
function accountWide(row: CollectionShelfSummary): boolean {
  return Boolean(row.account) || ACCOUNT_SHARED_KINDS.includes(row.kind)
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-6">
    <!-- The running total: what the character holds of everything it could, drawn as one bar over
         the whole collection - the brand gold a section's own heading carries, while the shelves below
         keep the emerald their own group bars are drawn in. -->
    <section class="hoa-panel hoa-enter-frost p-4 sm:p-5">
      <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
          {{ $t('collectionsOverall') }}
        </h2>
        <span class="hoa-tag whitespace-nowrap text-gray-300">
          <span class="tabular-nums text-wow-goldLight">{{ formatNumber(props.summary.collected) }}</span>
          <span class="tabular-nums">/{{ formatNumber(props.summary.total) }}</span>
          <span class="text-gray-500">({{ formatNumber(props.summary.percent) }}%)</span>
        </span>
      </div>

      <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <!-- The scope switch a shelf carries, drawn here too: the root page's totals are the same kind of
             number, so they answer to the same control (`CollectionScopeSwitch.vue`) - and it stands wherever
             the site holds an account-wide list for this character's account. -->
        <CollectionScopeSwitch :account="props.summary.account" :available="Boolean(props.summary.accountAvailable)" />

        <!-- And which reading the numbers came back as, in one line: the switch is the reader's request and
             this is the server's answer (`CollectionSummary.account`), so a reader whose account has no such
             list yet is told the figures are this character's rather than shown a total belonging to nobody. -->
        <p class="text-xs text-gray-400">
          {{ props.summary.account ? $t('collectionsScopeAccount') : $t('collectionsScopeCharacter') }}
        </p>
      </div>

      <div class="h-2.5 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
        <div
          class="h-full rounded-full bg-gradient-to-r from-wow-gold to-amber-300 transition-[width] duration-700"
          :style="{ width: `${props.summary.percent}%` }"
        />
      </div>
    </section>

    <!-- The shelves, as tiles: one frosted block per shelf, its own count and its own bar in the
         collections' emerald, each a link into that shelf. They arrive one after another (`hoa-stagger`
         on the grid, `hoa-enter-frost` on each tile): a tile is glass, so it drifts into place without
         fading - a fade over a `backdrop-filter` surface samples the tile instead of the page
         (`app/assets/css/main.css`). -->
    <div class="hoa-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <NuxtLink
        v-for="row in props.summary.shelves"
        :key="row.kind"
        :to="localeUrl(`${props.path}/${row.kind}`)"
        class="hoa-panel hoa-panel-interactive hoa-enter-frost group flex flex-col gap-3 p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-bold uppercase tracking-wider text-white sm:text-[15px]">
            {{ $t(row.kind) }}
          </h3>
          <span class="hoa-tag shrink-0 whitespace-nowrap text-[11px] text-gray-300">
            {{ formatNumber(row.percent) }}%
          </span>
        </div>

        <!-- Which reading this card is, while the reader is looking at the account's: a shelf that is the
             account's by nature - the decorations, one collection for every character of the account - says
             so beside the three the site read the account's own ids for, and a shelf whose account list has
             not been read yet says that it is still this character's (`accountWide`). -->
        <p
          v-if="view.byAccount && Boolean(props.summary.accountAvailable)"
          class="text-[11px] font-semibold uppercase tracking-wide"
          :class="accountWide(row) ? 'text-wow-goldLight' : 'text-gray-500'"
        >
          {{ accountWide(row) ? $t('accountWide') : $t('perCharacter') }}
        </p>

        <div class="mt-auto">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="tabular-nums text-lg font-extrabold text-wow-goldLight">
              {{ formatNumber(row.collected) }}
            </span>
            <span class="tabular-nums text-xs text-gray-400">/ {{ formatNumber(row.total) }}</span>
          </div>

          <div class="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
            <div
              class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
              :style="{ width: `${row.percent}%` }"
            />
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
