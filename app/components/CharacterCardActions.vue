<script setup lang="ts">
/**
 * The two buttons a comparison card carries, and the moment its figures were read.
 *
 * The comparison board draws two characters side by side and offers the same pair of acts on each of them:
 * save the character for a quick compare (the star), and re-read their figures from Blizzard (the refresh).
 * Both cards carry it, so it is written once here rather than twice in the board's template - a copy of a
 * control is a second place for its wording, its states and its glyph to drift, which is the rule the site
 * states about every repeated piece of itself.
 *
 * The moment the card's figures were read stands under the buttons, right-aligned, and it is the reading's
 * own moment rather than the moment the page was opened: a profile is answered from a two-hour cache, so
 * `fetchedAt` from the endpoint (`server/api/character`) is the only honest answer to "how old is this" -
 * and a reader who has just pressed the refresh sees it read "just now". The exact moment is kept for the
 * tooltip, the way a feed's cards keep one (`app/composables/relativeTime.ts`).
 *
 * The refresh is the caller's act and not this component's: the first character's button is the very one the
 * header carries (`refreshProfile` through the shell's context, with its cooldown and its toast), and the
 * second character's is the board's own read of them. What is shared is the face of it - the glyph, the spin
 * and the disabled state - which is what this component owns.
 */
import { useRelativeTime } from '~/composables/relativeTime'

const props = defineProps<{
  /** Whether this character is already saved for a quick compare, which is what fills the star. */
  saved: boolean
  /** Whether a refresh may be taken right now: not already reading, and not cooling down. */
  refreshable: boolean
  /** Whether a read is in flight, which is what spins the refresh glyph. */
  refreshing: boolean
  /** What the refresh button says - the act, the wait, or the seconds left - as its tooltip and its name. */
  refreshHint: string
  /** When this character's figures were read from Blizzard, in unix seconds, or absent when not known. */
  updatedAt?: number
}>()

const emit = defineEmits<{
  /** The star was pressed: save this character for a quick compare, or drop one already saved. */
  toggle: []
  /** The refresh was pressed. The caller knows which character it belongs to and how to read them again. */
  refresh: []
}>()

const { t } = useI18n()
const { formatRelative, formatAbsolute } = useRelativeTime()

/** How long ago the figures were read, in words - or nothing at all when the moment is not known. */
const updated = computed(() => (props.updatedAt ? formatRelative(props.updatedAt * 1000) : ''))

/** The exact moment behind those words, for the tooltip the label stands on. */
const updatedTitle = computed(() => (props.updatedAt ? formatAbsolute(props.updatedAt * 1000) : ''))
</script>

<template>
  <div class="ml-auto flex shrink-0 flex-col items-end gap-1">
    <div class="flex items-center gap-1.5">
      <!-- The star: the gesture the account page offers for a main (`app/pages/profile.vue`). A hollow star
           is a press away from being saved, a filled one is already saved, and it wears the brand gold - the
           colour the site saves a choice with. -->
      <button
        type="button"
        class="grid h-9 w-9 place-items-center rounded-xl border transition-colors"
        :class="saved
          ? 'border-wow-gold/60 bg-wow-gold/15 text-wow-goldLight'
          : 'border-white/15 bg-white/10 text-gray-300 hover:border-wow-gold/40 hover:text-wow-goldLight'"
        :aria-label="saved ? $t('vsFavoriteRemove') : $t('vsFavoriteAdd')"
        :title="saved ? $t('vsFavoriteRemove') : $t('vsFavoriteAdd')"
        :aria-pressed="saved"
        @click="emit('toggle')"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          :fill="saved ? 'currentColor' : 'none'"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
        </svg>
      </button>

      <!-- The refresh, in the shape the account page's own rows wear: icon only, a square of the site's glass,
           and a glyph that spins while the read is in flight. -->
      <button
        type="button"
        class="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition-colors hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="!refreshable"
        :title="refreshHint"
        :aria-label="refreshHint"
        @click="emit('refresh')"
      >
        <AppIcon name="refresh" class="h-4 w-4" :class="refreshing ? 'animate-spin' : ''" />
      </button>
    </div>

    <!-- When these figures were read, said the way the site dates anything: in words, with the precise moment
         on the tooltip. Nothing is printed while the moment is unknown. -->
    <span
      v-if="updated"
      class="text-[10px] font-semibold uppercase tracking-wider text-gray-500"
      :title="updatedTitle"
    >{{ $t('vsUpdated') }} {{ updated }}</span>
  </div>
</template>
