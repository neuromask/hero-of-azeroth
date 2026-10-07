<script setup lang="ts">
// Entering the collections opens on the mounts shelf: the address without a shelf names the first
// one, so /…/collections and /…/collections/mounts are the same page.
definePageMeta({
  redirect: (to) => `${to.path.replace(/\/+$/, '')}/mounts`
})
</script>

<template>
  <span />
</template>