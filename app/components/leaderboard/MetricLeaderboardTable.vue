<script setup lang="ts">
/**
 * The table of one metric leaderboard: `# | Character | Guild | Realm | <the figure>`.
 *
 * One figure per row and nothing else, which is what a reader who opens `/leaderboards/mounts` came for: eight
 * columns at once would make them hunt for the one the address named, and every one of the site's figures has a
 * table of its own to be read in. The figure is read from the row with
 * the site's own rule (`metricFigureOf`), so a value that is *unknown* prints as a dash rather than as a nought -
 * the same distinction the ranking itself turns on.
 *
 * What it shares with the front door's table, it shares rather than copies - and that is the whole row: the place
 * in a medal for the first three, the side as the colour of the row's own edge, the portrait with a monogram behind
 * it and the account's halo around it, the dot that says the account is on the site right now, the name in its
 * class colour with the star that saves a character for the favorites beside it, the two badges that say which row
 * is the reader's main and which row is being read, and the class, the level and the item level under it. A reader
 * who has met those marks on the front door should not have to learn a second table, and a name saved from either
 * of them is filled in both (`app/components/FavoriteStar.vue` writes one list). It is deliberately a table of its
 * own rather than the front door's: that one draws a fixed set of columns in a `v-for`, and reaches the figures of
 * a row through the names of those columns, while this one is told which single figure it is of and reads it with
 * the site's own rule (`metricFigureOf`) - a difference of the *figure*, not of the row.
 *
 * Every row carries the place it holds (`data-rank`) and its own key (`data-key`), which is what the page walks to:
 * `?rank=` and the plate's own press land on the row by its place, and the row of the character this browser
 * selected wears the gold - the plate above the table is about that character, so the table says which row it is.
 */
import { searchHistoryKey, type SearchHistoryEntry } from '#shared/utils/savedCharacters'
import { formatNumber } from '#shared/utils/formatNumber'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { factionById } from '#shared/utils/wow-faction'
import { metricFigureOf, isAtItemLevelCap } from '#shared/data/leaderboardSchema'
import type { LeaderboardPlayer, MetricLeaderboard } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  players: LeaderboardPlayer[]
  /** The ranking being drawn, which is the column, the figure and the words this table prints. */
  metric: MetricLeaderboard
  /** The place the first row holds in the whole ranking, one-based. */
  offset: number
  /** The place a link asked to be shown, which the row holding it wears the brand gold for. */
  highlight?: number | null
  /**
   * The character this browser has selected, written the way `searchHistoryKey` writes a row: the plate above the
   * table stands for them, so their row is marked rather than left to be found by eye. An outlined badge, because it
   * says which row is being *read*.
   */
  selected?: string
  /**
   * The reader's own character, written the same way: the main the account they are signed in as leads with
   * (`ownerKey` in `app/components/leaderboard/MetricLeaderboard.vue`), which their row wears a filled badge for.
   *
   * A second, stronger mark than the one above - the character being read is whatever the browser last opened, while
   * this one is the reader's own - so the two answer different questions and a row may carry both.
   */
  owner?: string
  /**
   * The mains whose account is on the site right now, keyed the way `searchHistoryKey` writes a row
   * (`app/composables/presence.ts`). An absent set draws no dot at all, which is the quiet answer to a question
   * nobody could answer.
   */
  online?: Set<string>
  /** True while a fresh answer is on its way, which dims the table rather than emptying it. */
  pending?: boolean
}>()

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name a row prints comes from
// the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** The medal colours of the first three places: gold, silver, bronze. */
const MEDALS = ['#f8b700', '#cbd5e1', '#d08b4a']

/** A dash, which is what a figure - or a guild - the site does not know is printed as. */
const DASH = '—'

/** The place a row holds in the whole ranking, not just on the page it is drawn on. */
function rankOf(index: number): number {
  return props.offset + index + 1
}

/** The medal colour of a row, or `null` for a place that wears none. */
function medalOf(index: number): string | null {
  const rank = rankOf(index)
  return rank <= 3 ? MEDALS[rank - 1] || null : null
}

/** Whether a row is the one a link asked for. */
function isHighlighted(index: number): boolean {
  return typeof props.highlight === 'number' && rankOf(index) === props.highlight
}

/** Whether a row belongs to the character this browser selected, which the plate above the table stands for. */
function isSelected(player: LeaderboardPlayer): boolean {
  return !!props.selected && props.selected === searchHistoryKey(player)
}

/** Whether a row belongs to the reader's own account, which is the main that account leads with. */
function isOwner(player: LeaderboardPlayer): boolean {
  return !!props.owner && props.owner === searchHistoryKey(player)
}

/** Whether the account behind a row is on the site right now, which is what the dot on its portrait says. */
function isOnline(player: LeaderboardPlayer): boolean {
  return !!props.online?.has(searchHistoryKey(player))
}

/**
 * The colour of a row's own edge: the side the character is on, in the faction's own colour.
 *
 * It is the same pair of pixels every row of the site wears, wherever it is drawn, and the same rule: the marked row
 * keeps the gold, because an edge carries one colour and which row is being read is the louder of the two facts.
 */
function rowEdge(player: LeaderboardPlayer, index: number): string | undefined {
  if (isSelected(player) || isHighlighted(index)) return undefined
  return factionById(player.faction)?.hex
}

/** The figure this ranking is of, or `null` for a member the site has never read it for. */
function valueOf(player: LeaderboardPlayer): number | null {
  return metricFigureOf(player, props.metric.metric)
}

/** A figure the way the site writes one, or a dash where there is none. */
function print(value: number | null): string {
  return typeof value === 'number' ? formatNumber(value) : DASH
}

/** The colour a name is drawn in: its class's own, the way every name on the site is tinted. */
function classHex(classId: number): string {
  return classById(classId)?.hex || DEFAULT_CLASS_HEX
}

/** The class's name in the language being read, which the line under a name prints. */
function className(classId: number): string {
  const entry = classById(classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
}

/**
 * The region's full name in the language being read, which is what the badge in the realm column spells out: a
 * two-letter code is a shorthand a reader has to already know, and a tooltip is where a shorthand is explained.
 */
function regionName(region: string): string {
  return region === 'us' ? t('america') : t('europe')
}

/** The address of a character's own page, in the language being read. */
function profileUrl(player: LeaderboardPlayer): string {
  return localeUrl(`/${regionPath(player.region)}/${player.realm}/${player.name}`)
}

/**
 * The line under a row's name: the class, the level, and the item level of a character who has finished the climb.
 *
 * The realm and the guild have columns of their own in this table (they are two of the four facts it prints), so
 * they are not repeated here - the line says what the columns do not. The wording is the character page's own
 * ("Разбойник · ур. 90 · ilvl 318"): the class, the level, and the item level where it may be read beside the others'
 * (`isAtItemLevelCap`), because a table is exactly the place a number read *beside* other people's misleads.
 */
function metaLine(player: LeaderboardPlayer): string {
  const parts = [className(player.classId), `${t('lbLevel')} ${formatNumber(player.level)}`]

  if (isAtItemLevelCap(player.level) && player.ilvl) parts.push(`ilvl ${formatNumber(player.ilvl)}`)

  return parts.filter(Boolean).join(' · ')
}

/** The first letter of a name, which is what a row without a portrait shows. */
function initial(player: LeaderboardPlayer): string {
  return (player.displayName || player.name).charAt(0).toUpperCase()
}

/**
 * The character as the list of favorites keeps one, which is what the star on the row saves
 * (`app/components/FavoriteStar.vue`): the same shape a comparison and a plate write, so a name saved from any of
 * them is filled in on the others.
 */
function favoriteEntry(player: LeaderboardPlayer): SearchHistoryEntry {
  return {
    name: player.displayName || player.name,
    realm: player.realm,
    region: player.region === 'us' ? 'us' : 'eu',
    realmName: player.realmName,
    classId: player.classId,
    avatar: player.avatar
  }
}

/** Follows a row to the character's own page, which the whole row is a press for, as the front door's is. */
function open(player: LeaderboardPlayer): void {
  void navigateTo(profileUrl(player))
}

/** The portraits that did not load, so their rows draw a monogram instead. */
const missing = ref<Record<string, true>>({})
</script>

<template>
  <div class="hoa-panel" :class="pending ? 'opacity-70' : ''" :aria-busy="pending ? 'true' : undefined">
    <div class="hoa-scroll-x overflow-x-auto rounded-xl">
      <!-- The widths are the table's, not its content's (`table-fixed`): the place is a fixed slice of the left edge,
           the player takes a little more than the rest, and the three columns after it - the guild, the realm and the
           figure - share what is left equally. A column that grew with the longest name in it would move every other
           column along with it, and a reader scanning a table for their own row loses it the moment the columns
           shift. The floor under which the table scrolls rather than squeezing the figure column is the same idea:
           four columns of text and one of numbers, which is what a phone cannot hold side by side. -->
      <table class="w-full min-w-[44rem] table-fixed border-collapse text-sm">
        <thead>
          <tr class="border-b border-white/10 text-[13px] font-semibold uppercase tracking-wider text-gray-400">
            <th class="w-16 px-3 py-2.5 text-left" scope="col">#</th>
            <th class="w-[28%] px-3 py-2.5 text-left" scope="col">{{ t('lbColPlayer') }}</th>
            <th class="w-[24%] px-3 py-2.5 text-left" scope="col">{{ t('lbColGuild') }}</th>
            <th class="w-[24%] px-3 py-2.5 text-left" scope="col">{{ t('realmShort') }}</th>
            <th class="w-[24%] px-3 py-2.5 text-right" scope="col">
              <span class="inline-flex max-w-full min-w-0 items-center gap-1.5">
                <AppIcon :name="metric.icon" class="h-[1.15em] w-[1.15em]" />
                <span class="truncate">{{ t(metric.labelKey) }}</span>
              </span>
            </th>
          </tr>
        </thead>

        <tbody>
          <!-- A row carries its place (`data-rank`) and its own key (`data-key`), which is what the page walks to
               when a link asked for a place, and the row of the character this browser selected wears the gold -
               the plate above the table stands for them. The whole row is a press: the front door's rows open the
               character's own page, and a reader who has learned that should not find it untrue here. -->
          <tr
            v-for="(player, index) in players"
            :key="searchHistoryKey(player)"
            :data-rank="rankOf(index)"
            :data-key="searchHistoryKey(player)"
            class="group/name cursor-pointer border-b border-white/5 transition-colors last:border-b-0"
            :class="isSelected(player) || isHighlighted(index)
              ? 'bg-wow-gold/[0.08] hover:bg-wow-gold/15'
              : 'hover:bg-white/[0.05]'"
            @click="open(player)"
          >
            <!-- The place: the first three of the whole ranking wear a medal and its glow, and the row's own edge
                 carries the side it is on, in the faction's own colour (`rowEdge`). -->
            <td
              class="border-l-2 px-3 py-2.5 align-middle"
              :class="isSelected(player) || isHighlighted(index) ? 'border-wow-gold' : ''"
              :style="{ borderLeftColor: rowEdge(player, index) }"
            >
              <span
                class="inline-grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold tabular-nums whitespace-nowrap"
                :style="medalOf(index)
                  ? { color: '#0b0b0b', backgroundColor: medalOf(index)!, boxShadow: `0 0 14px ${medalOf(index)}66` }
                  : { color: '#9ca3af' }"
              >{{ formatNumber(rankOf(index)) }}</span>
            </td>

            <!-- Who the row is: portrait, name in the class colour with the star that saves a character beside it,
                 and the class and level under them. -->
            <td class="px-3 py-2.5 align-middle">
              <div class="flex items-center gap-3">
                <!-- The portrait, and the online dot hung beside it: the dot rides on this wrapper rather than on the
                     portrait itself, because the portrait's own box clips its picture to a circle and would clip the
                     mark with it. The wrapper is also where the account mark is worn - a row whose character is the
                     main of an account that signed in wears a halo in Battle.net's own blue. -->
                <span
                  class="relative shrink-0 rounded-full"
                  :class="player.isAccount ? 'ring-2 ring-[#00aeff]/80 shadow-[0_0_12px_rgba(0,174,255,0.35)]' : ''"
                  :title="player.isAccount ? t('lbAccount') : undefined"
                >
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

                  <span
                    v-if="isOnline(player)"
                    class="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-wow-dark bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.55)]"
                    role="img"
                    :title="t('lbOnline')"
                    :aria-label="t('lbOnline')"
                  />
                </span>

                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span class="flex items-center gap-1">
                      <NuxtLink
                        :to="profileUrl(player)"
                        class="break-words font-bold hover:underline"
                        :style="{ color: classHex(player.classId) }"
                        @click.stop
                      >{{ player.displayName }}</NuxtLink>

                      <!-- The star is on every row rather than under the pointer (`always`), exactly as it is on the
                           front door's: a table of names is scanned for a character the reader saved. -->
                      <FavoriteStar :entry="favoriteEntry(player)" always />
                    </span>

                    <!-- The reader's own character, right after the name: the main their account leads with. It is
                         filled gold where the "selected" mark beside it is outlined, because the two say different
                         things - this one is a fact about whose row it is, the other about which row is being read -
                         and a row can carry both, for a reader looking at their own main. -->
                    <span
                      v-if="isOwner(player)"
                      class="inline-flex shrink-0 items-center rounded bg-wow-gold px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-black"
                    >{{ t('lbYouBadge') }}</span>

                    <!-- The row this browser selected says so, in the same gold the plate above the table wears. -->
                    <span
                      v-if="isSelected(player)"
                      class="inline-flex shrink-0 items-center rounded border border-wow-gold/60 bg-wow-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-wow-goldLight"
                    >{{ t('lbSelectedBadge') }}</span>

                    <!-- The side is the colour of the row's own edge rather than a pill, so the word is still read
                         here for a reader who cannot see that colour. -->
                    <span v-if="factionById(player.faction)" class="sr-only">
                      {{ t(factionById(player.faction)?.labelKey || '') }}
                    </span>
                  </div>

                  <p class="truncate text-xs text-gray-500">{{ metaLine(player) }}</p>
                </div>
              </div>
            </td>

            <!-- The guild, which the site knows only where a profile read named one: a row that has none prints a
                 dash rather than an empty cell, because "no guild" and "never read" look the same to a reader. -->
            <td class="px-3 py-2.5 align-middle text-gray-300">
              <span class="block truncate" :title="player.guild || undefined">{{ player.guild || DASH }}</span>
            </td>

            <!-- The realm, with the region it belongs to in a badge of its own: a ranking of the *world* holds both
                 sides of the Atlantic side by side, and the same realm name exists in each of them - so the slug alone
                 would be a name a reader could be wrong about, which is the one thing a column may not be. The badge
                 is the game's own shorthand (`EU`, `US`), the way `M+` is: translated, it would be the one word in the
                 row that the game itself never says. Its tooltip is the region's full name in the page's language. -->
            <td class="px-3 py-2.5 align-middle text-gray-300">
              <span class="flex min-w-0 items-center gap-1.5">
                <span
                  class="shrink-0 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[10px] font-semibold uppercase leading-none text-gray-400"
                  :title="regionName(player.region)"
                >{{ player.region }}</span>
                <span class="min-w-0 truncate" :title="realmLabel(player.region, player.realm, player.realmName)">
                  {{ realmLabel(player.region, player.realm, player.realmName) }}
                </span>
              </span>
            </td>

            <td class="px-3 py-2.5 text-right align-middle font-extrabold tabular-nums whitespace-nowrap text-wow-goldLight">
              {{ print(valueOf(player)) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
