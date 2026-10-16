<script setup lang="ts">
/**
 * The population's own figures, as the second row of the front door: where it lives, what it plays, and what it has
 * gathered between them.
 *
 * The ten plates above are about *members* - one leader each - and this block is about the population as a whole,
 * which is the other half of what a hall of fame is: how many of them stand on each realm, which class they wear,
 * which side they play for, and what they have collected between them. Everything here is read off the one aggregate
 * the plates read (`/api/leaderboard/stats`), and none of it is computed twice: the shares are arithmetic on counts
 * the server already gathered, and the date under the totals is the day the table behind it was last written.
 *
 * The realm rows are **links**, and they are the reason this block is a hub rather than a wall of numbers: a realm a
 * reader sees their own on is a place they can go to, and where they go is the ranking of the overall rating *for
 * that realm* (`/leaderboards/score/<region>/<realm>`) - the same table the front door's plate is about, at the
 * place the row names. So the front door answers "who is where" and hands the reader the table of that where.
 *
 * A population with nobody on a realm, or nobody of a class, simply lists fewer rows: a row that would print a
 * nought is not drawn at all.
 */
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { FILTERABLE_FACTIONS } from '#shared/utils/wow-faction'
import { metricLeaderboardPath } from '~/composables/metricLeaderboard'
import { formatNumber } from '#shared/utils/formatNumber'
import type { LeaderboardStats } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The aggregate the plates above are read from, or `null` before the answer has landed. */
  stats: LeaderboardStats | null
  /** True while a fresh answer is on its way, which dims the block rather than emptying it. */
  pending?: boolean
}>()

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the names here are taken from the
// site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** How many rows a panel lists. Past this a reader is hunting rather than reading, and the ranking is where they go. */
const ROWS = 6

/** A class's name in the language being read. The id is the same in every language, the word is not. */
function className(classId: number): string {
  const entry = classById(classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
}

/**
 * The realms the population is spread over, most-populated first, each with a bar measured against the largest.
 *
 * The bar is scaled to the top realm rather than to the whole population, because what a reader compares here is one
 * realm with another - and the count of members is printed beside it either way.
 */
const realms = computed(() => {
  const top = (props.stats?.realmsFacet || []).slice(0, ROWS)
  const most = top[0]?.count || 0

  return top.map((entry) => ({
    key: `${entry.region}:${entry.realm}`,
    label: realmLabel(entry.region, entry.realm, entry.realmName),
    region: entry.region.toUpperCase(),
    count: entry.count,
    width: most ? Math.round((entry.count / most) * 100) : 0,
    to: localeUrl(metricLeaderboardPath('score', { region: entry.region, realm: entry.realm }))
  }))
})

/** The classes the population plays, most-played first, in the colour the game's own UI gives each of them. */
const classes = computed(() => {
  const total = props.stats?.players || 0
  const top = (props.stats?.classesFacet || []).slice(0, ROWS)
  const most = top[0]?.count || 0

  return top.map((entry) => ({
    key: String(entry.classId),
    label: className(entry.classId),
    hex: classById(entry.classId)?.hex || DEFAULT_CLASS_HEX,
    count: entry.count,
    width: most ? Math.round((entry.count / most) * 100) : 0,
    share: total ? Math.round((entry.count / total) * 100) : 0
  }))
})

/** The sides the population plays for, in the order the filter chips list them: Alliance, Horde, then the rest. */
const factions = computed(() => {
  const total = props.stats?.players || 0
  const counted = props.stats?.factionsFacet || []

  return FILTERABLE_FACTIONS.map((faction) => {
    const count = counted.find((entry) => entry.faction === faction.id)?.count || 0
    return {
      key: faction.id,
      label: t(faction.labelKey),
      hex: faction.hex,
      count,
      share: total ? Math.round((count / total) * 100) : 0
    }
  }).filter((side) => side.count > 0)
})

/**
 * What the whole population has gathered, as the figures the site ranks.
 *
 * A label and a figure rather than a sentence of them, because a sentence of figures needs the language's own plurals
 * ("1 234 mounts" against "1 234 маунта") and this is a table of totals rather than prose - and because the two words
 * a reader is comparing here are the same two words the rankings are named by.
 */
const gathered = computed(() => {
  const all = props.stats?.totals
  if (!all) return []

  return [
    { key: 'mounts', label: t('mounts'), value: all.mounts },
    { key: 'pets', label: t('pets'), value: all.pets },
    { key: 'toys', label: t('toys'), value: all.toys },
    { key: 'decor', label: t('decor'), value: all.decor },
    { key: 'reputations', label: t('reputations'), value: all.reputations },
    { key: 'achievements', label: t('achievements'), value: all.achievements }
  ]
})

/** The day the table behind these figures was last written, or nothing at all for a table nobody has read. */
const updatedAt = computed(() => props.stats?.updatedAt || '')

/** The heading of a panel: small, spaced, and quieter than the rows under it. */
const HEADING = 'text-[11px] font-semibold uppercase tracking-wider text-gray-400'
/** One row of a panel: the label, the bar it is measured by, and the figure itself. */
const ROW = 'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm'
</script>

<template>
  <div class="space-y-3" :class="pending ? 'opacity-70' : ''" :aria-busy="pending ? 'true' : undefined">
    <div class="grid gap-3 lg:grid-cols-3">
      <!-- Where the population lives. Every row is a link into the overall rating *of that realm*, which is what
           makes this a hub: the front door answers "who is where" and hands over the table of that where. -->
      <section class="hoa-panel p-3.5 sm:p-4">
        <p :class="HEADING">{{ t('lbBreakRealms') }}</p>

        <ul v-if="realms.length" class="mt-2 space-y-0.5">
          <li v-for="realm in realms" :key="realm.key">
            <NuxtLink
              :to="realm.to"
              :class="ROW"
              class="text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
              :title="`${realm.label} · ${realm.region}`"
            >
              <span class="w-24 shrink-0 truncate">{{ realm.label }}</span>
              <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
                <span class="block h-full rounded-full bg-wow-gold/70" :style="{ width: `${realm.width}%` }" />
              </span>
              <span class="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">
                {{ formatNumber(realm.count) }}
              </span>
            </NuxtLink>
          </li>
        </ul>

        <p v-else class="mt-2 py-1 text-xs text-gray-500">{{ t('noRealms') }}</p>
      </section>

      <!-- What the population plays, in the colour the game's own UI gives each class. -->
      <section class="hoa-panel p-3.5 sm:p-4">
        <p :class="HEADING">{{ t('lbBreakClasses') }}</p>

        <ul class="mt-2 space-y-0.5">
          <li v-for="entry in classes" :key="entry.key" :class="ROW">
            <span class="w-24 shrink-0 truncate font-semibold" :style="{ color: entry.hex }">{{ entry.label }}</span>
            <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5" aria-hidden="true">
              <span class="block h-full rounded-full" :style="{ width: `${entry.width}%`, backgroundColor: entry.hex }" />
            </span>
            <span class="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">
              {{ entry.share }}%
            </span>
          </li>
        </ul>
      </section>

      <!-- Which side they play for, as one bar and its legend: three facts that are only interesting against each
           other, so they are drawn as one thing rather than three rows. -->
      <section class="hoa-panel p-3.5 sm:p-4">
        <p :class="HEADING">{{ t('lbBreakFactions') }}</p>

        <div class="mt-3 flex h-2.5 overflow-hidden rounded-full bg-white/5" role="img"
             :aria-label="factions.map((side) => `${side.label} ${side.share}%`).join(', ')">
          <span
            v-for="side in factions"
            :key="side.key"
            class="h-full"
            :style="{ width: `${side.share}%`, backgroundColor: side.hex }"
          />
        </div>

        <ul class="mt-2 space-y-0.5">
          <li v-for="side in factions" :key="side.key" :class="ROW">
            <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: side.hex }" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-gray-200">{{ side.label }}</span>
            <span class="shrink-0 text-xs tabular-nums text-gray-400">
              {{ formatNumber(side.count) }} · {{ side.share }}%
            </span>
          </li>
        </ul>
      </section>
    </div>

    <!-- And what all of them have gathered between them, with the day the table behind it was last written: the
         figures a collection site is worth visiting for, and the honesty of saying how fresh they are. -->
    <section v-if="gathered.length" class="hoa-panel p-3.5 sm:p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p :class="HEADING">{{ t('lbBreakGathered') }}</p>
        <p v-if="updatedAt" class="text-[11px] text-gray-500">{{ t('lbUpdated', { date: updatedAt }) }}</p>
      </div>

      <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <div v-for="figure in gathered" :key="figure.key" class="min-w-0">
          <dt class="text-[11px] font-semibold uppercase tracking-wider text-wow-goldLight/80">{{ figure.label }}</dt>
          <dd class="truncate text-2xl font-extrabold leading-tight tabular-nums text-white">
            {{ formatNumber(figure.value) }}
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
