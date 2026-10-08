<script setup lang="ts">
/**
 * The filter bar above the table: what the table is ordered by, and who is in it.
 *
 * It holds no state of its own - every control writes straight through to the page's filters, and
 * the answer comes back from the endpoint - so the bar cannot drift out of step with the table it
 * is filtering. The choices a reader may make are read off the same aggregate the widgets print
 * (`stats.realmsFacet`, `stats.classesFacet`, `stats.factionsFacet`), which is what keeps the bar
 * from ever offering a filter that would empty the table: a realm nobody has been looked up on
 * simply is not in the list.
 *
 * The presets are the page's five tabs; the chips are the one-click filters. Both are drawn from
 * the site's own glass: `.hoa-tab` for a tab's layout, `.hoa-liquid-glass` for the material a
 * control wears (see `main.css`), and the brand gold for whatever is currently chosen.
 */
import { classById } from '#shared/utils/wow-class'
import { FILTERABLE_FACTIONS } from '#shared/utils/wow-faction'
import type {
  LeaderboardFaction,
  LeaderboardSort,
  LeaderboardStats
} from '#shared/data/leaderboardSchema'

const props = defineProps<{
  sort: LeaderboardSort
  faction: LeaderboardFaction | 'all'
  realm: string
  classId: number | 'all'
  search: string
  /** The aggregate behind the widgets, which is also where the filter choices come from. */
  stats: LeaderboardStats | null
}>()

const emit = defineEmits<{
  (event: 'update:sort', value: LeaderboardSort): void
  (event: 'update:faction', value: LeaderboardFaction | 'all'): void
  (event: 'update:realm', value: string): void
  (event: 'update:class', value: number | 'all'): void
  (event: 'update:search', value: string): void
}>()

const { locale, t } = useI18n()

/** The five presets, each naming the figure it orders the table by. */
const PRESETS: { sort: LeaderboardSort; icon: string; label: string }[] = [
  { sort: 'total', icon: 'emblem', label: 'lbPresetTotal' },
  { sort: 'mounts', icon: 'mounts', label: 'lbPresetMounts' },
  { sort: 'decor', icon: 'decor', label: 'lbPresetDecor' },
  { sort: 'mplus', icon: 'key', label: 'lbPresetMplus' },
  { sort: 'achievements', icon: 'achievments', label: 'lbPresetAchievements' }
]

/** The realm and the class a reader may pick, as the aggregate offers them. */
const realms = computed(() => props.stats?.realmsFacet || [])
const classes = computed(() => props.stats?.classesFacet || [])

/**
 * The faction chips: "all" first, then the two sides, each named in the language being read and
 * wearing its own colour. The list is built here rather than in the template so that the chips and
 * the badges in the table below read the same table of colours (`#shared/utils/wow-faction`).
 */
const factionOptions = computed(() => [
  { id: 'all' as const, hex: '#f8b700', label: t('lbAll') },
  ...FILTERABLE_FACTIONS.map((faction) => ({
    id: faction.id,
    hex: faction.hex,
    label: t(faction.labelKey)
  }))
])

/** How many players a faction choice would leave. */
function factionCount(faction: LeaderboardFaction | 'all'): number {
  if (faction === 'all') return props.stats?.players || 0
  return props.stats?.factionsFacet.find((entry) => entry.faction === faction)?.count || 0
}

/** A class's name in the language being read. */
function className(classId: number): string {
  const entry = classById(classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
}

/** Whether anything is narrowing the table, which is what the reset button appears for. */
const filtered = computed(
  () =>
    props.faction !== 'all' ||
    Boolean(props.realm) ||
    props.classId !== 'all' ||
    Boolean(props.search.trim())
)

/** Drops every narrowing choice, leaving the overall table and the preset alone. */
function clear() {
  emit('update:faction', 'all')
  emit('update:realm', '')
  emit('update:class', 'all')
  emit('update:search', '')
}
</script>

<template>
  <div class="hoa-panel space-y-3 p-3 sm:p-4">
    <!-- The presets, and the search box that narrows whatever preset is chosen. -->
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('lbPresets')">
        <button
          v-for="preset in PRESETS"
          :key="preset.sort"
          type="button"
          role="tab"
          :aria-selected="sort === preset.sort"
          class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs sm:text-sm"
          :class="sort === preset.sort ? 'hoa-tab-active' : ''"
          @click="emit('update:sort', preset.sort)"
        >
          <AppIcon :name="preset.icon" class="h-[1.05em] w-[1.05em]" />
          <span>{{ t(preset.label) }}</span>
        </button>
      </div>

      <label class="relative block w-full lg:w-72">
        <span class="sr-only">{{ t('lbSearch') }}</span>
        <svg
          class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          :value="search"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('lbSearchPlaceholder')"
          class="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-wow-gold/60 focus:outline-none"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <!-- The one-click filters: which side, which realm. -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="option in factionOptions"
        :key="option.id"
        type="button"
        :aria-pressed="faction === option.id"
        class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
        :class="faction === option.id
          ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
          : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
        @click="emit('update:faction', option.id)"
      >
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :style="{ backgroundColor: option.hex }"
          aria-hidden="true"
        ></span>
        <span>{{ option.label }}</span>
        <span class="text-gray-500">{{ factionCount(option.id) }}</span>
      </button>

      <select
        :value="realm"
        :aria-label="t('realm')"
        class="rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-semibold text-gray-200 focus:border-wow-gold/60 focus:outline-none"
        @change="emit('update:realm', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('lbAllRealms') }}</option>
        <option
          v-for="option in realms"
          :key="`${option.region}:${option.realm}`"
          :value="option.realm"
        >{{ option.realmName }} · {{ option.region.toUpperCase() }} ({{ option.count }})</option>
      </select>

      <button
        v-if="filtered"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:text-white"
        @click="clear()"
      >{{ t('lbReset') }}</button>
    </div>

    <!-- The classes, each chip wearing its own colour, which is the legend of the table below. -->
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="option in classes"
        :key="option.classId"
        type="button"
        :aria-pressed="classId === option.classId"
        class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors"
        :style="classId === option.classId
          ? {
              borderColor: `${classById(option.classId)?.hex || '#f8b700'}99`,
              backgroundColor: `${classById(option.classId)?.hex || '#f8b700'}1f`,
              color: classById(option.classId)?.hex || '#f8b700'
            }
          : {
              borderColor: 'rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.04)',
              color: classById(option.classId)?.hex || '#f8b700'
            }"
        @click="emit('update:class', classId === option.classId ? 'all' : option.classId)"
      >
        <span>{{ className(option.classId) }}</span>
        <span class="opacity-60">{{ option.count }}</span>
      </button>
      <span v-if="!classes.length" class="text-xs text-gray-500">{{ t('lbNoClasses') }}</span>
    </div>
  </div>
</template>
