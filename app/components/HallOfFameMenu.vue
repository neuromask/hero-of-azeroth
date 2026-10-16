<script setup lang="ts">
// The rankings the menu offers, in the order it lists them: one figure each, which is one table each.
import { METRIC_LEADERBOARDS } from '#shared/data/leaderboardSchema'

/**
 * The hall of fame's entry in the site's navigation: the tab that opens the hub, and the menu of the site's
 * rankings beside it.
 *
 * The hall of fame is not a table - it is the page the site is summed up on - so the tab is a link and goes there,
 * which is what a reader expects of a tab. The tables hang off a caret next to it: the hub first, the thirteen
 * rankings a press away. It is the same control as the collections tab and its caret (`CollectionMenu.vue`), drawn
 * from the same two halves (`rounded-r-none` on the first, `-ml-px rounded-l-none` on the second), and it behaves
 * the same way: the caret opens on a click, closes on the next one, on a click anywhere outside the pair, on
 * Escape, and as soon as a ranking is picked.
 *
 * The entries are links of their own, so every ranking keeps an address that can be shared and crawled, and the
 * pane is hidden with `invisible` rather than left out of the document, so those addresses are in the markup the
 * server sends even while it is shut.
 *
 * The links name the *world's* ranking of each figure rather than the scope of the page the caret was pressed on:
 * this row belongs to the site rather than to a page, and it is drawn on pages that are not rankings at all. A
 * reader standing in a ranking already has the scoped menu above that table's own rows
 * (`app/components/leaderboard/LeaderboardFilters.vue`), which keeps their region and realm.
 */
const props = defineProps<{
  /** Whether the hall of fame is what the address names, which is what lights the tab. */
  active: boolean
}>()

const { t } = useI18n()
const localeUrl = useLocaleUrl()
const route = useRoute()

/** Whether the menu is open, which a click on the caret toggles and the next click takes back. */
const open = ref(false)
/** The tab, the caret and the menu, which is what a click has to land outside of to shut it. */
const root = ref<HTMLElement | null>(null)

/** Whether `slug` is the ranking being read, which is the entry the menu lights. */
function onRanking(slug: string): boolean {
  return String(route.params.metric || '') === slug
}

function onDocumentClick(event: MouseEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

// A ranking that has just been picked is the page being read, so the menu is done with.
watch(
  () => route.path,
  () => {
    open.value = false
  }
)
</script>

<template>
  <div ref="root" class="relative flex items-stretch">
    <!-- The tab itself opens the hub. -->
    <NuxtLink
      :to="localeUrl('/')"
      class="hoa-tab hoa-liquid-glass rounded-r-none"
      :class="{ 'hoa-tab-active': props.active }"
      :aria-current="props.active ? 'page' : undefined"
    >
      {{ t('lbNav') }}
    </NuxtLink>

    <!-- The caret opens the site's rankings. It is a button rather than a link because it opens a menu instead of
         going anywhere, and it is drawn against the tab (`-ml-px` merges the shared rim) so the two read as one
         control. The arrow is the chevron the collections caret wears, so the controls that open a tray read alike. -->
    <button
      type="button"
      class="hoa-tab hoa-liquid-glass -ml-px rounded-l-none px-3"
      :class="{ 'hoa-tab-active': props.active || open }"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="t('lbMetricMenu')"
      @click="open = !open"
    >
      <svg
        class="h-4 w-4 shrink-0 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>

    <!-- Shut, the panel is invisible but still in the document: the rankings are addresses a crawler should find, and
         they are read from the markup rather than from a script. The pane is the site's own menu glass
         (`.hoa-pop`), the one every menu, picker and legend on the site is drawn in. -->
    <div
      class="hoa-pop absolute left-0 top-full mt-2 w-60 p-1.5 transition-opacity duration-150"
      :class="open ? 'opacity-100' : 'invisible opacity-0'"
      role="menu"
    >
      <NuxtLink
        v-for="entry in METRIC_LEADERBOARDS"
        :key="entry.slug"
        :to="localeUrl(metricLeaderboardPath(entry.slug))"
        class="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors"
        :class="onRanking(entry.slug) ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
        :aria-current="onRanking(entry.slug) ? 'page' : undefined"
        role="menuitem"
        @click="open = false"
      >
        <AppIcon :name="entry.icon" class="h-[1.05em] w-[1.05em] shrink-0" />
        <span class="truncate">{{ t(entry.labelKey) }}</span>
      </NuxtLink>
    </div>
  </div>
</template>
