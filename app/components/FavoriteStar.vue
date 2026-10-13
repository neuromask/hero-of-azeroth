<script setup lang="ts">
/**
 * The star that saves a character for the list of favorites, drawn beside a name that is not itself part of
 * that list.
 *
 * There are two halves of this gesture on the site, and they are two on purpose. A search field's own list
 * and the comparison board are lists *of* remembered characters, so their star is the state of the row: it
 * is always drawn, filled or hollow, and it says which of the two a character is (`CharacterSearchForm`,
 * `CharacterVersus`). This is the other half: the star beside a name the site draws among figures - the rows
 * of the hall of fame, and a name in a header. Both halves write the same list
 * (`app/composables/versusFavorites.ts`), so a character saved from one is filled in the other. A
 * character's own page draws the star too, but as a button of its own in the header beside Refresh
 * (`app/pages/[region]/[realm]/[name].vue`): a reader standing on one character is not scanning a column,
 * so the mark can afford to be a control rather than a whisper.
 *
 * It is drawn under the pointer unless the caller passes `always`, and the difference is what the star is
 * taken for. The hall of fame passes it: that table is read by scanning it for a character the reader already
 * has, and a mark that only appears where the pointer happens to rest is a mark they have to hunt for. A star
 * left as an offer is the other reading - the caller wraps what it belongs to in `group/name` and the star
 * fades in with it, which is also the arrangement that keeps the star visible while the pointer rests on the
 * star itself (`app/components/CharacterSearchForm.vue` uses the same pair for the cross on a remembered row).
 * Either way the star brightens with the row it stands in.
 *
 * The list is read on mount here, because the page the star stands on may not read it itself: a table of
 * rows draws names, not the list, and a star that assumed nobody had read it would paint an empty star over
 * a character the reader saved a minute ago on the page next door.
 */
import type { SearchHistoryEntry } from '#shared/utils/savedCharacters'
import { useVersusFavorites } from '~/composables/versusFavorites'

const props = withDefaults(
  defineProps<{
    /** The character the star is about, in the shape both remembered lists are kept in. */
    entry: SearchHistoryEntry
    /** How much room the star takes: the size of a name in a row, or of a name in a header. */
    size?: 'sm' | 'md'
    /**
     * Whether the star is drawn whether or not the pointer is on what it stands beside.
     *
     * `false` is the star as an offer, which is what a name in a header wants; `true` is the star as a state
     * of the row, which is what a table of names a reader scans wants. It is the same star either way, and
     * either way it brightens with the row it stands in.
     */
    always?: boolean
  }>(),
  { size: 'sm', always: false }
)

const { t } = useI18n()
const { load, has, toggle } = useVersusFavorites()

onMounted(load)

/** Whether this character is already saved, which is what the star is drawn filled for. */
const saved = computed(() => has(props.entry))

/** What the star says to a pointer and to a screen reader: the act it performs, not the state it is in. */
const label = computed(() => (saved.value ? t('vsFavoriteRemove') : t('vsFavoriteAdd')))

/** The crown of the star, shared with every other star on the site (`CharacterSearchForm`). */
const STAR_PATH =
  'M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z'
</script>

<template>
  <button
    type="button"
    class="grid shrink-0 place-items-center rounded transition-all duration-200"
    :class="[
      size === 'md' ? 'h-7 w-7' : 'h-6 w-6',
      saved
        ? 'text-wow-goldLight opacity-100'
        : [
            'text-gray-500 focus-visible:opacity-100 group-hover/name:text-wow-goldLight hover:bg-white/10 hover:text-wow-goldLight',
            always ? 'opacity-100' : 'opacity-0 group-hover/name:opacity-100'
          ]
    ]"
    :aria-label="label"
    :title="label"
    :aria-pressed="saved"
    @click.stop.prevent="toggle(entry)"
  >
    <svg
      :class="size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'"
      viewBox="0 0 24 24"
      :fill="saved ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path :d="STAR_PATH" />
    </svg>
  </button>
</template>
