<script setup lang="ts">
const SLUG = 'neuromask'

/** The button as the service's own API renders it, in the colours of the snippet. */
const BUTTON = `https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=${SLUG}&button_colour=FFDD00&font_colour=000000&font_family=Comic&outline_colour=000000&coffee_colour=ffffff`
</script>

<template>
  <a
    :href="`https://buymeacoffee.com/${SLUG}`"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Buy me a coffee"
    class="fixed bottom-4 right-4 z-20 block transition-transform hover:scale-105"
  >
    <img 
      :src="BUTTON" 
      alt="" 
      aria-hidden="true" 
      class="h-10 w-auto select-none sm:h-12 opacity-70 transition-opacity hover:opacity-100" 
    />
  </a>
</template>