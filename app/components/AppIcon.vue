<script setup lang="ts">
/**
 * One of the SVGs in `~/assets/icons`, picked by its file name.
 *
 * The whole folder is read up front, so dropping another file in there makes it
 * available as `<AppIcon name="my-icon" />` without a change here. The caller
 * decides the size and is expected to give it in `em` (`h-[1.15em] w-[1.15em]`),
 * which keeps the glyph the same optical size as the text it stands next to.
 */
const props = defineProps<{
  /** File name without the extension: `mounts` for `mounts.svg`. */
  name: string
  /** Set for the wordmark, which is content rather than decoration. */
  alt?: string
}>()

const icons = import.meta.glob('../assets/icons/*.svg', { eager: true, import: 'default' }) as Record<string, string>

const src = computed(() => {
  const file = Object.keys(icons).find((path) => path.endsWith(`/${props.name}.svg`))
  return file ? icons[file] || '' : ''
})
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt ?? ''"
    :aria-hidden="alt ? undefined : 'true'"
    class="inline-block shrink-0 select-none align-middle"
  />
</template>