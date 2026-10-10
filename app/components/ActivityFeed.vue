<script setup lang="ts">
// The feed's own shape and the filters it is read through, shared with the endpoint that builds
// it, so a field means the same thing to the server that filled it in and to the card that draws
// it (see `#shared/utils/activity`).
import {
  ACTIVITY_CATEGORIES,
  activityCategoryCounts,
  activityInCategory,
  type ActivityCategory,
  type ActivityItem
} from '#shared/utils/activity'
// How a figure is written on the site: one rule, shared with the card and the leaderboard.
import { formatNumber } from '#shared/utils/formatNumber'

const props = defineProps<{
  /** The most recently earned achievements, newest first. */
  items: ActivityItem[]
  /** The character's total achievement points, printed beside the heading. */
  totalPoints: number
}>()

// The wording and the exact moment of each event (see the composable).
const { formatRelative, formatAbsolute } = useRelativeTime()

const route = useRoute()
const router = useRouter()

/**
 * The filter the address names, which is the one lit in the sidebar.
 *
 * The address is the source of truth rather than a piece of local state: a filtered feed is a
 * link worth sharing and worth going back to, so `?category=pve` is read here and written back by
 * `selectCategory`, and a visitor's own back and forward step between the two. Anything the
 * address does not name - a mistyped category, a link that carries none - falls back to `all`.
 */
const active = computed<ActivityCategory>(() => {
  const value = String(route.query.category ?? '')
  return (ACTIVITY_CATEGORIES as readonly string[]).includes(value) ? (value as ActivityCategory) : 'all'
})

/** Writes the chosen filter into the address, which is what the computed above reads. */
function selectCategory(category: ActivityCategory): void {
  if (category === active.value) return
  const query = { ...route.query }
  // `all` is the default, so it is left unspelled: `/activity` and `?category=all` would be two
  // addresses for one page, and the shorter one is the page as a visitor first met it.
  if (category === 'all') delete query.category
  else query.category = category
  // The path is named rather than left to the router: a location that carries only a query
  // resolves against the record's own path, which is the English one, so the `/ru` alias a Russian
  // visitor is reading would be dropped and the language would fall back with it. Naming
  // `route.path` keeps the address - and the language it spells - exactly as it was.
  router.replace({ path: route.path, query, hash: route.hash })
}

/** The filters as the sidebar draws them: the glyph, the wording, and the count beside it. */
const FILTERS = [
  { key: 'all', emoji: '🌐', label: 'activityFilterAll' },
  { key: 'achievements', emoji: '🏆', label: 'activityFilterAchievements' },
  { key: 'pve', emoji: '⚔️', label: 'activityFilterPve' },
  { key: 'collections', emoji: '🐴', label: 'activityFilterCollections' },
  { key: 'pvp', emoji: '🛡️', label: 'activityFilterPvp' }
] as const

/** How many events each filter holds, for the badges the sidebar prints. */
const counts = computed(() => activityCategoryCounts(props.items))

/** The events the chosen filter keeps, in the order the feed arrived in (newest first). */
const filtered = computed(() => props.items.filter((item) => activityInCategory(item, active.value)))

/**
 * The look of a card, picked by the accent the server put on the item.
 *
 * Three parts travel together - the frame of the card, the ring around the icon and the node
 * on the rail - so a feat of strength and a raid read as different kinds of event at a glance,
 * and everything else wears the brand gold an achievement is drawn in.
 */
const ACCENTS = {
  feat: {
    // A feat of strength is a proof rather than progress, so its card is warmed with gold.
    card: '[--hoa-ring:rgba(245,158,11,0.4)] bg-gradient-to-br from-amber-500/[0.16] via-white/[0.04] to-fuchsia-500/[0.06]',
    frame: 'border-transparent shadow-[0_0_0_2px_rgba(245,158,11,0.8),0_0_14px_rgba(245,158,11,0.6)]',
    node: 'bg-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.9)]',
    badge: 'border-transparent bg-amber-500/15 text-amber-200 shadow-[0_0_0_1px_rgba(245,158,11,0.5)]'
  },
  raid: {
    // A dungeon, a raid or a Mythic+ key wears the violet the game itself marks them with.
    card: '[--hoa-ring:rgba(139,92,246,0.4)] bg-gradient-to-br from-violet-500/[0.16] via-white/[0.04] to-sky-500/[0.06]',
    frame: 'border-transparent shadow-[0_0_0_2px_rgba(139,92,246,0.8),0_0_14px_rgba(139,92,246,0.6)]',
    node: 'bg-violet-400 shadow-[0_0_14px_rgba(139,92,246,0.9)]',
    badge: 'border-transparent bg-violet-500/15 text-violet-200 shadow-[0_0_0_1px_rgba(139,92,246,0.5)]'
  },
  plain: {
    card: '',
    frame: 'border-transparent shadow-[0_0_0_2px_rgba(248,183,0,0.5)]',
    node: 'bg-wow-gold shadow-[0_0_10px_rgba(248,183,0,0.75)]',
    badge: 'border-transparent bg-wow-gold/10 text-wow-goldLight shadow-[0_0_0_1px_rgba(248,183,0,0.4)]'
  }
} as const

function accentOf(item: ActivityItem) {
  return ACCENTS[item.accent ?? 'plain']
}
</script>

<template>
  <section class="mx-auto max-w-5xl lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-8">
    <!-- The heading of the feed: what the list is, and the running total it belongs to. It spans
         both columns, so the filter rail starts level with the top of the list beneath it. -->
    <div class="mb-5 flex flex-wrap items-baseline justify-between gap-2 lg:col-span-2 lg:mb-0">
      <h2 class="text-base font-bold uppercase tracking-wider text-gray-200 sm:text-lg">
        {{ $t('recentAchievements') }}
      </h2>
      <span class="text-xs text-gray-400 sm:text-sm">
        {{ $t('achievements') }}:
        <b class="whitespace-nowrap text-white tabular-nums">{{ formatNumber(totalPoints) }}</b>
      </span>
    </div>

    <!-- The feed is read through a rail of filters. On a wide screen that rail is a column down
         the left, held in place while the list moves past it; on a phone it lies on its side as a
         row of chips that scrolls sideways - the one shape that keeps five filters a thumb away
         without pushing the timeline off the first screen. Both are the one list of buttons, laid
         out by breakpoint rather than written twice. -->
    <aside class="mb-5 lg:sticky lg:top-44 lg:mb-0">
      <p class="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
        {{ $t('activityFilterTitle') }}
      </p>
      <nav
        class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:px-0 lg:pb-0"
        :aria-label="$t('activityFilterTitle')"
      >
        <button
          v-for="filter in FILTERS"
          :key="filter.key"
          type="button"
          class="hoa-tab shrink-0 whitespace-nowrap lg:w-full"
          :class="{ 'hoa-tab-active': active === filter.key }"
          :aria-pressed="active === filter.key"
          @click="selectCategory(filter.key)"
        >
          <span aria-hidden="true">{{ filter.emoji }}</span>
          <span class="flex-1 text-left">{{ $t(filter.label) }}</span>
          <span
            class="grid min-w-[1.5rem] place-items-center rounded-md border px-1 text-xs font-semibold tabular-nums whitespace-nowrap"
            :class="active === filter.key
              ? 'border-wow-gold/40 bg-wow-gold/15 text-wow-goldLight'
              : 'border-white/15 bg-white/5 text-gray-300'"
          >
            {{ formatNumber(counts[filter.key]) }}
          </span>
        </button>
      </nav>
    </aside>

<!-- The whole feed is empty: a character with nothing recent to show. -->
    <p v-if="!items.length" class="hoa-panel min-w-0 px-6 py-16 text-center text-gray-400">
      {{ $t('activityEmpty') }}
    </p>

    <!-- The timeline: a rail down the left that every card hangs from, each event a node on it.
         The rail fades out at the bottom so the list reads as ongoing rather than cut off. Only
         the events the chosen filter keeps are drawn, newest first. -->
    <ol v-else-if="filtered.length" class="relative min-w-0">
      <span
        class="pointer-events-none absolute bottom-6 left-[26px] top-2 w-px bg-gradient-to-b from-wow-gold/50 via-white/10 to-transparent"
        aria-hidden="true"
      />

      <li
        v-for="item in filtered"
        :key="`${item.id}-${item.completedAt}`"
        class="relative pb-5 pl-16 last:pb-0"
      >
        <!-- The node on the rail, coloured by the kind of event. -->
        <span
          class="absolute left-[18px] top-4 h-4 w-4 rounded-full ring-4 ring-wow-dark"
          :class="accentOf(item).node"
          aria-hidden="true"
        />

        <article
          class="hoa-panel p-3.5 transition-transform duration-200 hover:-translate-y-0.5 sm:p-4"
          :class="accentOf(item).card"
        >
          <div class="flex items-start gap-3.5">
            <!-- The icon in a WoW-style frame: a filled square with the ring the game draws
                 around an achievement, warmed for the accent the card carries. The frame is itself
                 the link, so hovering it raises the same tooltip as the name beside it. -->
            <!-- A name of its own, so the icon link is announced either way: the icon carries the
                 achievement's name as its `alt`, but the fallback glyph is decorative. -->
            <WowheadLink type="achievement" :id="item.id" icon-only :aria-label="item.name" class="shrink-0">
              <span
                class="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border-2 bg-black/50"
                :class="accentOf(item).frame"
              >
                <img
                  v-if="item.icon"
                  :src="item.icon"
                  :alt="item.name"
                  loading="lazy"
                  class="h-full w-full object-cover"
                />
                <AppIcon v-else name="achievments" class="h-6 w-6 opacity-70" />
              </span>
            </WowheadLink>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-base font-bold leading-snug text-white sm:text-lg">
                  <!-- The name is the link: hovering it warms the text (the widget colours it too
                       when what it names has a rarity) and, past the tooltip, reveals the glyph
                       that says the page it opens is somewhere else. -->
                  <WowheadLink type="achievement" :id="item.id" class="hover:underline">
                    <span>{{ item.name }}</span>
                    <svg
                      class="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity duration-200 group-hover/wh:opacity-100"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      aria-hidden="true"
                    >
                      <path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" stroke-linecap="round" stroke-linejoin="round" />
                      <path d="M12 4h4v4M15.5 4.5 9 11" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                  </WowheadLink>
                </h3>
                <span
                  v-if="item.points"
                  class="shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold tabular-nums whitespace-nowrap"
                  :class="accentOf(item).badge"
                >
                  +{{ formatNumber(item.points) }}
                </span>
              </div>

              <p v-if="item.description" class="mt-1 text-sm leading-relaxed text-gray-400">
                {{ item.description }}
              </p>

              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <span v-if="item.category" class="truncate hoa-tag">{{ item.category }}</span>
                <!-- How long ago it happened, with the exact moment on hover. -->
                <span
                  class="group/date relative cursor-help font-normal text-gray-300"
                  :title="formatAbsolute(item.completedAt)"
                >
                  {{ formatRelative(item.completedAt) }}
                  <span
                    class="hoa-tip pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap px-2.5 py-1 text-[11px] font-normal text-gray-200 group-hover/date:block"
                  >
                    {{ formatAbsolute(item.completedAt) }}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </article>
      </li>
    </ol>

    <!-- The filter is simply empty: a character whose recent history holds none of these. The way
         out is the whole timeline, offered right here rather than left to the rail above. -->
    <div
      v-else
      class="hoa-panel flex min-w-0 flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <span class="text-3xl" aria-hidden="true">🗂️</span>
      <p class="text-gray-300">{{ $t('activityCategoryEmpty') }}</p>
      <button type="button" class="hoa-tab" @click="selectCategory('all')">
        {{ $t('activityFilterAll') }}
      </button>
    </div>
  </section>
</template>