<script setup lang="ts">
/**
 * The way in and out of a Battle.net account, as one plate in the header.
 *
 * Signed out it is the blue Battle.net button: the brand's own colour and mark, because the one
 * thing it promises is that the password is typed on Blizzard's page and never on this one. Signed
 * in it becomes the way to the profile and the way back out, which is what a reader who has an
 * account wants in that corner of the bar.
 *
 * The plate is the bar's own control, written once for the whole corner in `app/assets/css/main.css`
 * (`hoa-plate`): the download button's box, at the height every control of that row shares. Both
 * states wear the one class, so the plate cannot move or resize when a reader signs in - only its
 * colour changes, the brand's blue for the account (`hoa-plate-bnet`) and the neutral glass for the
 * way out beside it.
 *
 * The state comes from `/api/profile`, which answers `user: null` rather than a 401 - so the same
 * request a signed-out visitor makes is the one the button is drawn from, and the server renders
 * the right half of it (the session cookie rides along with the SSR request). The key is shared with
 * every other reader of the session on the page, so a page reads one request, not several.
 */
const { t } = useI18n()
const localeUrl = useLocaleUrl()

const { data } = await useFetch<{ user: { battletag: string | null } | null }>('/api/profile', {
  key: 'profile-identity'
})

const user = computed(() => data.value?.user || null)

/** The battletag without the account number the game appends, which is what a button can hold. */
const accountName = computed(() => (user.value?.battletag || '').split('#')[0] || 'Battle.net')
</script>

<template>
  <!-- Signed out: the Battle.net plate - the bar's own control, wearing the brand's blue. -->
  <a
    v-if="!user"
    href="/api/auth/login"
    :title="t('signInBattleNet')"
    class="hoa-plate hoa-plate-bnet"
  >
    <AppIcon name="battlenet" class="h-[1.15em] w-[1.15em]" />
    <span class="hidden max-w-[10rem] truncate sm:inline">{{ t('signInBattleNet') }}</span>
  </a>

  <!-- Signed in: the same plate with the account in it, and the way out beside it - one class for both
       states, so nothing moves or resizes when a reader signs in. -->
  <div v-else class="flex shrink-0 items-center gap-1.5">
    <NuxtLink
      :to="localeUrl('/profile')"
      :title="t('myProfile')"
      class="hoa-plate hoa-plate-bnet"
    >
      <AppIcon name="user" class="h-[1.15em] w-[1.15em]" />
      <span class="hidden max-w-[10rem] truncate sm:inline">{{ accountName }}</span>
    </NuxtLink>

    <a
      href="/api/auth/logout"
      :title="t('signOut')"
      class="hoa-plate"
    >{{ t('signOut') }}</a>
  </div>
</template>
