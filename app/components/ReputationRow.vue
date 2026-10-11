<script setup lang="ts">
// The row the shelf hands over, the steps of its ladder, and the shapes both are drawn from.
import type { ReputationRow, ReputationStep } from '#shared/data/reputationsSchema'
// Counts are written by the site's one rule (`#shared/utils/formatNumber`), so a row prints its figures
// the way every other page prints them.
import { formatNumber } from '#shared/utils/formatNumber'

/**
 * One faction of a reputation journal: its name and the stage it stands at, both set into the measure
 * itself, with the fill standing behind them.
 *
 * The row is the bar. A name and a stage stacked over a line of their own is two elements and twice the
 * height for one fact, so the block a reader sees *is* the ladder's measure: its left end carries the
 * faction, its right end the stage and the numbers inside that stage, and the fill behind them says how far
 * along the character is. That is what makes a journal of two hundred rows one column of measures that can
 * be scanned down rather than a wall of stripes.
 *
 * The measure is the whole ladder, one stage taking an equal share of it, so a reader sees how many stages
 * are behind and ahead of them rather than how large the numbers happen to be - which is what makes a
 * renown ladder of thirty levels and a classic reputation of eight steps readable side by side. Every row's
 * is the same width, because a column of measures that can be compared at a glance is what the journal is
 * for; the divisions a ladder is cut into are not drawn on it.
 *
 * What a ladder *is* cut into is still read out on hover: the row carries the stage's name and the span it
 * covers (`Honored · 9 000 – 21 000`), which comes from the ledger the endpoint ships with the journal (see
 * `ReputationStep`), so a reader who wants to know what a stage is worth asks the row itself.
 */
const props = defineProps<{
  row: ReputationRow
  /** The steps of the row's ladder, empty for a ladder too long to carry its steps to the page. */
  steps: ReputationStep[]
}>()

const { t } = useI18n()

/** The stage in the reader's words: a renown level, a message key, or the atlas's own name for the step. */
const stage = computed(() => {
  const standing = props.row.standing
  if (!standing) return t('reputationsNotStarted')
  if (standing.level !== null) return t('reputationsRenown', { level: standing.level })

  return standing.key ? t(standing.key) : standing.label
})

/**
 * What stands beside it: the progress inside the stage, or the level of a renown ladder. A finished stage
 * prints nothing at all - `25 / 25` says no more than the stage's own name does, and it is the numbers of
 * two hundred finished factions that make a journal unreadable.
 */
const figures = computed(() => {
  const standing = props.row.standing
  if (!standing || props.row.finished) return ''
  if (standing.level !== null) {
    return `${formatNumber(standing.level)} / ${formatNumber(props.row.top)}`
  }

  return standing.max > 0 ? `${formatNumber(standing.value)} / ${formatNumber(standing.max)}` : ''
})

/**
 * What a hover over the bar says: the stage the character stands on and the span that stage covers.
 *
 * The step is the one `position` falls in - it is carried in stages, so `6.04` is six whole stages behind
 * the character and four hundredths of the seventh, which is the step the bar is read for. A ladder that
 * arrived without its steps (one too long to carry them) or one counted in levels has no span to name, and
 * the stage's own name is the whole of what the bar has to say.
 */
const tip = computed(() => {
  const standing = props.row.standing
  if (!standing) return ''

  const step = props.steps[Math.floor(props.row.position)] ?? null
  // A ladder's last step is often a point rather than a range (the classic table ends at Exalted, which
  // begins and ends at the same number), and a span of nought to nought says nothing a reader wants.
  if (!step || step.from === null || step.to === null || step.from === step.to) return stage.value

  return `${stage.value} · ${formatNumber(step.from)} – ${formatNumber(step.to)}`
})

/**
 * The colour of the fill, and the colour the stage's own words are read in.
 *
 * The row *is* the measure here - the words stand inside it - so the fill is a translucent tone rather than
 * a solid one, and the state is carried by the words as much as by the tone: emerald for a faction that is
 * finished, the brand gold while a reputation is being raised, sky while a renown ladder is being climbed,
 * and nothing but the plain track where the character has not started. A journal is two hundred rows long
 * and is read by scanning, so no fill is louder than it has to be.
 */
const fill = computed(() => {
  if (props.row.finished) return 'bg-emerald-400/20'
  if (props.row.renown) return 'bg-sky-400/25'

  return 'bg-wow-gold/20'
})

/** The stage's own words, in the colour the fill is: whatever the tone says, the words say as well. */
const stageClass = computed(() => {
  if (props.row.finished) return 'font-semibold text-emerald-300/80'
  if (!props.row.started) return 'font-semibold text-gray-600'
  if (props.row.renown) return 'font-semibold text-sky-300/90'

  return 'font-semibold text-wow-goldLight/90'
})

/** The faction's own name: plain where it is under way, dimmed where it has not been started at all. */
const nameClass = computed(() => (props.row.started ? 'text-gray-100' : 'text-gray-500'))
</script>

<template>
  <!-- The row *is* the measure: one block, a line of text tall with room around it, the faction's name set
       into its left and the stage it stands at set into its right, and the fill standing behind both.
       Nothing is stacked under anything, which is what keeps a journal of two hundred rows readable. -->
  <div
    class="relative flex h-8 w-full items-center justify-between gap-3 overflow-hidden rounded-lg bg-white/[0.04] px-2.5 transition-colors hover:bg-white/[0.07]"
    :title="tip"
  >
    <!-- The fill, standing behind the words: a translucent tone, because the words are read through it. -->
    <div
      class="absolute inset-y-0 left-0 transition-[width] duration-700"
      :class="fill"
      :style="{ width: `${row.percent}%` }"
      aria-hidden="true"
    />

    <!-- The mark of a ladder another character of the account has finished stands ahead of the name: the site's
         own star, so a row is read from its left edge (`ReputationRow.account`). -->
    <span class="relative flex min-w-0 items-center gap-1.5">
      <AppIcon v-if="row.account" name="star" class="h-3 w-3" :title="$t('reputationsAccountMark')" />
      <span class="truncate text-[13px] font-medium" :class="nameClass">{{ row.name }}</span>
    </span>

    <span class="relative flex shrink-0 items-baseline gap-2 whitespace-nowrap text-[11px]">
      <span :class="stageClass">{{ stage }}</span>
      <span v-if="figures" class="tabular-nums text-gray-400">{{ figures }}</span>
    </span>
  </div>
</template>

