<script setup lang="ts">
/**
 * Who this browser is: the Battle.net account it is signed in as, or the character it looked at
 * last.
 *
 * The site reads the sign-in off `/api/profile`, which answers `user: null` to a visitor who has
 * not signed in - so this chip is the one place the two states are told apart. Signed in, it is an
 * account chip: the battletag, a way to the profile and a way out. Signed out, it keeps the state
 * the site has always had - the character this browser opened last, read from the same history the
 * front page's search suggestions come from (`useSearchHistory`) - and, on a page that offers no
 * search of its own, a link to one.
 *
 * The account is fetched with `useFetch`, so the server renders the chip already knowing the state
 * (the session cookie rides along with the SSR request) and no layout shift follows the hydration.
 * The guest half still fills in on mount, because it lives in the browser and nowhere else.
 */
import { useSearchHistory } from '~/composables/searchHistory'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'

withDefaults(
  defineProps<{
    /**
     * Whether the chip offers the way in while this browser has no account, which is the link to
     * the search. A page that offers the search itself asks for the chip alone.
     */
    signIn?: boolean
  }>(),
  { signIn: true }
)

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()

/** The account as the profile endpoint reports it, or `null` for a visitor. */
const { data } = await useFetch<{ user: { battletag: string | null } | null }>('/api/profile', {
  key: 'profile-identity'
})
const signedIn = computed(() => Boolean(data.value?.user))

const { history, load } = useSearchHistory()

/** The character this browser looked at last, which is the guest half of the chip. */
const current = computed(() => history.value[0] || null)

/** The address of that character's own page, or of the search when there is nobody yet. */
const profileUrl = computed(() => {
  const entry = current.value
  return entry ? localeUrl(`/${regionPath(entry.region)}/${entry.realm}/${entry.name}`) : localeUrl('/')
})

/** The colour the name and the monogram are drawn in: the class of that character. */
const hex = computed(() => classById(current.value?.classId)?.hex || DEFAULT_CLASS_HEX)

/** The class in the language being read, which is the second half of the line under the name. */
const className = computed(() => {
  const entry = classById(current.value?.classId)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
})

/** The letter a chip without a portrait shows. */
const initial = computed(() => (current.value?.name || '').charAt(0).toUpperCase())

/** A portrait that failed to load, which the monogram then stands in for. */
const broken = ref(false)
watch(current, () => {
  broken.value = false
})

onMounted(load)

/** The battletag as it is drawn, with the account number the game appends left off. */
const accountName = computed(() => (data.value?.user?.battletag || '').split('#')[0] || 'Battle.net')
</script>

<template>
  <!-- Signed in: the account, where a guest sees the character they last looked at. The whole chip
       is the way to the profile, because that is the one thing a signed-in reader wants from it. -->
  <NuxtLink
    v-if="signedIn"
    :to="localeUrl('/profile')"
    class="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-2 lg:w-auto"
  >
    <span class="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-wow-gold/40 bg-wow-gold/10">
      <AppIcon name="emblem" class="h-6 w-6" />
    </span>

    <div class="min-w-0">
      <p class="text-[10px] font-normal uppercase tracking-wider text-gray-500">{{ t('profileSignedIn') }}</p>
      <p class="truncate text-sm font-bold leading-tight text-white">{{ accountName }}</p>
      <p class="truncate text-xs text-gray-400">{{ t('myProfile') }}</p>
    </div>
  </NuxtLink>

  <!-- Signed out with a character behind this browser: the guest chip, exactly as it was. -->
  <div
    v-else-if="current"
    class="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-2 lg:w-auto"
  >
    <span
      class="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border"
      :style="{ borderColor: `${hex}66`, backgroundColor: `${hex}1f` }"
    >
      <span class="text-base font-extrabold" :style="{ color: hex }">{{ initial }}</span>
      <img
        v-if="current.avatar && !broken"
        :src="current.avatar"
        :alt="current.name"
        loading="lazy"
        decoding="async"
        class="absolute inset-0 h-full w-full object-cover"
        @error="broken = true"
      />
    </span>

    <div class="min-w-0">
      <p class="text-[10px] font-normal uppercase tracking-wider text-gray-500">{{ t('profileSignedIn') }}</p>
      <p class="truncate text-sm font-bold leading-tight" :style="{ color: hex }">{{ current.name }}</p>
      <p class="truncate text-xs text-gray-400">
        {{ current.realmName }}<span v-if="className"> · {{ className }}</span>
      </p>
    </div>

    <NuxtLink :to="profileUrl" class="hoa-tab hoa-liquid-glass ml-auto shrink-0 px-3 py-1.5 text-xs">
      {{ t('profileOpen') }}
    </NuxtLink>
  </div>

  <!-- Nobody yet: the chip becomes the Battle.net sign-in, or the way to the search on a page that
       brings its own. -->
  <a
    v-else-if="signIn"
    href="/api/auth/login"
    class="hoa-tab hoa-liquid-glass w-full justify-center text-xs lg:w-auto"
    :title="t('signInBattleNet')"
  >
    <AppIcon name="emblem" class="h-[1.1em] w-[1.1em]" />
    {{ t('signInBattleNet') }}
  </a>
</template>

