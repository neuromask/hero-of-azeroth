<script setup lang="ts">
/**
 * The table itself: one row per player, ordered by whatever the filters above asked for.
 *
 * It draws what it is handed and decides nothing: the rows arrive sorted and sliced from the
 * endpoint, so a page of the table is a `v-for` rather than a sort, and switching a preset or a
 * filter is a new answer rather than a client-side rearrangement of an old one. The one thing the
 * component does own is how a figure reads - a count that is unknown prints as a dash rather than
 * as a zero, and the columns a reader can order by are the buttons in its own header.
 *
 * The avatar is Blizzard's own square portrait of the character (the profile's `avatarUrl`, a few
 * kilobytes), kept with the record when the profile was read. A record that has none - one backfilled
 * from the sitemap's index, which never kept a URL - or one whose picture fails to load draws a
 * monogram in the class colour instead, so a row is never a broken image.
 *
 * One of the rows can be the reader's own - the character this browser is signed in as (see
 * `useSearchHistory`) - and the table marks such a row rather than moving it: the order is the
 * endpoint's to decide, and a table that pulled a row to the top because it happened to be the
 * reader's would no longer be the table it was handed.
 */
import { searchHistoryKey } from '~/composables/searchHistory'
import { formatNumber } from '#shared/utils/formatNumber'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { mPlusQualityTextClass } from '#shared/utils/wow-quality'
import { factionById } from '#shared/utils/wow-faction'
import { isAtItemLevelCap } from '#shared/data/leaderboardSchema'
import type { LeaderboardPlayer, LeaderboardSort } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  players: LeaderboardPlayer[]
  /** The preset in force, so the column that decides the order can mark itself. */
  sort: LeaderboardSort
  /** The figures the table is showing, by column key. The rank and the name are always drawn. */
  columns: LeaderboardSort[]
  /** The rank the first row carries, which is 1 on the first page and moves with the page number. */
  offset?: number
  /** True while a fresh answer is on its way, which dims the table rather than emptying it. */
  pending?: boolean
  /**
   * The character this browser is signed in as, written as `searchHistoryKey` writes it, whose row is
   * marked as the reader's own. Absent for a reader who has looked nobody up, and absent from a page
   * whose rows are not that character's - the mark is a mark on a row, never a claim about the table.
   */
  highlight?: string
}>()

const emit = defineEmits<{ (event: 'update:sort', value: LeaderboardSort): void }>()

const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name a row shows
// comes from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** The medal colours of the first three ranks: gold, silver, bronze. */
const MEDALS = ['#f8b700', '#cbd5e1', '#d08b4a']

/** A figure the way the site writes figures, or a dash when the table does not know it. */
function format(value: number): string {
  if (!value) return '—'
  return formatNumber(value)
}

/** A class's name in the language being read. */
function className(classId: number): string {
  const entry = classById(classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
}

/** The colour a row is tinted with: the class of the character it names. */
function classHex(classId: number): string {
  return classById(classId)?.hex || DEFAULT_CLASS_HEX
}

/** The address of a player's own page, in the language being read. */
function profileUrl(player: LeaderboardPlayer): string {
  return localeUrl(`/${regionPath(player.region)}/${player.realm}/${player.name}`)
}

/**
 * Whether a row is the reader's own: the character this browser is signed in as.
 *
 * The identity is the one the search history is kept under, which is what makes the two the same
 * character rather than two spellings of one - the browser wrote its key down from the profile it
 * read, the table built the row from the record the site stored, and a key is what says they agree.
 */
function isMe(player: LeaderboardPlayer): boolean {
  return !!props.highlight && props.highlight === searchHistoryKey(player)
}

/**
 * The avatars that did not load, so their rows draw a monogram instead. A portrait is decoration:
 * a realm the render host does not have a picture for must cost the row nothing.
 */
const missing = ref<Record<string, true>>({})

/** The first letter of a name, which is what a row without a portrait shows. */
function initial(player: LeaderboardPlayer): string {
  return (player.displayName || player.name).charAt(0).toUpperCase()
}

/**
 * The columns a reader can order the table by, in the order they are drawn. The header of each one
 * is a button, and the figure it names is the preset the endpoint already understands - so ordering
 * by pets is the same request as ordering by mounts, with a different word in it.
 *
 * Two of the seven are written out rather than translated: `M+` and `ilvl` are the game's own
 * shorthand, a player reads them the same in either language, and a translated header is exactly
 * what makes a table look foreign.
 */
const COLUMNS: {
  key: LeaderboardSort
  label: string
  field: keyof LeaderboardPlayer
  /** Set for the labels that are the game's own words and are never translated. */
  literal?: boolean
}[] = [
  { key: 'achievements', label: 'achievements', field: 'achievements' },
  { key: 'mounts', label: 'mounts', field: 'mounts' },
  { key: 'toys', label: 'toys', field: 'toys' },
  { key: 'pets', label: 'pets', field: 'pets' },
  { key: 'decor', label: 'decor', field: 'decor' },
  { key: 'mplus', label: 'M+', field: 'mPlusScore', literal: true },
  { key: 'ilvl', label: 'ilvl', field: 'ilvl', literal: true }
]

/**
 * The columns being drawn.
 *
 * While the overall chip holds (`columns` carries `total`), every column is drawn - that is what the
 * chip means - and once the reader has stepped out of it, exactly the figures they lit are drawn, in
 * the order the table always draws them in. The overall rating is the one figure with a header of its
 * own outside that list, and it is drawn only in the first of the two states.
 */
const visible = computed(() =>
  props.columns.includes('total')
    ? COLUMNS
    : COLUMNS.filter((column) => props.columns.includes(column.key))
)

const showsScore = computed(() => props.columns.includes('total'))

/**
 * How the panel's width is shared out between the columns.
 *
 * The table is laid out fixed rather than by content, because the content would decide it otherwise:
 * the widest thing in a row is the name column - a name, a realm, a class and a level - so a table
 * left to size itself hands it every spare pixel and pushes the figures aside, each one no wider than
 * its own heading, with the reader who came to compare them reading across a wall of empty table. So
 * every figure is given a share of the panel instead, capped where a column of three or four digits
 * stops needing to be wider, and the name column takes whatever is left over - which is what makes a
 * row of seven readable as seven columns and still leaves the name room beside them.
 *
 * The rank and the overall rating are measured rather than shared, since neither a rank nor a rating
 * grows. The figures can never claim more than seven shares, so the columns add up to less than the
 * panel at any width above the table's own minimum and the name column absorbs the difference.
 */
const RANK_WIDTH = 3.5
const SCORE_WIDTH = 6
/** The most of the panel a figure column takes, and the least the name column may be left with. */
const FIGURE_SHARE_MAX = 15
const NAME_SHARE_FLOOR = 33

const figureWidth = computed(() => {
  const share = Math.min(FIGURE_SHARE_MAX, (100 - NAME_SHARE_FLOOR) / Math.max(1, visible.value.length))
  return `${share}%`
})

/**
 * The figure a column prints for a player.
 *
 * An item level is the one column with a rule of its own - it only reads beside the others among
 * characters who have finished the climb (see `isAtItemLevelCap`) - so a character who has not
 * prints a dash rather than a number that cannot be compared with the rest of its column. Every
 * other column prints what it holds, and an unknown figure prints as a dash in any case.
 */
function cell(player: LeaderboardPlayer, column: { key: LeaderboardSort; field: keyof LeaderboardPlayer }): string {
  if (column.key === 'ilvl' && !isAtItemLevelCap(player.level)) return '—'
  return format(player[column.field] as number)
}

/** The rank a row carries in the whole table, not just on the page it is drawn on. */
function rankOf(index: number): number {
  return (props.offset || 0) + index + 1
}

/** The medal colour of a row, or `null` for a rank that wears none. */
function medalOf(index: number): string | null {
  const rank = rankOf(index)
  return rank <= 3 ? MEDALS[rank - 1] || null : null
}

/** Follows a row to the character's own page. The name in it is a link as well, for keyboards. */
function open(player: LeaderboardPlayer) {
  navigateTo(profileUrl(player))
}
</script>

<template>
  <div
    class="hoa-panel overflow-hidden"
    :class="pending ? 'opacity-70' : ''"
    :aria-busy="pending ? 'true' : undefined"
  >
    <p v-if="!players.length" class="px-4 py-10 text-center text-sm text-gray-400">
      {{ t('lbEmpty') }}
    </p>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[60rem] table-fixed border-collapse text-sm">
        <!-- The width of every column, decided once here rather than by what each row happens to
             hold, so the figures are spread across the panel while the rows still line up down the
             table. The name column is the one left without a width, and in a fixed layout that is
             the column that takes whatever the measured and shared ones do not. -->
        <colgroup>
          <col :style="{ width: `${RANK_WIDTH}rem` }" />
          <col />
          <col v-for="column in visible" :key="column.key" :style="{ width: figureWidth }" />
          <col v-if="showsScore" :style="{ width: `${SCORE_WIDTH}rem` }" />
        </colgroup>

        <thead>
          <tr class="border-b border-white/10 text-[14spx] font-semibold uppercase tracking-wider text-gray-400">
            <th class="px-3 py-2.5 text-left" scope="col">#</th>
            <th class="px-3 py-2.5 text-left" scope="col">{{ t('lbColPlayer') }}</th>
            <th
              v-for="column in visible"
              :key="column.key"
              class="px-2 py-2.5 text-right"
              scope="col"
            >
              <button
                type="button"
                class="inline-flex items-center gap-1 transition-colors"
                :class="sort === column.key ? 'text-wow-goldLight' : 'hover:text-white'"
                :title="t('lbSortBy')"
                @click="emit('update:sort', column.key)"
              >
                <span>{{ column.literal ? column.label : t(column.label) }}</span>
                <svg
                  v-if="sort === column.key"
                  class="h-2.5 w-2.5"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  aria-hidden="true"
                ><path d="M5 8L1 3h8z" /></svg>
              </button>
            </th>
            <th v-if="showsScore" class="px-3 py-2.5 text-right" scope="col">
              <button
                type="button"
                class="inline-flex items-center gap-1 transition-colors"
                :class="sort === 'total' ? 'text-wow-goldLight' : 'hover:text-white'"
                :title="t('lbSortBy')"
                @click="emit('update:sort', 'total')"
              >
                <span>{{ t('lbColScore') }}</span>
                <svg
                  v-if="sort === 'total'"
                  class="h-2.5 w-2.5"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  aria-hidden="true"
                ><path d="M5 8L1 3h8z" /></svg>
              </button>
            </th>
          </tr>
        </thead>

        <tbody>
          <!-- A row that is the reader's own is marked as such, and the mark rides on the row: a bar of
               the brand gold down its edge, the glass warmed with it, and the badge that says whose row
               it is. Nothing about the order changes - a row is where the table put it. -->
          <tr
            v-for="(player, index) in players"
            :key="searchHistoryKey(player)"
            :data-you="isMe(player) ? 'true' : undefined"
            class="cursor-pointer border-b border-white/5 transition-colors last:border-b-0"
            :class="isMe(player) ? 'bg-wow-gold/[0.08] hover:bg-wow-gold/15' : 'hover:bg-white/[0.05]'"
            @click="open(player)"
          >
            <!-- The rank: the first three of the whole table wear a medal and its glow, and the
                 reader's own row wears the gold bar that marks it from across the table. -->
            <td
              class="px-3 py-2.5 align-middle"
              :class="isMe(player) ? 'border-l-2 border-wow-gold' : ''"
            >
              <span
                class="inline-grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold tabular-nums whitespace-nowrap"
                :style="medalOf(index)
                  ? {
                      color: '#0b0b0b',
                      backgroundColor: medalOf(index),
                      boxShadow: `0 0 14px ${medalOf(index)}66`
                    }
                  : { color: '#9ca3af' }"
              >{{ formatNumber(rankOf(index)) }}</span>
            </td>

            <!-- Who the row is: portrait, name in the class colour, side, realm, class and level. -->
            <td class="px-3 py-2.5 align-middle">
              <div class="flex items-center gap-3">
                <span
                  class="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border"
                  :style="{
                    borderColor: `${classHex(player.classId)}66`,
                    backgroundColor: `${classHex(player.classId)}1f`
                  }"
                >
                  <span class="text-sm font-extrabold" :style="{ color: classHex(player.classId) }">
                    {{ initial(player) }}
                  </span>
                  <img
                    v-if="player.avatar && !missing[searchHistoryKey(player)]"
                    :src="player.avatar"
                    :alt="player.displayName"
                    loading="lazy"
                    decoding="async"
                    class="absolute inset-0 h-full w-full object-cover"
                    @error="missing[searchHistoryKey(player)] = true"
                  />
                </span>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <NuxtLink
                      :to="profileUrl(player)"
                      class="truncate font-bold hover:underline"
                      :style="{ color: classHex(player.classId) }"
                      @click.stop
                    >{{ player.displayName }}</NuxtLink>

                    <!-- The reader's own row says so, in the same gold the bar down its edge is. -->
                    <span
                      v-if="isMe(player)"
                      class="inline-flex shrink-0 items-center rounded border border-wow-gold/60 bg-wow-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-wow-goldLight"
                    >{{ t('lbYouBadge') }}</span>

                    <span
                      v-if="factionById(player.faction)"
                      class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none"
                      :style="{
                        borderColor: `${factionById(player.faction)?.hex}55`,
                        color: factionById(player.faction)?.hex
                      }"
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full"
                        :style="{ backgroundColor: factionById(player.faction)?.hex }"
                        aria-hidden="true"
                      ></span>
                      {{ t(factionById(player.faction)?.labelKey || '') }}
                    </span>
                  </div>

                  <p class="truncate text-xs text-gray-500">
                    {{ realmLabel(player.region, player.realm, player.realmName) }} · {{ className(player.classId) }} · {{ t('lbLevel') }} {{ formatNumber(player.level) }}
                  </p>
                </div>
              </div>
            </td>

            <!-- The figures, one column per figure the reader kept switched on, each orderable by
                 its own header. -->
            <td
              v-for="column in visible"
              :key="column.key"
              class="px-2 py-2.5 text-right tabular-nums whitespace-nowrap"
              :class="column.key === 'mplus'
                ? mPlusQualityTextClass(player.mPlusScore)
                : 'text-gray-200'"
            >{{ cell(player, column) }}</td>

            <!-- The overall rating, which is what the table is ordered by when nothing else is
                 asked for - the one figure with a header of its own outside the list above. -->
            <td
              v-if="showsScore"
              class="px-3 py-2.5 text-right font-extrabold tabular-nums whitespace-nowrap text-wow-gold"
            >{{ format(player.score) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
