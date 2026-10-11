<script setup lang="ts">
/**
 * The pair of chips a collections page and the reputation journal both carry: this character's own numbers, or
 * the whole account's.
 *
 * It draws the choice and nothing else - whether it is offered, what it means and what the answer was belong to
 * the page that stands it (`CollectionScopeSwitch.vue`, `ReputationShelf.vue`) - so the two cannot drift apart
 * in the way they ask the same question of a reader.
 */
defineProps<{
  /** What is being chosen, read out for a screen reader (`collectionsViewScope` and its like). */
  label: string
}>()

const model = defineModel<boolean>({ required: true })

const { t } = useI18n()

/** The treatment of the chosen half: the brand gold, the way the account page draws its publish switch. */
const CHOSEN = 'bg-wow-gold/15 text-wow-goldLight shadow-[0_0_0_1px_rgba(248,183,0,0.45)]'
const RESTING = 'text-gray-400 hover:text-white'
</script>

<template>
  <span
    role="group"
    :aria-label="label"
    class="inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.04] p-0.5"
  >
    <button
      type="button"
      :aria-pressed="!model"
      class="rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors"
      :class="!model ? CHOSEN : RESTING"
      @click="model = false"
    >
      {{ t('perCharacter') }}
    </button>
    <button
      type="button"
      :aria-pressed="model"
      class="rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors"
      :class="model ? CHOSEN : RESTING"
      @click="model = true"
    >
      {{ t('accountWide') }}
    </button>
  </span>
</template>
