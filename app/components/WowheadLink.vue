<script setup lang="ts">
// The widget and the address a link points at (see the composable it shares with the feed).
import { useWowheadPower, wowheadUrl, type WowheadType } from '~/composables/wowheadPower'

/**
 * A link to a page on Wowhead that wears the game's own tooltip.
 *
 * The link is a real anchor - it carries the address, opens in a new tab and is read by a crawler -
 * and the tooltip is an enhancement the widget draws over it. Two shapes are offered: the default is
 * text inside a line of the page (the name of an achievement), and `iconOnly` is a bare icon whose
 * accessible name comes from the icon itself.
 */
const props = withDefaults(defineProps<{
  /** What the link names, which decides both the address and the tooltip. */
  type: WowheadType
  /** Blizzard's id for what the type names. */
  id: number | string
  /** The slot is only an icon, so the link drops the text treatment and keeps a bare hit area. */
  iconOnly?: boolean
}>(), { iconOnly: false })

const { locale } = useI18n()
const { refreshLinks } = useWowheadPower()

/** The address the link opens, on the subdomain the page's language reads Wowhead on. */
const href = computed(() => wowheadUrl(locale.value, props.type, props.id))

/** What the widget reads to build the tooltip: the type and the id, in the widget's own spelling. */
const dataWowhead = computed(() => `${props.type}=${props.id}`)

// The page fills in after the widget's first pass - the feed is read lazily, and a switch of
// language rewrites every address - so the widget is asked to look again whenever either happens.
onMounted(refreshLinks)
onUpdated(refreshLinks)
watch(locale, () => refreshLinks())
</script>

<template>
  <a
    :href="href"
    :data-wowhead="dataWowhead"
    target="_blank"
    rel="noopener noreferrer"
    :class="iconOnly
      ? 'inline-flex shrink-0 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:opacity-90 focus-visible:ring-2 focus-visible:ring-wow-gold/70'
      : 'group/wh inline-flex items-center gap-1.5 rounded-md text-inherit outline-none transition-colors hover:text-wow-goldLight focus-visible:text-wow-goldLight focus-visible:ring-2 focus-visible:ring-wow-gold/70'"
  >
    <slot />
  </a>
</template>