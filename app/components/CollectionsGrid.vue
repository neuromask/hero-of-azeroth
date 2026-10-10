<script setup lang="ts">
// The shelf the grid draws, and the section/item shapes it reads from.
import type { CollectionItem, CollectionPage, CollectionSection } from '#shared/data/collectionsSchema'
// Counts are written by the site's one rule (`#shared/utils/formatNumber`), so a section reads its
// figures the way every other page prints them.
import { formatNumber } from '#shared/utils/formatNumber'
// The address a tile links to, and the one hook that makes the widget read the tiles it has not
// seen: the grid asks once, however many links it has just added (see the composable).
import { useWowheadPower, wowheadUrl } from '~/composables/wowheadPower'

const props = defineProps<{ page: CollectionPage }>()

const { locale } = useI18n()
const { refreshLinks } = useWowheadPower()
// The shelf's switches, of which one - the collected items - is drawn here rather than asked for.
const view = useCollectionView()

/** WoW's own question-mark icon, which a tile whose sprite failed to load is replaced with. */
const ICON_FALLBACK = 'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg'

/**
 * Walks a tile's picture down its two fallbacks: ZamImg first, then Blizzard's own copy of the same
 * icon, then WoW's question mark. The two CDNs do not carry quite the same names, so a sprite the one
 * has not got is asked of the other before the square is given up on; each step is tried once, which
 * is what dropping the attribute that names it does.
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
 * The sections whose tiles are in the DOM.
 *
 * A shelf holds every collectable in the game, so building all its tiles at once is thousands of
 * nodes and a hydration to match - which is what made the page crawl. The first section is built
 * with the page, because that is the one the visitor is looking at, and every other joins it only
 * as it comes near the viewport. The headings and the bars are always drawn - they are a handful of
 * nodes and they are what a scanner reads - so the page it first paints is a list of sections with
 * one of them open.
 */
const revealed = ref<Set<number>>(new Set([0]))
const sectionEls = new Map<number, HTMLElement>()
let observer: IntersectionObserver | null = null

function setSection(index: number, element: Element | null): void {
  if (element) sectionEls.set(index, element as HTMLElement)
  else sectionEls.delete(index)
}

/**
 * The widget is asked to look again once per batch of reveals, not once per tile: the tiles are
 * plain anchors it finds by itself, so all a newly built section needs is a single nudge - and a
 * scroll that opens three sections at once still spends one call.
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
 * The quick anchors: a chip for every group of the shelf, in a panel that stands to the left of the
 * shelf and stays under the character's header as the page is scrolled.
 *
 * The header is sticky and its height is not a constant - it is a column on a narrow screen and a row
 * on a wide one, and the character's name and title wrap - so the panel measures it rather than
 * guessing a `top`, and follows it as the window changes. The same measurement is handed to
 * `.hoa-section` as `--hoa-anchor-offset`: the room a group keeps above itself when a chip scrolls to
 * it, so the group comes to rest below the header rather than under it. The panel takes none of that
 * room: it stands beside the shelf, and a group is never under it.
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

/**
 * Scrolls a group into view. `html { scroll-behavior: smooth }` makes the travel a glide, and the
 * `scroll-margin-top` a section carries is what leaves the header and the rail their room - so the
 * browser does the arithmetic and the visitor keeps the scroll position they were at.
 */
function jumpTo(index: number): void {
  activeSection.value = index
  sectionEls.get(index)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Keeps the chip of the group being read inside the panel, without moving the page: only the panel
 * scrolls, and only when the chip has left it. The list runs down the column, so the chip is simply
 * brought into the panel with it - a page read top to bottom needs no travel of its own to keep up.
 */
function centerChip(index: number): void {
  const chip = chipEls.get(index)
  const rail = railEl.value
  if (!chip || !rail) return
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
    // A screen ahead, so a section is built just before it is looked at and never pops in.
    { rootMargin: '600px 0px' }
  )
  for (const element of sectionEls.values()) observer.observe(element)

  // The anchors need the header's height before the first chip is tapped, and again whenever the
  // header changes it - a breakpoint, a longer name, a title that wraps.
  measure()
  const header = document.querySelector('header')
  if (typeof ResizeObserver !== 'undefined') {
    headerObserver = new ResizeObserver(measure)
    if (header) headerObserver.observe(header)
  }

  // Which chip is lit: the group the rail is standing over. The window it watches is the strip just
  // under the rail, and the last group in it is the one being read.
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

  // The tiles the first render carried are the ones the widget has not been told about yet.
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

/** One row of tiles inside a section: a name to head it with (empty for a nameless source) and its items. */
interface GridRow {
  id: string
  label: string
  items: CollectionItem[]
}

/**
 * The rows a section is built from: one per source, each a name over its own block of tiles - the
 * source headings of the SimpleArmory tree, laid side by side under the group's own heading.
 *
 * With the collected switch off, the tiles the character already holds are left out and a source with
 * nothing left to gather goes with them, so the shelf reads as what is still missing. It is a filter
 * over what is drawn rather than a different request: the response says which items are held, item by
 * item, and the heading above still counts the shelf as a whole.
 */
function rowsOf(section: CollectionSection): GridRow[] {
  // `view` is a ref: this is a script, not a template, so the switch is read through `value` - a bare
  // `view.collected` would be `undefined` and the shelf would always look as if the switch were off.
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
/** What a source's own name adds to the height of the group it sits in. */
const SUBGROUP_TITLE = 22

/**
 * A rough height for a section that is not built yet, so the page does not jump as it is built.
 *
 * A group lays its sources side by side, so what it will take is the lines its tiles fill, plus a
 * name for each source - not a line per source, which is what the old stack of them was.
 */
function placeholderHeight(section: CollectionSection): string {
  const rows = rowsOf(section)
  const tiles = rows.reduce((sum, row) => sum + row.items.length, 0)
  const lines = Math.ceil(tiles / TILES_PER_LINE)
  // Only a named block takes the room of a heading.
  const headings = rows.filter((row) => row.label).length * SUBGROUP_TITLE
  return `${lines * TILE_LINE + headings}px`
}
</script>

<template>
  <div
    class="space-y-5 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-x-6 lg:gap-y-5 lg:space-y-0"
    :style="{ '--hoa-anchor-offset': `${anchorOffset}px`, '--hoa-sticky-top': `${stickyTop}px` }"
  >
    <!-- The quick anchors: a chip for every group of this shelf, so a shelf of twenty-odd groups can
         be walked without hunting for one. The group being read is lit, and a chip scrolls the page
         to its group - which is what `scroll-behavior: smooth` above and the section's
         `scroll-margin-top` are for.

         They stand in a panel to the left of the shelf, pinned under the character's header as the
         shelf moves past it and scrolling inside itself when a shelf holds more groups than a window
         is tall. A phone has no room for the panel beside the tiles and is given none (`hidden`
         below `lg`): a screen that narrow belongs to the shelf, and a group of it is reached by
         scrolling a shelf a phone can hold. -->
    <nav
      v-if="page.sections.length > 1"
      ref="railEl"
      class="hoa-anchors sticky z-30 hidden lg:flex lg:max-h-[calc(100vh-var(--hoa-sticky-top)-2rem)] lg:w-52 lg:shrink-0 lg:flex-col lg:gap-1 lg:overflow-x-hidden lg:overflow-y-auto"
      :style="{ top: `${stickyTop}px` }"
      :aria-label="$t(page.kind)"
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

    <!-- The shelf itself: the column of groups the anchors walk. `min-w-0` is what lets a row
         of tiles shrink rather than widen the column, and the column takes the room the page
         leaves the shelf rather than a width of its own. -->
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

        <!-- The tiles: a wall of anchors, each one a link the widget draws a tooltip over.
             A group is a run of its sources - each a block of its own, its name on a tag over its row
             of tiles - laid side by side and wrapping as the row fills, the way SimpleArmory reads a
             group, and the run is the row of this template. The few items Wowhead has no page for are
             plain spans, so a tile is one node, one image. -->
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
        <div
          v-else
          class="mt-4"
          :style="{ minHeight: placeholderHeight(section) }"
          aria-hidden="true"
        />
      </section>
    </div>
  </div>
</template>