<script setup lang="ts">
/**
 * The filter bar above the table: what the table is ordered by, and who is in it.
 *
 * It holds no state of its own - every control writes straight through to the page's filters, and
 * the answer comes back from the endpoint - so the bar cannot drift out of step with the table it
 * is filtering. The choices a reader may make are read off the same aggregate the widgets print
 * (`stats.realmsFacet`, `stats.factionsFacet`), which is what keeps the bar from ever offering a
 * filter that would empty the table: a realm nobody has been looked up on simply is not in the list.
 *
 * The presets are the page's five tabs; the chips are the one-click filters. Both are drawn from
 * the site's own glass: `.hoa-tab` for a tab's layout, `.hoa-liquid-glass` for the material a
 * control wears (see `main.css`), and the brand gold for whatever is currently chosen.
 */
import { FILTERABLE_FACTIONS } from '#shared/utils/wow-faction'
import type {
  LeaderboardFaction,
  LeaderboardSort,
  LeaderboardStats
} from '#shared/data/leaderboardSchema'

const props = defineProps<{
  faction: LeaderboardFaction | 'all'
  realm: string
  search: string
  /** The columns the table is showing, which these chips switch on and off. */
  columns: LeaderboardSort[]
  /** The aggregate behind the widgets, which is also where the filter choices come from. */
  stats: LeaderboardStats | null
}>()

const emit = defineEmits<{
  (event: 'update:faction', value: LeaderboardFaction | 'all'): void
  (event: 'update:realm', value: string): void
  (event: 'update:search', value: string): void
  (event: 'toggle-column', value: LeaderboardSort): void
}>()

const { t } = useI18n()
// A record stores the realm's name in the language its profile was read in, so the names a reader
// sees are taken from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/**
 * The columns a reader can show or hide, in the order the chips are drawn.
 *
 * A chip is a column, and a column is one of the figures the endpoint already knows how to order by,
 * so the three cannot drift apart: the chips, the table's own headers and the sort the API accepts
 * are the same list of names. The names in between are the site's own, so a reader who has met a
 * "mount lord" in the table knows which column the chip turns on.
 */
const COLUMN_CHIPS: { key: LeaderboardSort; icon: string; label: string; literal?: boolean }[] = [
  { key: 'total', icon: 'emblem', label: 'lbPresetTotal' },
  { key: 'mounts', icon: 'mounts', label: 'lbPresetMounts' },
  { key: 'pets', icon: 'pets', label: 'pets' },
  { key: 'toys', icon: 'toys', label: 'toys' },
  { key: 'decor', icon: 'decor', label: 'lbPresetDecor' },
  { key: 'mplus', icon: 'key', label: 'lbPresetMplus' },
  { key: 'achievements', icon: 'achievments', label: 'lbPresetAchievements' },
  { key: 'ilvl', icon: 'item-level', label: 'ilvl', literal: true }
]

/**
 * Whether a column's chip is lit.
 *
 * The overall chip is lit on its own while the table shows everything, and the others are lit only
 * once the table has stepped out of that state - which is the two-state model the row reads as
 * (`app/composables/leaderboardView.ts`).
 */
function isShown(key: LeaderboardSort): boolean {
  if (key === 'total') return props.columns.includes('total')
  return !props.columns.includes('total') && props.columns.includes(key)
}

/**
 * The realms a reader may pick, as the aggregate offers them, each named in the language being read
 * rather than in the language of whichever profile wrote the record down first.
 */
const realms = computed(() =>
  (props.stats?.realmsFacet || []).map((entry) => ({
    ...entry,
    label: realmLabel(entry.region, entry.realm, entry.realmName)
  }))
)

/** The realm the table is narrowed to, as the button reads it. */
const chosenRealm = computed(() => realms.value.find((entry) => entry.realm === props.realm) || null)

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

/**
 * Whether the realm menu is open, and the element a click has to land outside of to shut it. The
 * panel behaves the way the collections menu and the front page's realm field do - a click on the
 * tab toggles it, a click anywhere else, Escape or a pick closes it - because a reader has met all
 * three and should not have to learn a fourth.
 */
const realmOpen = ref(false)
const realmRoot = ref<HTMLElement | null>(null)

function onDocumentClick(event: MouseEvent): void {
  if (!realmRoot.value?.contains(event.target as Node)) realmOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') realmOpen.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

/** Picks a realm and shuts the menu. An empty slug is "every realm", which is the first row. */
function pickRealm(slug: string): void {
  emit('update:realm', slug)
  realmOpen.value = false
}

/** Whether anything is narrowing the table, which is what the reset button appears for. */
const filtered = computed(
  () => props.faction !== 'all' || Boolean(props.realm) || Boolean(props.search.trim())
)

/** Drops every narrowing choice, leaving the overall table and the preset alone. */
function clear() {
  emit('update:faction', 'all')
  emit('update:realm', '')
  emit('update:search', '')
}
</script>

<template>
  <!-- `relative z-20` is what keeps the realm menu over the table below it: the panel is a stacking
       context of its own (the frosted background is one), so a `z-50` on the menu inside it only
       counts within the panel - the panel itself has to be lifted. -->
  <div class="hoa-panel relative z-20 space-y-3 p-3 sm:p-4">
    <!-- The columns, and the search box that narrows whatever they show. A chip is a switch rather
         than a tab: several can be on at once, each one keeps its column in the table and takes it
         away again, which is what lets a reader put two figures side by side and drop the rest. -->
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex flex-wrap gap-2" role="group" :aria-label="t('lbColumns')">
        <button
          v-for="chip in COLUMN_CHIPS"
          :key="chip.key"
          type="button"
          :aria-pressed="isShown(chip.key)"
          class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs sm:text-sm"
          :class="isShown(chip.key) ? 'hoa-tab-active' : ''"
          @click="emit('toggle-column', chip.key)"
        >
          <AppIcon :name="chip.icon" class="h-[1.05em] w-[1.05em]" />
          <span>{{ chip.literal ? chip.label : t(chip.label) }}</span>
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

      <!-- The realm: a menu of the site's own rather than a native `<select>`, because a native one
           paints the operating system's list - a white menu with an arrow of its own, dropped into a
           dark page. This is the panel the front page's realm field opens (`app/pages/index.vue`):
           the same glass, the same rows, the same gold for what is chosen. -->
      <div ref="realmRoot" class="relative">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
          :class="realm
            ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
            : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
          aria-haspopup="true"
          :aria-expanded="realmOpen"
          @click="realmOpen = !realmOpen"
        >
          <span>{{ chosenRealm ? chosenRealm.label : t('lbAllRealms') }}</span>
          <!-- The chevron the collections menu wears, turned over while the menu is open. -->
          <svg
            class="h-4 w-4 shrink-0 transition-transform duration-200"
            :class="realmOpen ? 'rotate-180' : ''"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
          </svg>
        </button>

        <!-- Shut, the panel is invisible rather than absent, so the realms it offers are in the markup
             a crawler reads. It paints above the table below it, which is what `z-50` is for. -->
        <div
          class="absolute left-0 top-full z-50 mt-2 max-h-72 w-64 overflow-y-auto rounded-xl border border-white/10 bg-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150 transition-opacity duration-150"
          :class="realmOpen ? 'opacity-100' : 'invisible opacity-0'"
          role="menu"
        >
          <p class="sticky top-0 border-b border-white/5 bg-black/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 backdrop-blur-xl">
            {{ t('realm') }}
          </p>

          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center px-4 py-2 text-left text-sm font-medium transition-colors"
            :class="!realm ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
            @click="pickRealm('')"
          >{{ t('lbAllRealms') }}</button>

          <button
            v-for="option in realms"
            :key="`${option.region}:${option.realm}`"
            type="button"
            role="menuitem"
            class="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-medium transition-colors"
            :class="realm === option.realm ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
            @click="pickRealm(option.realm)"
          >
            <span class="truncate">{{ option.label }}</span>
            <span class="shrink-0 text-xs text-gray-500">{{ option.region.toUpperCase() }} · {{ option.count }}</span>
          </button>
        </div>
      </div>

      <button
        v-if="filtered"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:text-white"
        @click="clear()"
      >{{ t('lbReset') }}</button>
    </div>

  </div>
</template>
