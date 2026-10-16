<script setup lang="ts">
// The figures are written by the site's one rule (`#shared/utils/formatNumber`): thousands grouped by a space.
import { formatNumber } from '#shared/utils/formatNumber'
// The profile the shell fetched, which already carries five of the six figures (`useCharacterView`).
import { useCharacterView } from '~/composables/characterView'
// Where a tile of the drawer leads: the ranking of the very figure it prints, turned to the place this character
// holds in it - the same composable a character page's own tiles read (`useCharacterRanks`), so the two halves of
// the page open the same table, and a figure the site ranks nowhere cannot be linked to because it cannot be named.
import { useCharacterRanks } from '~/composables/characterRanks'
import type { MetricLeaderboardSlug } from '#shared/data/leaderboardSchema'

/**
 * The drawer of six figures that hangs under the summary plates of a character page.
 *
 * The plates above it answer "how much" - the rating, the item level, the Mythic+ score - and the tiles beside
 * the character answer it for the six collections. These six answer a different question: what a character has
 * *done*, on the account it belongs to. Titles earned, quests run, recipes learned, appearance sources unlocked,
 * honorable kills and an honor level - none of them is a collection of items and none has a reachable ceiling
 * the API states, which is why they are not tiles with bars (`CountStat` in `server/utils/blizzard`) but a drawer
 * a reader opens when they want them.
 *
 * A drawer rather than six more tiles, because a character page is read for its shelves: a row of figures most
 * readers never look at would push them down the page for everybody. So the label is all a reader sees of it while
 * it is shut - the words "more stats" written across the top of the panel itself, with the caret every tray of the
 * site wears - and one press slides the six figures out from under the summary plate. It is a disclosure and says
 * so: `aria-expanded` on that label, `aria-controls` naming the tray it opens, nothing focusable inside while it is
 * shut, and Escape closes it, which is what a reader expects of anything that opens.
 *
 * Five of the six arrive with the page, read beside the collections from the same profile. The sixth - the
 * appearance sources - is a 2.5 MB document of Blizzard's own and is deliberately not: it is asked for the first
 * time the drawer is opened and fills in a moment later (`server/api/transmog`). A reading that failed prints a
 * dash rather than a zero: a wardrobe nobody could read and an empty one are different answers.
 */
const { character, region, realm, name } = useCharacterView()
const { t } = useI18n()
// The places this character holds in the site's rankings, read while the page is rendered: a door carries the place
// its reader holds in the table it opens, and the place is part of the address rather than of the move.
const { urlFor } = await useCharacterRanks()

/** Whether the tray is out, which the label on the panel toggles. */
const open = ref(false)

/** The root, so a press outside the drawer can shut it, the way every disclosure of the site does. */
const root = ref<HTMLElement | null>(null)

/**
 * The appearance sources: `undefined` until the drawer asks, `null` when the reading failed, a number once it
 * lands. Three states rather than two, because a dash is not a zero.
 */
const transmogs = ref<number | null | undefined>(undefined)

/** True while that one figure is on its way, which is what the tile prints a beating dash for. */
const readingTransmogs = ref(false)

/** Asks for the appearance sources, once: the first opening of the drawer is the whole of the trigger. */
async function askTransmogs(): Promise<void> {
  if (transmogs.value !== undefined || readingTransmogs.value) return

  readingTransmogs.value = true

  try {
    const answer = await $fetch<{ count: number | null }>(
      `/api/transmog/${region}/${realm}/${encodeURIComponent(name)}`
    )
    transmogs.value = answer?.count ?? null
  } catch {
    transmogs.value = null
  } finally {
    readingTransmogs.value = false
  }
}

watch(open, (opened) => {
  if (opened) void askTransmogs()
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

function onDocumentPress(event: MouseEvent): void {
  if (!open.value) return
  if (root.value?.contains(event.target as Node)) return

  open.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPress)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPress)
  document.removeEventListener('keydown', onKeydown)
})

/** One figure of the drawer, as it is printed. */
interface DrawerFigure {
  /** The message key of its name. */
  label: string
  /** The glyph the set draws for it, by file name (`app/assets/icons`, read by `AppIcon`). */
  icon: string
  /** The ranking of this very figure, which the tile opens (`app/composables/metricLeaderboard`). */
  slug: MetricLeaderboardSlug
  /** The figure itself, or `null` for one that is not there to print. */
  count: number | null
  /** Whether the figure is the account's own, which the tile says underneath it. */
  accountWide: boolean
}

/**
 * The six figures, in the order they are read: the three a character earns by playing, the wardrobe that belongs
 * to its account, and the two of its player versus player side.
 */
const figures = computed<DrawerFigure[]>(() => {
  const stats = character.value?.stats
  if (!stats) return []

  const count = (value?: { count?: number } | null) => (typeof value?.count === 'number' ? value.count : null)

  return [
    { label: 'titles', icon: 'titles', slug: 'titles', count: count(stats.titles), accountWide: !!stats.titles?.accountWide },
    { label: 'quests', icon: 'quests', slug: 'quests', count: count(stats.quests), accountWide: !!stats.quests?.accountWide },
    { label: 'recipes', icon: 'recipes', slug: 'recipes', count: count(stats.recipes), accountWide: !!stats.recipes?.accountWide },
    {
      // The wardrobe is the account's and the endpoint says so: the figure is the same on every character.
      label: 'transmogs',
      icon: 'transmogs',
      slug: 'transmogs',
      count: transmogs.value === undefined ? null : transmogs.value,
      accountWide: true
    },
    {
      label: 'honorableKills',
      icon: 'kills',
      slug: 'honorable-kills',
      count: count(stats.honorableKills),
      accountWide: !!stats.honorableKills?.accountWide
    },
    { label: 'honorLevel', icon: 'honorLevel', slug: 'honor-level', count: count(stats.honorLevel), accountWide: true }
  ]
})

/**
 * Where a figure leads: the ranking of that very figure, over everybody the site has read - turned to the place
 * this character holds in it, so the table opens the page their row stands on and brings the row into view.
 *
 * The same reading the tiles beside the character make, and the same composable (`tileUrl` in
 * `app/pages/[region]/[realm]/[name]/index.vue`, `useCharacterRanks`): the figure under the reader's eye is a column
 * of a table the site keeps, and the table is one press behind it - whole, rather than narrowed to the realm the
 * character happens to play on, because the ranking is the population's and the filters that narrow it are on the
 * page. The drawer is where the six figures *without* a bar live, so this is what turns the other half of the page's
 * figures into doors as well - a title is a ranking, a quest is a ranking, a kill is a ranking.
 *
 * A character the table does not hold is linked to the ranking without a place, which is the same door with nothing
 * to turn to (`app/composables/characterRanks`).
 */
function figureUrl(slug: MetricLeaderboardSlug) {
  return urlFor(slug)
}
</script>

<template>
  <div ref="root" class="flex w-full flex-col items-center">
    <!-- The panel of the six figures - and the label, which is its first row rather than a control of its own, so
         that a reader sees one block: the words "more stats", the caret every tray of the site wears, and the six
         figures themselves. A press on that label toggles the tray both ways, and the caret and the gold say
         which way it is out.

         The page lays this panel under the summary plate and anchors its own bottom edge to the plate's top
         (`app/pages/[region]/[realm]/[name]/index.vue`): the whole block, label included, slides out upward from
         behind the plate, which never moves, and nothing on the page above it is pushed around. The plain frame
         (`.hoa-panel`), drawn flat rather than as a block that lifts under the pointer. -->
    <div id="hoa-character-stats" class="hoa-panel flex w-full flex-col overflow-hidden">
      <button
        type="button"
        class="flex w-full shrink-0 items-center justify-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-white"
        :class="open ? 'text-wow-goldLight' : 'text-gray-200'"
        :aria-expanded="open"
        aria-controls="hoa-character-stats-tiles"
        :title="open ? t('statDrawerClose') : t('statDrawerOpen')"
        @click="open = !open"
      >
        <span class="whitespace-nowrap">{{ open ? t('statDrawerClose') : t('statDrawerOpen') }}</span>

        <!-- The caret answers the press the way the tray itself moves: while the tray is shut it points up, the
             way the panel comes out - from under the plate above it - and once it is open it points back down,
             which is where a press puts it again. A shade larger than the carets of the site's chips, because
             this one is the whole of what the block shows while it is shut. -->
        <svg
          class="h-4 w-4 shrink-0 transition-transform duration-200"
          :class="open ? 'rotate-0' : 'rotate-180'"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
        </svg>
      </button>

      <!-- The six figures under the label, as a grid row growing from `0fr` to `1fr` - the height of the content
           rather than a `max-height` guessed at - with the figures riding into place inside it (`translate-y`).
           `inert` puts a shut tray out of the keyboard's way while its markup stays in the document; the label
           above stays pressable. There is no fade anywhere in here and none may be added: the panel is glass, its
           frost lives on its own `::before` layer, and an opacity written into this transition would put that
           layer on a compositing path of its own and flicker the blur of everything behind it (the rule the
           stylesheet states for the same reason). -->
      <div
        id="hoa-character-stats-tiles"
        class="grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out"
        :class="open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        :inert="!open"
      >
        <div
          class="min-h-0 px-3 pb-3 transition-transform duration-300 ease-out sm:px-4 sm:pb-4"
          :class="open ? 'translate-y-0' : 'translate-y-2'"
        >
          <div class="grid grid-cols-2 gap-2 sm:gap-3">
            <!-- Every figure is a door into its own ranking, whole - the same press the tiles beside the
                 character are (`figureUrl`). A tile the reader can act on is owed the two
                 things the site's own links wear: the pointer's answer (the brand gold on the rim, the way
                 `.hoa-panel-interactive` lights a plate) and a `title` for the keyboard and the hover. -->
            <NuxtLink
              v-for="figure in figures"
              :key="figure.label"
              :to="figureUrl(figure.slug)"
              class="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center transition-colors hover:border-wow-gold/40 hover:bg-white/[0.07] focus-visible:border-wow-gold/60 focus-visible:outline-none"
              :title="`${t(figure.label)} — ${t('rankOpenTitle')}`"
            >
              <!-- The label the plate above wears, down to the size and the colour. -->
              <p class="text-xs text-gray-200 uppercase tracking-wider font-semibold">
                {{ t(figure.label) }}
              </p>

              <!-- And the figure, with its glyph in front of it exactly the way the summary plate above draws
                   the Mythic+ score: one inline row, the icon at `0.85em` so it matches the digits optically,
                   and the digits in the same size and weight the page's own tiles use. -->
              <p class="mt-1 inline-flex items-center justify-center gap-2 whitespace-nowrap text-2xl font-extrabold leading-none tabular-nums text-white sm:text-3xl">
                <AppIcon :name="figure.icon" class="h-[0.85em] w-[0.85em]" />
                <!-- A figure that could not be read is a dash, and one still on its way is a dash that beats: the
                     page is not waiting on it, so it must not read as though it were. -->
                <template v-if="figure.count !== null">{{ formatNumber(figure.count) }}</template>
                <span
                  v-else
                  class="text-gray-500"
                  :class="figure.label === 'transmogs' && readingTransmogs ? 'animate-pulse' : ''"
                >—</span>
              </p>
              <!-- Whose figure it is, said out loud, and said the way the rest of the site says it
                   (`app/components/CollectionSummaryGrid.vue`): the account's own in the brand gold, the
                   character's own in grey. A stranger's wardrobe is still the account's - the game keeps
                   appearances for the whole Battle.net account, not for the hero wearing them - so a tile
                   that carries the pool's own count says so and a tile read for one character says that. -->
              <p
                class="mt-1 text-[10px] font-semibold uppercase tracking-wider"
                :class="figure.accountWide ? 'text-wow-goldLight/80' : 'text-gray-500'"
              >
                {{ figure.accountWide ? t('accountWide') : t('perCharacter') }}
              </p>
            </NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
