<script setup lang="ts">
// The shelf the grid draws, and the section/item shapes it reads from.
import type { AchievementItem, AchievementPage, AchievementSection } from '#shared/data/achievementsSchema'
import { ACHIEVEMENT_LABEL_KEYS } from '#shared/data/achievementsSchema'
// Counts are written by the site's one rule, so a section reads its figures the way every page prints them.
import { formatNumber } from '#shared/utils/formatNumber'
// The address a tile links to, and the one hook that makes the widget read the tiles it has not seen.
import { useWowheadPower, wowheadUrl } from '~/composables/wowheadPower'

/**
 * The grid under an achievement shelf: one block per section, the subcategories laid side by side
 * inside it, and a tile per achievement.
 *
 * It is the collections grid with the marks an achievement wears - its points and its Wowhead page -
 * and the same two economies: the sections are built lazily as they come near the viewport, and the
 * tooltip widget is nudged once per batch rather than once per tile.
 */
const props = defineProps<{ page: AchievementPage }>()

const { locale } = useI18n()
const { refreshLinks } = useWowheadPower()
// The shelf's switch, which decides whether the tiles already earned are drawn.
const view = useAchievementView()

/** WoW's own question-mark icon, which a tile whose sprite failed to load is replaced with. */
const ICON_FALLBACK = 'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg'

/**
 * Walks a tile's picture down its two fallbacks: ZamImg first, then Blizzard's own copy of the same
 * icon, then WoW's question mark. Each step is tried once, which is what dropping the attribute that
 * names it does.
 */
function onIconError(event: Event): void {
  const img = event.target as HTMLImageElement
  const fallback = img.dataset.fallback
  if (fallback) {
    delete img.dataset.fallback
    img.src = fallback
    return
  }
  if (!img.src.endsWith('/inv_misc_questionmark.jpg')) img.src = ICON_FALLBACK
}

/**
 * The sections whose tiles are in the DOM. A shelf holds every achievement of a category, so building
 * all its tiles at once is thousands of nodes and a hydration to match: the first section is built
 * with the page, and every other joins it only as it comes near the viewport.
 */
const revealed = ref<Set<number>>(new Set([0]))
const sectionEls = new Map<number, HTMLElement>()
let observer: IntersectionObserver | null = null

function setSection(index: number, element: Element | null): void {
  if (element) sectionEls.set(index, element as HTMLElement)
  else sectionEls.delete(index)
}

/**
 * The widget is asked to look again once per batch of reveals, not once per tile: the tiles are plain
 * anchors it finds by itself, so all a newly built section needs is a single nudge.
 */
let refreshScheduled = false
function scheduleRefresh(): void {
  if (refreshScheduled) return
  refreshScheduled = true
  nextTick(() => {
    refreshScheduled = false
    refreshLinks()
  })
}

/** Builds `index`'s tiles and, if that added any links, hands them to the widget. */
function reveal(index: number): void {
  if (revealed.value.has(index)) return
  revealed.value = new Set([...revealed.value, index])
  scheduleRefresh()
}

/**
 * The quick anchors: a chip for every section of the shelf, in a panel that stands to the left of the
 * shelf and stays under the character's header as the page is scrolled. The panel measures the header
 * rather than guessing a `top`, and hands the same measurement to `.hoa-section` as
 * `--hoa-anchor-offset`.
 */
const railEl = ref<HTMLElement | null>(null)
const stickyTop = ref(0)
const anchorOffset = ref(128)
const activeSection = ref(0)
const chipEls = new Map<number, HTMLElement>()
let anchors: IntersectionObserver | null = null
let headerObserver: ResizeObserver | null = null

function measure(): void {
  const header = document.querySelector('header')
  stickyTop.value = header ? Math.round(header.getBoundingClientRect().height) : 0
  anchorOffset.value = stickyTop.value + 12
}

function setChip(index: number, element: Element | null): void {
  if (element) chipEls.set(index, element as HTMLElement)
  else chipEls.delete(index)
}

/** Scrolls a section into view, leaving the pinned header its room (see `.hoa-section`). */
function jumpTo(index: number): void {
  activeSection.value = index
  sectionEls.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Keeps the chip of the section being read inside the panel, without moving the page. */
function centerChip(index: number): void {
  const chip = chipEls.get(index)
  if (!chip || !railEl.value) return
  chip.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

watch(activeSection, centerChip)

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        reveal(Number((entry.target as HTMLElement).dataset.section))
        observer?.unobserve(entry.target)
      }
    },
    { rootMargin: '600px 0px' }
  )
  for (const element of sectionEls.values()) observer.observe(element)

  measure()
  const header = document.querySelector('header')
  if (typeof ResizeObserver !== 'undefined') {
    headerObserver = new ResizeObserver(measure)
    if (header) headerObserver.observe(header)
  }

  anchors = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        activeSection.value = Number((entry.target as HTMLElement).dataset.section)
      }
    },
    { rootMargin: `-${anchorOffset.value}px 0px -70% 0px` }
  )
  for (const element of sectionEls.values()) anchors.observe(element)

  scheduleRefresh()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  anchors?.disconnect()
  headerObserver?.disconnect()
  observer = null
  anchors = null
  headerObserver = null
})

/** One row of tiles inside a section: a name to head it with (empty for a nameless subcategory). */
interface GridRow {
  id: string
  label: string
  items: AchievementItem[]
}

/**
 * The rows a section is built from: one per subcategory, each a name over its own block of tiles.
 * With the collected switch off, the tiles the character already holds are left out and a
 * subcategory with nothing left to chase goes with them.
 */
function rowsOf(section: AchievementSection): GridRow[] {
  // `view` is a ref: this is a script, not a template, so the switch is read through `value`.
  return section.subgroups
    .map((subgroup) => ({
      id: subgroup.id,
      label: subgroup.label,
      items: view.value.collected ? subgroup.items : subgroup.items.filter((item) => !item.collected)
    }))
    .filter((row) => row.items.length > 0)
}

/** How many tiles one line of a shelf holds, near enough: 38px squares with 6px between them. */
const TILES_PER_LINE = 24
/** One line of tiles: the square and the gap under it. */
const TILE_LINE = 44
/** What a subcategory's own name adds to the height of the section it sits in. */
const SUBGROUP_TITLE = 22

/** A rough height for a section that is not built yet, so the page does not jump as it is built. */
function placeholderHeight(section: AchievementSection): string {
  const rows = rowsOf(section)
  const tiles = rows.reduce((sum, row) => sum + row.items.length, 0)
  const lines = Math.ceil(tiles / TILES_PER_LINE)
  const headings = rows.filter((row) => row.label).length * SUBGROUP_TITLE
  return `${lines * TILE_LINE + headings}px`
}
</script>

<template>
  <div
    class="space-y-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-x-6 lg:gap-y-5 lg:space-y-0"
    :style="{ '--hoa-anchor-offset': `${anchorOffset}px`, '--hoa-sticky-top': `${stickyTop}px` }"
  >
    <!-- The quick anchors: a chip for every section of this shelf, so a category of a dozen sections
         can be walked without hunting for one. A phone has no room for the panel beside the tiles and
         is given none. -->
    <div
      v-if="page.sections.length > 1"
      class="hoa-anchors sticky z-30 hidden lg:flex lg:max-h-[calc(100vh-var(--hoa-sticky-top)-2rem)] lg:w-52 lg:shrink-0"
      :style="{ top: `${stickyTop}px` }"
    >
      <nav
        ref="railEl"
        class="flex min-h-0 w-full flex-col gap-1 overflow-x-hidden overflow-y-auto p-2"
        :aria-label="$t(ACHIEVEMENT_LABEL_KEYS[page.category])"
      >
        <button
          v-for="(section, index) in page.sections"
          :key="section.id"
          :ref="(element) => setChip(index, element as Element | null)"
          type="button"
          class="hoa-tab shrink-0 whitespace-nowrap px-3 py-1.5 text-xs sm:text-xs lg:w-full lg:justify-start lg:whitespace-normal lg:text-left"
          :class="{ 'hoa-tab-active': index === activeSection }"
          :aria-current="index === activeSection ? 'true' : undefined"
          @click="jumpTo(index)"
        >
          {{ section.label }}
        </button>
      </nav>
    </div>

    <!-- The shelf itself: the column of sections the anchors walk. -->
    <div class="min-w-0 flex-1 space-y-5">
      <section
        v-for="(section, index) in page.sections"
        :key="section.id"
        :ref="(element) => setSection(index, element as Element | null)"
        :data-section="index"
        class="hoa-panel hoa-section"
      >
        <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ section.label }}
          </h3>
          <span class="hoa-tag whitespace-nowrap text-gray-300">
            <span class="tabular-nums text-wow-goldLight">{{ formatNumber(section.collected) }}</span>
            <span class="tabular-nums">/{{ formatNumber(section.total) }}</span>
            <span class="text-gray-500">({{ formatNumber(section.percent) }}%)</span>
          </span>
        </div>

        <div class="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-black/60 p-0.5">
          <div
            class="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-700"
            :style="{ width: `${section.percent}%` }"
          />
        </div>

        <!-- The tiles: a wall of anchors, each one a link the widget draws a tooltip over. A section is
             a run of its subcategories - each a block of its own, its name on a tag over its row of
             tiles - laid side by side and wrapping as the row fills. -->
        <div v-if="revealed.has(index)" class="hoa-subgroups-container mt-4">
          <div v-for="row in rowsOf(section)" :key="row.id" class="hoa-subgroup">
            <h4 v-if="row.label" class="hoa-subgroup-title">
              <span class="hoa-tag">{{ row.label }}</span>
            </h4>
            <template v-for="item in row.items" :key="item.id">
              <a
                v-if="item.wow"
                class="hoa-tile"
                :class="{ 'hoa-tile-collected': item.collected }"
                :href="wowheadUrl(locale, item.wow.type, item.wow.id)"
                :data-wowhead="`${item.wow.type}=${item.wow.id}`"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="item.name"
              >
                <img
                  v-if="item.icon"
                  :src="item.icon"
                  :data-fallback="item.fallback || undefined"
                  :alt="item.name"
                  loading="lazy"
                  decoding="async"
                  @error="onIconError"
                />
                <span v-else class="h-1.5 w-1.5 rounded-full bg-white/20" aria-hidden="true" />
              </a>
              <span
                v-else
                class="hoa-tile"
                :class="{ 'hoa-tile-collected': item.collected }"
                :title="item.name"
              >
                <img
                  v-if="item.icon"
                  :src="item.icon"
                  :data-fallback="item.fallback || undefined"
                  :alt="item.name"
                  loading="lazy"
                  decoding="async"
                  @error="onIconError"
                />
              </span>
            </template>
          </div>
        </div>

        <!-- Not built yet: its place is held so the sections below it do not shift as it opens. -->
        <div v-else class="mt-4" :style="{ minHeight: placeholderHeight(section) }" aria-hidden="true" />
      </section>
    </div>
  </div>
</template>

