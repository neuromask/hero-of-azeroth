<script setup lang="ts">
/**
 * The summary row above the table: five glass plates about the population as a whole.
 *
 * Every plate reads the same object - the aggregate the endpoint sends with the first page of the
 * table (see `#shared/data/leaderboardSchema`) - and none of them computes anything: the leaders
 * are already picked, the share is already a percentage, and the plate only decides what to print
 * large and what to print under it. That is the point of the shape: a widget can be added to this
 * row, or to a page built later, without the storage layer learning about it.
 *
 * A plate whose leader is missing prints a dash rather than a zero, which is the honest answer for
 * a table that has just been backfilled from the sitemap's index: it knows who has been looked up
 * and what their mounts are, but not their decor, and "master architect, 0 pieces" would be a
 * claim the data does not support.
 */
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { mPlusQualityTextClass } from '#shared/utils/wow-quality'
import type { LeaderboardPlayer, LeaderboardStats } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The aggregate the endpoint sent, or `null` before the first answer has landed. */
  stats: LeaderboardStats | null
  /** True while a fresh answer is on its way, which dims the row rather than emptying it. */
  pending?: boolean
}>()

const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()

/** A dash, which is what a figure the table does not know is printed as. */
const DASH = '—'

/** A figure the way the language being read writes it: `4 589` in Russian, `4,589` in English. */
function format(value: number): string {
  return value.toLocaleString(locale.value === 'ru' ? 'ru-RU' : 'en-US')
}

/** A class's name in the language being read. The id is the same in every language, the word is not. */
function className(classId: number): string {
  const entry = classById(classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
}

/** The address of a player's own page, in the language being read. */
function profileUrl(player: LeaderboardPlayer): string {
  return localeUrl(`/${regionPath(player.region)}/${player.realm}/${player.name}`)
}

/** One plate, described rather than written out five times. */
interface Card {
  key: string
  /** The glyph to draw, or `null` for a plate that carries a colour instead of an icon. */
  icon: string | null
  /** The colour of the dot a plate without an icon draws. */
  dotHex?: string
  label: string
  value: string
  /** The class the figure is set in, so a rating keeps its own colour. */
  valueClass?: string
  hint: string
  /** The colour the hint is set in, which is how a name keeps its class colour. */
  hintHex?: string
  /** Where the plate leads, when it names a player. */
  href?: string
}

const cards = computed<Card[]>(() => {
  const stats = props.stats
  const leader = stats?.collector
  const rating = stats?.rating
  const architect = stats?.architect
  const topClass = stats?.topClass

  const nameOf = (player?: LeaderboardPlayer | null) =>
    player ? `${player.displayName} · ${player.realmName}` : DASH

  return [
    {
      key: 'players',
      icon: 'emblem',
      label: t('lbStatPlayers'),
      value: stats ? format(stats.players) : DASH,
      hint: stats
        ? t('lbStatPlayersHint', { realms: format(stats.realms), classes: format(stats.classes) })
        : DASH
    },
    {
      key: 'collector',
      icon: 'mounts',
      label: t('lbStatCollector'),
      value: leader ? format(leader.value) : DASH,
      hint: leader ? `${t('lbStatItems')} · ${nameOf(leader.player)}` : DASH,
      hintHex: leader ? classById(leader.player.classId)?.hex : undefined,
      href: leader ? profileUrl(leader.player) : undefined
    },
    {
      key: 'class',
      icon: null,
      dotHex: topClass ? classById(topClass.classId)?.hex || DEFAULT_CLASS_HEX : undefined,
      label: t('lbStatClass'),
      value: topClass ? className(topClass.classId) : DASH,
      hint: topClass
        ? t('lbStatClassHint', { share: topClass.share, count: format(topClass.count) })
        : DASH
    },
    {
      key: 'rating',
      icon: 'key',
      label: t('lbStatRating'),
      value: rating ? format(rating.value) : DASH,
      valueClass: rating ? mPlusQualityTextClass(rating.value) : undefined,
      hint: rating ? nameOf(rating.player) : DASH,
      hintHex: rating ? classById(rating.player.classId)?.hex : undefined,
      href: rating ? profileUrl(rating.player) : undefined
    },
    {
      key: 'architect',
      icon: 'decor',
      label: t('lbStatArchitect'),
      value: architect ? format(architect.value) : DASH,
      hint: architect ? nameOf(architect.player) : DASH,
      hintHex: architect ? classById(architect.player.classId)?.hex : undefined,
      href: architect ? profileUrl(architect.player) : undefined
    }
  ]
})
</script>

<template>
  <div
    class="grid grid-cols-2 gap-3 lg:grid-cols-5"
    :class="pending ? 'opacity-70' : ''"
    :aria-busy="pending ? 'true' : undefined"
  >
    <component
      :is="card.href ? 'a' : 'div'"
      v-for="card in cards"
      :key="card.key"
      :href="card.href"
      class="hoa-panel flex min-w-0 flex-col p-3.5 sm:p-4"
      :class="card.href ? 'hoa-panel-interactive' : ''"
    >
      <p class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
        <AppIcon v-if="card.icon" :name="card.icon" class="h-[1.1em] w-[1.1em]" />
        <span
          v-else
          class="inline-block h-[0.85em] w-[0.85em] shrink-0 rounded-full"
          :style="{ backgroundColor: card.dotHex || 'rgba(255,255,255,0.25)' }"
          aria-hidden="true"
        ></span>
        <span class="truncate">{{ card.label }}</span>
      </p>

      <p
        class="mt-2 truncate text-2xl font-extrabold leading-tight sm:text-3xl"
        :class="card.valueClass || 'text-white'"
        :title="card.value"
      >{{ card.value }}</p>

      <p
        class="mt-1 truncate text-xs text-gray-400"
        :style="card.hintHex ? { color: card.hintHex } : undefined"
        :title="card.hint"
      >{{ card.hint }}</p>
    </component>
  </div>
</template>
