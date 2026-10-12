<script setup lang="ts">
/**
 * The language the site is being read in, as one compact dropdown.
 *
 * The site is served in two languages, the language is the first path segment, and only the non-default one
 * is written out - so the other copy of whatever page is being read is one segment away
 * (`app/composables/urls.ts`). The dropdown is therefore a list of two addresses rather than a control with a
 * state to keep: an entry is a plain `<a>`, so the pair stands in the markup as links a crawler reads and the
 * switch works with no JavaScript at all. An address is also what a switch needs rather than a route: the
 * Russian copy of a page is an alias of the English one, and a router navigation to the route it is already
 * on would be dropped as a duplicate.
 *
 * The control stands inside the group a header's corner is built from (`app/components/HeaderTools.vue`), and
 * the glass is the group's: the trigger draws the code of the language being read and a caret, and the sheet
 * it opens is the site's own menu pane (`.hoa-pop`, `app/assets/css/main.css`) - the same pane the collections
 * menu drops. Below `lg` there is no glass under it, because the pair travels into the panel a phone opens the
 * navigation in; there the shape is `panel`, which draws the two languages as two rows of that panel instead
 * of as a dropdown, since a reader meets them in the same glance as the rest of the panel.
 */
import { SUPPORTED_LOCALES, type AppLocale } from '~/composables/lang'

withDefaults(
  defineProps<{
    /** Where the switch is drawn: the group in a header's corner, or the sheet a phone's menu drops. */
    variant?: 'bar' | 'panel'
  }>(),
  { variant: 'bar' }
)

const { locale, t } = useI18n()
const route = useRoute()

/** The address of `code`'s copy of the page being read. */
const hrefFor = (code: AppLocale): string => localePath(code, stripLocalePrefix(route.path))

/** What an entry says when it is pointed at, in the language's own words: a name needs no translating. */
const NAMES: Record<AppLocale, string> = { en: 'English', ru: 'Русский' }

/** The name of the language being read, which is what the control is titled with. */
const currentName = computed(() => NAMES[locale.value as AppLocale] || '')

/** Whether the dropdown is out, and the box a press has to land outside of to shut it. */
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

/**
 * A press anywhere but the control and its sheet is a reader who is done with the dropdown. The press is read
 * rather than the click, the way the site's other panes read it (`app/components/AchievementMenu.vue`): an
 * entry that has just been picked is the page being read, and a click listener would then be reported against
 * the entry that the switch has already left behind.
 */
function onDocumentPress(event: MouseEvent) {
  if (!open.value) return

  const target = event.target as Node
  if (root.value?.contains(target)) return

  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPress)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPress)
  document.removeEventListener('keydown', onKeydown)
})

/** An entry that has just been picked is the page being read, so the sheet is done with. */
watch(
  () => route.fullPath,
  () => {
    close()
  }
)

/** A row of the panel, and the two states it has - written whole, the way the site's panes write theirs. */
const ROW = 'flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors'
const ROW_OFF = `${ROW} text-gray-200 hover:bg-white/10 hover:text-white`
const ROW_ON = `${ROW} bg-wow-gold/10 text-wow-goldLight`
/** The heading a group of the panel is named by, in the reader's own words. */

const HEADING = 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500'
</script>

<template>
  <!-- The corner of a header: the code of the language being read, and the caret that says the other one is
       under it. It is a disclosure rather than a link, so it carries the state of one (`aria-expanded`) and
       its label names what it is for (`language`), which is what a reader hears instead of two initials. -->
  <div v-if="variant === 'bar'" ref="root" class="relative">
    <button
      type="button"
      class="inline-flex h-9 items-center justify-center gap-0.5 rounded-lg px-1.5 text-[11px] font-bold uppercase tracking-wide text-white transition-colors hover:bg-white/10"
      aria-haspopup="true"
      :aria-expanded="open"
      :aria-label="`${t('language')}: ${currentName}`"
      :title="currentName"
      @click="open = !open"
    >
      {{ locale }}
      <svg
        class="h-3 w-3 shrink-0 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>

    <!-- The two addresses. The pane is kept in the document while it is shut (`invisible`) rather than drawn
         only while it is out, for the same reason the collections menu is: the pair is a link a crawler should
         find in the markup of every page, and a reader without JavaScript still gets the switch from the two
         entries. A shut pane is invisible rather than absent, so nothing in it can be clicked or focused. -->
    <div
      class="hoa-pop absolute right-0 top-full z-50 mt-2 w-44 p-1.5 transition-opacity duration-150"
      :class="open ? 'opacity-100' : 'invisible opacity-0'"
      role="menu"
    >
      <a
        v-for="code in SUPPORTED_LOCALES"
        :key="code"
        :href="hrefFor(code)"
        :hreflang="code"
        :title="NAMES[code]"
        :aria-current="code === locale ? 'true' : undefined"
        role="menuitem"
        class="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-semibold transition-colors"
        :class="code === locale ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
        @click="close"
      >
        <span class="grid h-6 w-8 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10 text-[10px] font-bold uppercase">
          {{ code }}
        </span>
        {{ NAMES[code] }}
        <!-- The one being read is marked with the brand's gold and a tick, so a reader who opened the pane to
             ask which language they are on is answered before they read a word of it. -->
        <svg v-if="code === locale" class="ml-auto h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clip-rule="evenodd" />
        </svg>
      </a>
    </div>
  </div>

  <!-- The panel a phone opens the navigation in: the two languages as two rows of it, side by side and as wide
       as the sheet, because there is nothing there to drop a pane from. -->
  <div v-else>
    <p :class="HEADING">{{ t('language') }}</p>
    <div class="flex gap-1.5 pb-1">
      <a
        v-for="code in SUPPORTED_LOCALES"
        :key="code"
        :href="hrefFor(code)"
        :hreflang="code"
        :title="NAMES[code]"
        :aria-current="code === locale ? 'true' : undefined"
        :class="code === locale ? ROW_ON : ROW_OFF"
      >
        {{ NAMES[code] }}
      </a>
    </div>
  </div>
</template>
