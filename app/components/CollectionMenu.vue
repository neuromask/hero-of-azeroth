<script setup lang="ts">
// The shelves the menu offers, in the order it lists them.
import { COLLECTION_KINDS } from '#shared/data/collectionsSchema'

/**
 * The Collections entry of a character's navigation: the tab that opens the summary, and the menu of
 * the shelves beside it.
 *
 * The section has a root of its own - the summary that draws every shelf as a tile - so the tab is a
 * link and goes there, which is what a reader expects of a tab. The shelves hang off a caret next to
 * it: the summary first, the four shelves a click away. The caret opens on a click, and closes on the
 * next one, on a click anywhere outside the pair, on Escape, and as soon as a shelf is picked, so the
 * two menus of the character's navigation - this one and the achievements' - read alike.
 *
 * The entries are links of their own, so each shelf keeps an address that can be shared and crawled,
 * and the pane is hidden with `invisible` rather than left out of the document, so those addresses
 * are in the markup the server sends even while it is shut.
 */
const props = defineProps<{
  /** The collections subtree of this character, which the entries hang from. */
  path: string
  /** Whether the collections are what the address names, which is what lights the tab. */
  active: boolean
}>()

const localeUrl = useLocaleUrl()
const route = useRoute()

/** Whether the menu is open, which a click on the caret toggles and the next click takes back. */
const open = ref(false)
/** The tab, the caret and the menu, which is what a click has to land outside of to shut it. */
const root = ref<HTMLElement | null>(null)

/** Whether the summary is what is being read, which is the tab the link lights. */
const onSummary = computed(() => /\/collections\/?$/.test(route.path))

/** Whether `kind` is the shelf being read, which is the entry the menu lights. */
function onShelf(kind: string): boolean {
  return new RegExp(`/collections/${kind}/?$`).test(route.path)
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

// A shelf that has just been picked is the page being read, so the menu is done with.
watch(
  () => route.path,
  () => {
    open.value = false
  }
)
</script>

<template>
  <div ref="root" class="relative flex items-stretch">
    <!-- The tab itself opens the summary. -->
    <NuxtLink
      :to="localeUrl(props.path)"
      class="hoa-tab hoa-liquid-glass rounded-r-none"
      :class="{ 'hoa-tab-active': onSummary }"
      :aria-current="onSummary ? 'page' : undefined"
    >
      {{ $t('tabCollections') }}
    </NuxtLink>

    <!-- The caret opens the shelves. It is a button rather than a link because it opens a menu
         instead of going anywhere, and it is drawn against the tab (`-ml-px` merges the shared rim)
         so the two read as one control. The arrow is the chevron the Download button and the legend
         under a shelf wear, so the controls that open a tray read alike. -->
    <button
      type="button"
      class="hoa-tab hoa-liquid-glass -ml-px rounded-l-none px-2"
      :class="{ 'hoa-tab-active': props.active || open }"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="$t('collectionsCategoriesMenu')"
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

    <!-- Shut, the panel is invisible but still in the document: the shelves are addresses a crawler
         should find, and they are read from the markup rather than from a script. The pane is the
         site's own menu glass (`.hoa-pop`), the one every menu, picker and legend on the site is
         drawn in. The row the tab stands in is not a frosted block of its own - the header panel ends
         above it - so the pane keeps the page as its backdrop and blur is drawn against the page it
         hangs over. -->
    <div
      class="hoa-pop absolute left-0 top-full mt-2 w-52 p-1.5 transition-opacity duration-150"
      :class="open ? 'opacity-100' : 'invisible opacity-0'"
      role="menu"
    >
      <NuxtLink
        v-for="shelf in COLLECTION_KINDS"
        :key="shelf"
        :to="localeUrl(`${props.path}/${shelf}`)"
        class="flex items-center rounded-xl px-3 py-2 text-sm font-semibold transition-colors"
        :class="onShelf(shelf) ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
        :aria-current="onShelf(shelf) ? 'page' : undefined"
        role="menuitem"
        @click="open = false"
      >
        {{ $t(shelf) }}
      </NuxtLink>
    </div>
  </div>
</template>
