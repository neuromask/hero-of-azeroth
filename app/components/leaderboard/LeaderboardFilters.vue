<script setup lang="ts">
/**
 * The bar above a table: which ranking is being read, and who is in it.
 *
 * It is one component on every page that carries it - the front door's hub and every ranking of the site - because
 * the two answer the same kind of question and a reader should not have to learn a second bar to look at a second
 * table. What it opens with is the site's *rankings*: the thirteen figures it ranks, one link each
 * (`METRIC_LEADERBOARDS`), parted from the filters under them by a hairline of the brand gold. A row of column chips
 * used to stand there, switching figures on and off inside the one table below; a table of its own per figure turned
 * out to be the thing readers actually wanted, so the same row now walks from table to table.
 *
 * Under the line are the filters: which side, which region, which realm, and a fragment of a name - and, wherever
 * the score is what the table shows, the legend of that figure beside the field. A page with no table under the bar
 * wears the menu alone (`filters`, which the front door says of itself).
 *
 * It holds no state of its own - every control writes straight through to the page, and the answer comes back from
 * the endpoint - so the bar cannot drift out of step with the table it is filtering. The choices a reader may make
 * are read off the aggregate the widgets print (`stats.realmsFacet`, `stats.factionsFacet`), which is what keeps
 * the bar from ever offering a filter that would empty the table: a realm nobody has been looked up on simply is
 * not in the list. What the pages hand it differs in *meaning* rather than in shape - on a ranking the region and
 * the realm are the address, so a press there is a step to another page, while a bar with no table under it has no
 * narrowing state to hand over at all - and that difference is the page's own.
 *
 * Everything is drawn from the site's own glass: `.hoa-tab` for a tab's layout, `.hoa-liquid-glass` for the
 * material a control wears (see `main.css`), and the brand gold for whatever is currently chosen.
 */
import { FILTERABLE_FACTIONS } from '#shared/utils/wow-faction'
import { formatNumber } from '#shared/utils/formatNumber'
import { METRIC_LEADERBOARDS } from '#shared/data/leaderboardSchema'
import type {
  LeaderboardFaction,
  LeaderboardFactionFacet,
  LeaderboardRealmFacet,
  MetricLeaderboardScope,
  MetricLeaderboardSlug
} from '#shared/data/leaderboardSchema'

const props = withDefaults(
  defineProps<{
    /**
     * Whether this page has filters at all.
     *
     * True on every page a table stands on, and false on the front door, which draws no table: there the bar is the
     * site's tables as one menu and nothing else, so the line under it - and the controls a reader narrows a table
     * with - is left out rather than drawn over nothing (`app/pages/index.vue`). A page that has a table says nothing
     * about it; the one page that has none is the one that says so.
     */
    filters?: boolean
    /** The side the table is narrowed to, or absent while the page has no table to narrow. */
    faction?: LeaderboardFaction | 'all'
    /** The region the table is narrowed to (`eu`, `us`), or `''` for every region. */
    region?: string
    realm?: string
    search?: string
    /**
     * The ranking this bar stands on, or `null` on a page that is not a ranking - the front door - which lights no
     * entry of the menu at all.
     */
    current?: MetricLeaderboardSlug | null
    /**
     * The scope the menu's own links keep, so a press from a ranking stays on the reader's realm and only the figure
     * changes. The front door hands over nothing, which is the world.
     */
    scope?: MetricLeaderboardScope
    /** How many members the population holds, which is what the "everybody" chip prints. */
    players?: number
    /** The realms a reader may pick, and how many members each of them holds. */
    realmsFacet?: LeaderboardRealmFacet[]
    /** The sides the population is split over. Empty on a page that does not count them, which hides the numbers. */
    factionsFacet?: LeaderboardFactionFacet[]
    /** Whether the legend of the score is offered beside the search field, which is where that figure is explained. */
    legend?: boolean
  }>(),
  // Every page but the front door has a table under this bar, so the filters are what the bar draws unless a page
  // says otherwise - and the one page that says otherwise is the one with no rows to narrow.
  { filters: true }
)

const emit = defineEmits<{
  (event: 'update:faction', value: LeaderboardFaction | 'all'): void
  (event: 'update:region', value: string): void
  (event: 'update:realm', value: string): void
  (event: 'update:search', value: string): void
}>()

const { t } = useI18n()
// The menu's links are addresses of the site rather than of the front door, and the language a reader is in is part
// of the address (`/ru/leaderboards/...`), so they are built the way every other link of the site is.
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the names a reader
// sees are taken from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/**
 * The site's rankings, as one menu: the thirteen figures the site ranks (`METRIC_LEADERBOARDS`), each an address of
 * its own with a page behind it and a link a crawler can follow.
 *
 * This row used to be the column chips - nine switches that turned figures on and off inside the one table below -
 * and it is now the way from one *table* to another, which is a press rather than a state: a reader who wants to see
 * the pets of their realm rather than its achievement points is one press away instead of one filter away. The links
 * keep the scope the page is drawn for (`scope`), so the menu never drops a reader out of their own realm.
 *
 * The hall of fame is deliberately *not* an entry. It is not a ranking - it is the page the site is summed up on -
 * and it is already named by the site's own navigation, which every page wears (`app/components/SiteNav.vue`): a menu
 * of tables is no place for a page that is not one. What a page tells the menu is which ranking it is reading
 * (`current`), and a page that is reading none - the front door - lights none of them.
 */
const menu = computed(() =>
  METRIC_LEADERBOARDS.map((entry) => ({
    key: entry.slug,
    to: localeUrl(metricLeaderboardPath(entry.slug, props.scope || {})),
    icon: entry.icon,
    labelKey: entry.labelKey,
    current: entry.slug === props.current
  }))
)

/** The regions the table can be narrowed to, in the order the chips are drawn. */
const regionOptions = computed(() => [
  { id: '', label: t('lbAllRegions'), hex: '#9ca3af' },
  { id: 'eu', label: t('europe'), hex: '#60a5fa' },
  { id: 'us', label: t('america'), hex: '#f472b6' }
])

/**
 * What the controls read as chosen, which is also what they fall back to when a page leaves one of them out.
 *
 * A page that draws no filters at all - the front door - is a page with no narrowing state to hand over, so the
 * four of them arrive absent and read as the state a table opens in: everybody, every region, every realm, no name.
 * That is what keeps a bar of links from being told about a table it is not standing on, and it is why they are read
 * here rather than checked in each control.
 */
const chosenFaction = computed<LeaderboardFaction | 'all'>(() => props.faction || 'all')
const chosenRegion = computed(() => props.region || '')
const chosenRealmSlug = computed(() => props.realm || '')
const chosenSearch = computed(() => props.search || '')

/**
 * The realms a reader may pick, each named in the language being read rather than in the language of whichever
 * profile wrote the record down first.
 *
 * The facet is handed in rather than read off one aggregate, because the two pages that wear this bar count
 * different populations: the front door offers every realm the table holds (`LeaderboardStats.realmsFacet`), and
 * a metric leaderboard offers the realms its own ranking holds members in. What both are for is the same: a menu
 * that never leads to an empty table - which is also why a region, once it has been chosen, leaves only its own
 * realms on this menu. A realm of another region under a region chip is a pair no row can satisfy, and a reader
 * would have to find their way back out of a table with nothing in it.
 */
const realms = computed(() =>
  (props.realmsFacet || [])
    .filter((entry) => !chosenRegion.value || entry.region === chosenRegion.value)
    .map((entry) => ({
      ...entry,
      label: realmLabel(entry.region, entry.realm, entry.realmName)
    }))
)

/** The realm the table is narrowed to, as the button reads it. */
const chosenRealm = computed(() => realms.value.find((entry) => entry.realm === chosenRealmSlug.value) || null)

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

/** How many players a faction choice would leave, or `null` where the page does not count them. */
function factionCount(faction: LeaderboardFaction | 'all'): number | null {
  if (faction === 'all') return props.players ?? null
  return (props.factionsFacet || []).find((entry) => entry.faction === faction)?.count ?? null
}

/**
 * The one panel this bar opens itself - the realm menu - and the element a click has to land outside of
 * to shut it. It behaves the way the collections menu does: a click on the control toggles it, a click
 * anywhere else, Escape or a pick closes it. The legend of the score, the bar's other panel, keeps its
 * own open state inside the component that draws it (`app/components/ScoreLegend.vue`).
 */
const realmOpen = ref(false)
const realmRoot = ref<HTMLElement | null>(null)

function onDocumentClick(event: MouseEvent): void {
  const target = event.target as Node
  if (!realmRoot.value?.contains(target)) realmOpen.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  realmOpen.value = false
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

/**
 * Whether anything is narrowing the table, which is what the reset button appears for.
 *
 * The region and the realm are narrowing choices wherever the bar is worn, even where they are also the address:
 * a reader standing on a realm's ranking is looking at the table of that one realm, and the way back to the whole
 * figure - "every realm", the world's ranking - is a narrowing choice like any other. The button is the one press
 * that undoes them all at once.
 */
const filtered = computed(
  () =>
    chosenFaction.value !== 'all' ||
    Boolean(chosenRegion.value) ||
    Boolean(chosenRealmSlug.value) ||
    Boolean(chosenSearch.value.trim())
)

/**
 * Drops every narrowing choice, leaving the table the address names alone.
 *
 * What the page does with each answer is the page's own: on the front door the region and the realm are filters
 * over one table, and on a ranking they are the address, so clearing them there is a step back to the world's
 * ranking - the same step the "every realm" row of the realm menu takes (`pickRealm('')`).
 */
function clear() {
  emit('update:faction', 'all')
  emit('update:region', '')
  emit('update:realm', '')
  emit('update:search', '')
}
</script>

<template>
  <!-- `relative z-20` is what keeps the realm menu over the table below it: the panel is a layer of its
       own, so a `z-50` on the menu inside it only counts within the panel - the panel itself has to be
       lifted. The panel's frost is drawn by a layer rather than by the panel (`hoa-panel-layered`), so
       the two panes it opens - the realm menu and the legend of the score - are not cut off from the
       page behind them and blur what they hang over. -->
  <div class="hoa-panel hoa-panel-layered relative z-20 space-y-3 p-3 sm:p-4">
    <!-- The menu of tables, above everything: it is where a reader goes instead of here, so it leads the block
         rather than standing among the controls that change what this table holds. -->
    <nav class="flex flex-wrap items-center gap-2" :aria-label="t('lbMetricMenu')">
      <template v-for="item in menu" :key="item.key">
        <NuxtLink
          v-if="!item.current"
          :to="item.to"
          class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs sm:text-sm"
        >
          <AppIcon :name="item.icon" class="h-[1.05em] w-[1.05em]" />
          <span>{{ t(item.labelKey) }}</span>
        </NuxtLink>
        <span v-else class="hoa-tab hoa-tab-active px-3 py-1.5 text-xs sm:text-sm" aria-current="page">
          <AppIcon :name="item.icon" class="h-[1.05em] w-[1.05em]" />
          <span>{{ t(item.labelKey) }}</span>
        </span>
      </template>
    </nav>

    <!-- And the line that parts them from the filters, and the filters themselves - which a page with no table does
         not wear (`filters`): the front door opens with the menu, so a line under it would part it from nothing. -->
    <div
      v-if="filters"
      class="h-px bg-gradient-to-r from-wow-gold/50 via-white/15 to-transparent"
      aria-hidden="true"
    />

    <!-- The one-click filters: which side, which region, which realm, and a name. -->
    <div v-if="filters" class="flex flex-wrap items-center gap-2">
      <button
        v-for="option in factionOptions"
        :key="option.id"
        type="button"
        :aria-pressed="chosenFaction === option.id"
        class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
        :class="chosenFaction === option.id
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
        <!-- The number of members a chip would leave, where the page counts them: a metric leaderboard's bar
             counts only the ranking's own population, and a page that has not counted the sides prints the chips
             without a figure rather than a nought. -->
        <span v-if="factionCount(option.id) !== null" class="whitespace-nowrap text-gray-500">
          {{ formatNumber(factionCount(option.id) as number) }}
        </span>
      </button>

      <!-- The regions, beside the sides: a region is the other half of where a row is, and on a page whose table is
           one figure it is the scope the address names rather than a filter - which is the page's own business
           (`app/components/leaderboard/MetricLeaderboard.vue` picks an address, the front door sets a filter). -->
      <span class="hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true"></span>

      <button
        v-for="option in regionOptions"
        :key="option.id || 'all'"
        type="button"
        :aria-pressed="region === option.id"
        class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
        :class="region === option.id
          ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
          : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
        @click="emit('update:region', option.id)"
      >
        <span class="h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: option.hex }" aria-hidden="true"></span>
        <span>{{ option.label }}</span>
      </button>

      <span class="hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true"></span>

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
             a crawler reads. What it is drawn as - the glass, the deep shadow under it and the layer
             that keeps it over the table below - is the site's menu pane (`.hoa-pop`), and the band
             its heading stays at the top in is that pane's own (`.hoa-pop-title`). -->
        <div
          class="hoa-pop absolute left-0 top-full mt-2 w-64 transition-opacity duration-150"
          :class="realmOpen ? 'opacity-100' : 'invisible opacity-0'"
          role="menu"
        >
          <div class="max-h-72 overflow-y-auto">
            <p class="hoa-pop-title">
              {{ t('realm') }}
            </p>

            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
              :class="!chosenRealmSlug ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
              @click="pickRealm('')"
            >{{ t('lbAllRealms') }}</button>

            <button
              v-for="option in realms"
              :key="`${option.region}:${option.realm}`"
              type="button"
              role="menuitem"
              class="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm font-normal transition-colors"
              :class="chosenRealmSlug === option.realm ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
              @click="pickRealm(option.realm)"
            >
              <span class="truncate">{{ option.label }}</span>
              <span class="shrink-0 whitespace-nowrap text-xs text-gray-500">{{ option.region.toUpperCase() }} · {{ formatNumber(option.count) }}</span>
            </button>
          </div>
        </div>
      </div>

      <button
        v-if="filtered"
        type="button"
        class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:text-white"
        @click="clear()"
      >{{ t('lbReset') }}</button>

      <!-- And the search for a name: it narrows the table rather than being a filter chip, so it stands at the far
           end of the row (`lg:ml-auto`), where a narrowing field belongs, and it keeps the whole width of a phone
           (`w-full`) rather than a corner of it. -->
      <label class="relative block w-full lg:ml-auto lg:w-72">
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
          :value="chosenSearch"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('lbSearchPlaceholder')"
          class="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-wow-gold/60 focus:outline-none"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <!-- The legend of the overall score, right after the field: a reader who wonders what the gold figure in the
           table is made of has the answer one press away, and it stands beside the way they narrow the table rather
           than in a corner of its own. The control is the profile's own as well - one component, one table of
           weights, read off the formula itself (`app/components/ScoreLegend.vue`) - and it is only offered where the
           score is what the table shows. -->
      <ScoreLegend v-if="legend" />
    </div>

  </div>
</template>
