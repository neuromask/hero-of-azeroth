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
 */
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { mPlusQualityTextClass } from '#shared/utils/wow-quality'
import { factionById } from '#shared/utils/wow-faction'
import type { LeaderboardPlayer, LeaderboardSort } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  players: LeaderboardPlayer[]
  /** The preset in force, so the column that decides the order can mark itself. */
  sort: LeaderboardSort
  /** The rank the first row carries, which is 1 on the first page and moves with the page number. */
  offset?: number
  /** True while a fresh answer is on its way, which dims the table rather than emptying it. */
  pending?: boolean
}>()

const emit = defineEmits<{ (event: 'update:sort', value: LeaderboardSort): void }>()

const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()

/** The medal colours of the first three ranks: gold, silver, bronze. */
const MEDALS = ['#f8b700', '#cbd5e1', '#d08b4a']

/** A figure the way the language being read writes it, or a dash when the table does not know it. */
function format(value: number): string {
  if (!value) return '—'
  return value.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US')
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

/** The identity a row is keyed by, and the key a broken avatar is remembered under. */
function rowKey(player: LeaderboardPlayer): string {
  return `${player.region}:${player.realm}:${player.name}`
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
 */
const COLUMNS: { key: LeaderboardSort; label: string; field: keyof LeaderboardPlayer }[] = [
  { key: 'mounts', label: 'mounts', field: 'mounts' },
  { key: 'pets', label: 'pets', field: 'pets' },
  { key: 'toys', label: 'toys', field: 'toys' },
  { key: 'decor', label: 'decor', field: 'decor' },
  { key: 'achievements', label: 'achievements', field: 'achievements' },
  { key: 'mplus', label: 'mPlus', field: 'mPlusScore' },
  { key: 'ilvl', label: 'seoItemLevel', field: 'ilvl' }
]

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
      <table class="w-full min-w-[54rem] border-collapse text-sm">
        <thead>
          <tr class="border-b border-white/10 text-[11px] font-bold uppercase tracking-wider text-gray-400">
            <th class="w-14 px-3 py-2.5 text-left" scope="col">#</th>
            <th class="px-3 py-2.5 text-left" scope="col">{{ t('lbColPlayer') }}</th>
            <th v-for="column in COLUMNS" :key="column.key" class="w-20 px-2 py-2.5 text-right" scope="col">
              <button
                type="button"
                class="inline-flex items-center gap-1 transition-colors"
                :class="sort === column.key ? 'text-wow-goldLight' : 'hover:text-white'"
                :title="t('lbSortBy')"
                @click="emit('update:sort', column.key)"
              >
                <span>{{ t(column.label) }}</span>
                <svg
                  v-if="sort === column.key"
                  class="h-2.5 w-2.5"
                  viewBox="0 0 10 10"
                  fill="currentColor"
                  aria-hidden="true"
                ><path d="M5 8L1 3h8z" /></svg>
              </button>
            </th>
            <th class="hidden w-24 px-3 py-2.5 text-right xl:table-cell" scope="col">
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
          <tr
            v-for="(player, index) in players"
            :key="rowKey(player)"
            class="cursor-pointer border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.05]"
            @click="open(player)"
          >
            <!-- The rank: the first three of the whole table wear a medal and its glow. -->
            <td class="px-3 py-2.5 align-middle">
              <span
                class="inline-grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold tabular-nums"
                :style="medalOf(index)
                  ? {
                      color: '#0b0b0b',
                      backgroundColor: medalOf(index),
                      boxShadow: `0 0 14px ${medalOf(index)}66`
                    }
                  : { color: '#9ca3af' }"
              >{{ rankOf(index) }}</span>
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
                    v-if="player.avatar && !missing[rowKey(player)]"
                    :src="player.avatar"
                    :alt="player.displayName"
                    loading="lazy"
                    decoding="async"
                    class="absolute inset-0 h-full w-full object-cover"
                    @error="missing[rowKey(player)] = true"
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

                    <span
                      v-if="factionById(player.faction)"
                      class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none"
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
                    {{ player.realmName }} · {{ className(player.classId) }} · {{ t('lbLevel') }} {{ player.level }}
                  </p>
                </div>
              </div>
            </td>

            <!-- The figures, one column per collection, each orderable by its own header. -->
            <td
              v-for="column in COLUMNS"
              :key="column.key"
              class="px-2 py-2.5 text-right tabular-nums"
              :class="column.key === 'mplus'
                ? mPlusQualityTextClass(player.mPlusScore)
                : 'text-gray-200'"
            >{{ format(player[column.field] as number) }}</td>

            <!-- The rating the overall preset orders by, which only a wide table has room for. -->
            <td class="hidden px-3 py-2.5 text-right font-bold tabular-nums text-wow-gold xl:table-cell">
              {{ format(player.score) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
