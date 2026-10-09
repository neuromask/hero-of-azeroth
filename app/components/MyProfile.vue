<script setup lang="ts">
/**
 * Who this browser is signed in as: the character it looked at last.
 *
 * The site has no accounts, and it does not need any: a reader's "profile" is the character they last
 * opened, which the browser already remembers for the front page's history (`useSearchHistory`) - so
 * this chip is the sign-in state of the site, read from the same place the search field reads its
 * suggestions from. Opening a character page is what signs a reader in; clearing the browser's storage
 * is what signs them out.
 *
 * It shows the portrait Blizzard serves for the character, its name in its class colour and the realm
 * it lives on, and hands over the one thing a reader wants from it: the way back to the profile. A
 * character the media call had no picture for - or a row written before the portrait was kept - draws
 * a monogram in the class colour instead, and a reader who has not looked anybody up yet is offered
 * the search rather than an empty plate.
 *
 * The history lives in the browser, so it is read once the component is mounted, exactly as the front
 * page reads it: the server renders the "not signed in" state and the chip fills in a moment later.
 *
 * That empty state is a call to look somebody up, which is the chip's own job on a page that has no
 * search of its own - and it stands down (`signIn`) on a page whose row already carries the search
 * (`app/pages/leaderboard.vue`), so the same act is never offered twice in one bar.
 */
import { useSearchHistory } from '~/composables/searchHistory'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'

withDefaults(
  defineProps<{
    /**
     * Whether the chip offers the way in while this browser has nobody, which is the link to the
     * search. A page that offers the search itself asks for the chip alone: nothing is drawn until
     * there is somebody to draw.
     */
    signIn?: boolean
  }>(),
  { signIn: true }
)

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()

const { history, load } = useSearchHistory()

/** The character this browser looked at last, which is what the chip stands for. */
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
</script>

<template>
  <!-- The signed-in state: the portrait, who it is, and the way to their page. It draws no blur of
       its own - it stands on the bar's own glass, and a `backdrop-filter` there could only sample
       that glass (`app/assets/css/main.css`). -->
  <div
    v-if="current"
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

  <!-- Nobody yet: the chip becomes the way in rather than an empty plate - unless the page brings the
       search itself, in which case there is nothing for the chip to say. -->
  <NuxtLink
    v-else-if="signIn"
    :to="localeUrl('/')"
    class="hoa-tab hoa-liquid-glass w-full justify-center text-xs lg:w-auto"
    :title="t('profileSignIn')"
  >
    <AppIcon name="emblem" class="h-[1.1em] w-[1.1em]" />
    {{ t('profileSignIn') }}
  </NuxtLink>
</template>
