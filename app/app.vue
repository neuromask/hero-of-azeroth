<script setup lang="ts">
// The waiting state every page of the site is read through. It is provided here because the root is
// the one component all of them are rendered under, and the preloader below draws what it holds.
providePageLoading()
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <!-- The wheel is the root's own, so a wait looks the same whichever page is waiting for what. -->
    <PagePreloader />
  </div>
</template>

