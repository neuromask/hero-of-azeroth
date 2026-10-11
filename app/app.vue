<script setup lang="ts">
// The waiting state every page of the site is read through. It is provided here because the root is
// the one component all of them are rendered under, and the preloader below draws what it holds.
providePageLoading()
</script>

<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <!-- The cookie question is the root's too: it is asked once, it is answered in the browser rather than on
         a page, and it stands over whichever page the reader happened to land on. -->
    <CookieNotice />
    <!-- The wheel is the root's own, so a wait looks the same whichever page is waiting for what. -->
    <PagePreloader />
  </div>
</template>

