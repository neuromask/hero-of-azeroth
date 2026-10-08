<script setup lang="ts">
/**
 * The backdrop every page of the site stands on: the artwork, a flat scrim, a vignette, and the
 * brand's own glow behind it all, drawn as one fixed layer under the page.
 *
 * It is one component because it is one look. A character page stands on Blizzard's class artwork,
 * the hall of fame stands on the site's own picture, and the front page on the six it cycles
 * through - and all three are darkened the same way, with the same scrim and the same vignette, so
 * that they read as one site rather than three. Before this was a component, the character shell
 * spelled the four layers out itself; a page built later would have copied them, and the two would
 * have drifted apart on the first tweak.
 *
 * `treatment` is the one thing the pages genuinely disagree about: the Armoury's artwork is painted
 * dark and desaturated and has to be lifted to match the site, while the site's own pictures are
 * painted for exactly this use and are left alone.
 *
 * The layer is `pointer-events-none` and `aria-hidden`, because it is scenery: nothing in it is
 * clickable and none of it is content.
 */
const props = withDefaults(
  defineProps<{
    /** The artwork to stand on. Without one the glow and the scrim are drawn on their own. */
    image?: string
    /**
     * How the artwork is treated. `armoury` is Blizzard's class art, which is lifted so it matches
     * the site's own pictures; `artwork` is one of those pictures, left as it was painted.
     */
    treatment?: 'armoury' | 'artwork'
  }>(),
  { treatment: 'artwork' }
)

const imageClass = computed(() =>
  props.treatment === 'armoury'
    ? 'absolute inset-0 h-full w-full object-cover saturate-[1.5] brightness-[1.45]'
    : 'absolute inset-0 h-full w-full object-cover'
)
</script>

<template>
  <div class="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <!-- The brand's own warmth, a wide soft glow behind whatever artwork the page stands on. -->
    <div
      class="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/5 blur-[120px]"
    ></div>

    <img v-if="image" :src="image" alt="" :class="imageClass" />

    <!-- The scrim and the vignette, which are what keep the glass panels above readable over any
         artwork: the flat darkening brings the whole picture down, and the vignette takes the edges
         further than the middle, so the eye is left with the page rather than the picture. -->
    <div class="absolute inset-0 bg-wow-dark/45"></div>
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(8,10,15,0.65)_100%)]"></div>
  </div>
</template>
