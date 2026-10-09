<script setup lang="ts">
// The one place a class colour is turned into something visible: the same table the card and
// the page read (see `#shared/utils/wow-class`), so all three agree on what a Rogue wears.
import { classColorHex } from '#shared/utils/wow-class'

/**
 * A character's name, or a class, in the class's own colour.
 *
 * `variant="name"` (the default) is the plain form: the text keeps the class colour as its
 * base, which lets a caller drop a highlighted match on top of it - the gold a search marks a
 * hit with outranks an inherited colour, so the mark still reads. `variant="badge"` is the
 * plate the character page prints the spec and class on: the same frame the rest of the meta
 * line wears, tinted with the class colour instead of the amber.
 *
 * A class that cannot be resolved (a very old history row with no class, a name the API sent
 * in a language the table does not carry) falls back to the brand gold, so a name is always
 * legible and never left uncoloured.
 */
const props = withDefaults(defineProps<{
  /** Blizzard's class id, preferred because it is the same in every language. */
  classId?: number | null
  /** The localised class name, or its Armoury slug, when no id is at hand. */
  className?: string | null
  /** Drawn when the caller gives no slot. */
  name?: string
  /** The plain coloured text, or the class plate. */
  variant?: 'name' | 'badge'
}>(), { variant: 'name' })

const hex = computed(() => classColorHex({ classId: props.classId, class: props.className }))
</script>

<template>
  <!-- The plate the badge is drawn in carries no blur of its own: it is worn inside a page's own
       glass (the character bar), where a `backdrop-filter` could only sample that glass - already
       blurred and nearly flat - and where Chromium smears a blurred copy of the bar's content over
       its bottom edge (`app/assets/css/main.css`). -->
  <span
    v-if="variant === 'badge'"
    class="inline-flex items-center px-2.5 py-0.5 rounded-lg border border-amber-500/50 bg-slate-950/40 text-xs font-semibold"
    :style="{ color: hex }"
  >
    <slot>{{ name }}</slot>
  </span>
  <span v-else :style="{ color: hex }">
    <slot>{{ name }}</slot>
  </span>
</template>