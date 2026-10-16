<script setup lang="ts">
/**
 * The site's overall score, and what it is made of: a gold question mark that opens the multipliers the figure is
 * summed from.
 *
 * One component because the question is asked in three places and the answer must not be written twice. A table
 * where the score is the figure it ranks wears it in its filter bar, beside the field
 * (`app/components/leaderboard/LeaderboardFilters.vue`); the profile asks it beside the main's own gold figure,
 * which is the same number, computed by the same rule on the server (`app/pages/profile.vue`,
 * `server/utils/playerScore.ts`); and the front door's plate, which is about the overall rating, asks it the same
 * way. It is the question mark alone wherever it stands, because the figure it explains is the one right beside it -
 * the words are the pane's.
 *
 * The multipliers are read off `SCORE_WEIGHTS` rather than written out here, so the panel a reader opens and the
 * formula the server computes with cannot drift apart: this is the same table, drawn. It opens in the pane every
 * menu of the site opens in (`.hoa-pop`), stands until a click lands outside it or Escape is pressed, and hangs
 * from whichever edge the control that opened it stands on.
 */
import { SCORE_WEIGHTS } from '#shared/utils/leaderboardScore'

/**
 * The figures the score is made of, in the order the table draws them, each with the multiplier it carries.
 */
const SCORE_LEGEND = [
  { key: 'achievements', icon: 'achievments', label: 'achievements', weight: SCORE_WEIGHTS.achievements },
  { key: 'mounts', icon: 'mounts', label: 'mounts', weight: SCORE_WEIGHTS.mounts },
  { key: 'toys', icon: 'toys', label: 'toys', weight: SCORE_WEIGHTS.toys },
  { key: 'pets', icon: 'pets', label: 'pets', weight: SCORE_WEIGHTS.pets },
  { key: 'decor', icon: 'decor', label: 'decor', weight: SCORE_WEIGHTS.decor },
  { key: 'reputations', icon: 'exalted-rep', label: 'reputations', weight: SCORE_WEIGHTS.reputations }
] as const

withDefaults(
  defineProps<{
    /**
     * Which edge the panel hangs from. `right` (the default) opens it leftwards from the button, which is what a
     * control standing at the end of a row wants; `left` opens it the other way, for a control near a page's
     * left edge.
     */
    align?: 'left' | 'right'
  }>(),
  { align: 'right' }
)

const { t } = useI18n()

/** Whether the panel is open - the reader's own click opens it and everything else shuts it. */
const open = ref(false)
const root = ref<HTMLElement | null>(null)

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
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <!-- The question, and nothing else: the figure it explains is the one standing in the table beside it (or in the
         plate above it), so a reader who wonders where that number comes from has one press to make - and the words
         of the answer are inside the pane, where they are read once rather than beside every table on the site. -->
    <button
      type="button"
      class="hoa-liquid-glass grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold text-wow-goldLight"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :title="t('lbLegendTitle')"
      :aria-label="t('lbLegendTitle')"
      @click="open = !open"
    >
      ?
    </button>

    <div
      class="hoa-pop absolute top-full mt-2 w-72 p-3 transition-opacity duration-150"
      :class="[align === 'right' ? 'right-0' : 'left-0', open ? 'opacity-100' : 'invisible opacity-0']"
      role="dialog"
      :aria-label="t('lbLegendHeading')"
    >
      <p class="text-[11px] font-semibold uppercase tracking-wider text-wow-goldLight">{{ t('lbLegendHeading') }}</p>
      <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('lbLegendIntro') }}</p>

      <ul class="mt-3 space-y-1.5">
        <li
          v-for="row in SCORE_LEGEND"
          :key="row.key"
          class="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 transition-colors hover:border-wow-gold/30 hover:bg-white/[0.06]"
        >
          <AppIcon :name="row.icon" class="h-[1.1em] w-[1.1em]" />
          <span class="text-sm text-gray-200">{{ t(row.label) }}</span>
          <span class="ml-auto text-sm font-extrabold tabular-nums text-wow-goldLight">×{{ row.weight }}</span>
        </li>
      </ul>

      <p class="mt-3 border-t border-white/10 pt-2 text-xs leading-relaxed text-gray-500">
        {{ t('lbLegendNote') }}
      </p>
    </div>
  </div>
</template>
