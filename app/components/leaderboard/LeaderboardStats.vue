<script setup lang="ts">
/**
 * The summary row of the front door: ten glass plates about the population as a whole.
 *
 * Every plate reads the same object - the aggregate `/api/leaderboard/stats` answers with
 * (`LeaderboardStats` in `#shared/data/leaderboardSchema`) - and none of them computes anything: the leaders are
 * already picked, the share is already a percentage, and the plate only decides what to print large and what to
 * print under it. That is the point of the shape: a widget can be added to this row, or to a page built later,
 * without the storage layer learning about it.
 *
 * Two of the plates are about the population rather than about a figure - how many members the site holds (with
 * who is on it right now beside the count), and which class most of them wear - and the other eight are the same
 * plate: the leader of one figure, with their name under it in their class colour and the whole plate leading to
 * their page. Seven of those eight are figures the site ranks, so the plate is a door into that figure's ranking
 * (`/leaderboards/<figure>`); the eighth is the king of collections, which counts four figures added up and has no
 * ranking of its own.
 *
 * A plate whose leader is missing prints a dash rather than a zero, which is the honest answer for a table that has
 * just been backfilled from the sitemap's index: it knows who has been looked up and what their mounts are, but not
 * their decor, and "master architect, 0 pieces" would be a claim the data does not support.
 *
 * Each plate opens with the glyph it is known by, twice the size of the words beside it: the mark on a plate is what
 * a reader picks it out by from across the row, and the row is read as marks before any of them is read as words.
 */
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
// How a figure is written on the site: one rule, shared with the card and every other page.
import { formatNumber } from '#shared/utils/formatNumber'
import type { LeaderboardPlayer, LeaderboardStats } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The aggregate the endpoint sent, or `null` before the first answer has landed. */
  stats: LeaderboardStats | null
  /** True while a fresh answer is on its way, which dims the row rather than emptying it. */
  pending?: boolean
  /**
   * How many mains are on the site right now, printed beside the population (`app/composables/presence.ts`).
   * Absent while the list is unknown or empty, which leaves the plate reading as it always did.
   */
  online?: number
}>()

const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name a plate
// shows comes from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** A dash, which is what a figure the table does not know is printed as. */
const DASH = '—'

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

/** One plate, described rather than written out ten times. */
interface Card {
  key: string
  /** The glyph to draw, or `null` for a plate that carries a colour instead of an icon. */
  icon: string | null
  /** The colour of the dot a plate without an icon draws. */
  dotHex?: string
  label: string
  value: string
  /**
   * A second figure printed beside the first, in the presence green: who is on the site right now. Empty
   * on every plate but the population's, which is the one it belongs to.
   */
  aside?: string
  /** The class the figure is set in, so a rating keeps its own colour. */
  valueClass?: string
  hint: string
  /** The colour the hint is set in, which is how a name keeps its class colour. */
  hintHex?: string
  /** Where the plate leads, when it names a player. */
  href?: string
}

/** The leader figures of the aggregate, which are the plates that stand for one figure each. */
type FigureField = 'pets' | 'architect' | 'toys' | 'mounts' | 'reputations' | 'titles' | 'transmogs'

/**
 * The figures the row prints a leader for, in the order the plates are drawn, each with the glyph and the words it
 * is known by.
 *
 * One list rather than seven plates written out: every one of them is the leader of one figure, read from the
 * aggregate's own field of that name, and the only thing that differs between them is how they are named. The field
 * is spelled as the aggregate spells it, so a figure the aggregate stops answering for is a plate that stops
 * compiling rather than a plate of dashes.
 */
const FIGURES: Array<{ field: FigureField; icon: string; label: string }> = [
  { field: 'pets', icon: 'pets', label: 'lbStatPets' },
  { field: 'architect', icon: 'decor', label: 'lbStatArchitect' },
  { field: 'toys', icon: 'toys', label: 'lbStatToys' },
  { field: 'mounts', icon: 'mounts', label: 'lbStatMounts' },
  { field: 'reputations', icon: 'exalted-rep', label: 'lbStatReputations' },
  { field: 'titles', icon: 'titles', label: 'lbStatTitles' },
  { field: 'transmogs', icon: 'transmogs', label: 'lbStatTransmogs' }
]

const cards = computed<Card[]>(() => {
  const stats = props.stats
  const leader = stats?.collector
  const topClass = stats?.topClass

  const nameOf = (player?: LeaderboardPlayer | null) =>
    player ? `${player.displayName} · ${realmLabel(player.region, player.realm, player.realmName)}` : DASH

  /** The plate of one figure's leader, which is the same plate seven times over. */
  const figureCard = (figure: { field: FigureField; icon: string; label: string }): Card => {
    const top = stats?.[figure.field] || null

    return {
      key: figure.field,
      icon: figure.icon,
      label: t(figure.label),
      value: top ? formatNumber(top.value) : DASH,
      hint: top ? nameOf(top.player) : DASH,
      hintHex: top ? classById(top.player.classId)?.hex : undefined,
      href: top ? profileUrl(top.player) : undefined
    }
  }

  return [
    {
      key: 'players',
      icon: 'user',
      label: t('lbStatPlayers'),
      value: stats ? formatNumber(stats.players) : DASH,
      aside: stats && props.online ? t('lbOnlineNow', { count: formatNumber(props.online) }) : '',
      hint: stats
        ? t('lbStatPlayersHint', { realms: formatNumber(stats.realms), classes: formatNumber(stats.classes) })
        : DASH
    },
    {
      key: 'collector',
      icon: 'mounts',
      label: t('lbStatCollector'),
      value: leader ? formatNumber(leader.value) : DASH,
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
        ? t('lbStatClassHint', { share: topClass.share, count: formatNumber(topClass.count) })
        : DASH
    },
    ...FIGURES.map(figureCard)
  ]
})
</script>

<template>
  <!-- Ten plates, five to a row from `lg` up: the lead of the row is a mark and a name, so the row is read as marks
       before any of them is read as words. Below that they come two to a row, which leaves a phone with a plate it
       can read rather than a grid of truncated words. -->
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
      <!-- The plate's title row: the glyph the plate is known by, then the words. The glyph is twice
           the size of the label it stands before, so the row is a mark and a name rather than a name
           with something in front of it - and `items-center` with `leading-none` on the row is what
           keeps the words on the glyph's own centre line however tall the glyph gets. -->
      <p class="flex items-center gap-2 text-[11px] font-semibold uppercase leading-none tracking-wider text-gray-400">
        <AppIcon v-if="card.icon" :name="card.icon" class="h-[2.2em] w-[2.2em]" />
        <span
          v-else
          class="inline-block h-[1.7em] w-[1.7em] shrink-0 rounded-full"
          :style="{ backgroundColor: card.dotHex || 'rgba(255,255,255,0.25)' }"
          aria-hidden="true"
        ></span>
        <span class="truncate">{{ card.label }}</span>
      </p>

      <p class="mt-2 flex items-baseline gap-2">
        <span
          class="truncate text-2xl font-extrabold leading-tight sm:text-3xl"
          :class="card.valueClass || 'text-white'"
          :title="card.value"
        >{{ card.value }}</span>

        <!-- Who is on the site right now, beside the population the plate counts: the same green the
             table's own dots wear, so the plate and the rows read as one fact rather than two. -->
        <span
          v-if="card.aside"
          class="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-emerald-400"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
          {{ card.aside }}
        </span>
      </p>

      <p
        class="mt-1 truncate text-xs text-gray-400"
        :style="card.hintHex ? { color: card.hintHex } : undefined"
        :title="card.hint"
      >{{ card.hint }}</p>
    </component>
  </div>
</template>
