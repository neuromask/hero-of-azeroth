<script setup lang="ts">
/**
 * The account the site is being read with, as one dropdown in the corner of a header.
 *
 * Signed out it is the way in and nothing else: the Battle.net mark on the brand's own blue, because the one
 * thing the control promises is that the password is typed on Blizzard's page and never on this one. Signed
 * in it becomes one control that says who the reader is and offers everything the account is for - the main the
 * account leads with, the roster of characters, the settings and the way back out - rather than the two plates
 * (a link and a sign-out button) that used to stand side by side in the row under the header: the pair belonged
 * together, and a menu is where a reader now finds the third thing the account can do.
 *
 * The state comes from `/api/profile`, which answers `user: null` rather than a 401 - so the same request a
 * signed-out visitor makes is the one the control is drawn from, and the server renders the right half of it
 * (the session cookie rides along with the SSR request). The key is shared with every other reader of the
 * session on the page, so a page reads one request, not several.
 *
 * The main the menu leads with comes off that same answer: the roster it carries names it (`isMain`), so the
 * quickest way to a reader's own character costs no second call - and it is the row the profile page badges and
 * the hall of fame prints, so the two corners cannot disagree about who the account leads with.
 *
 * A session whose Battle.net sign-in stopped working (`server/utils/session`) gets the way in back, saying what
 * it is for (`signInAgain`): naming an account the site can no longer read is the one thing this corner must
 * not do.
 *
 * Like the language switch beside it, the control draws no glass of its own - the plate it stands in is the
 * group's (`app/components/HeaderTools.vue`) - and the menu it opens is the site's own pane (`.hoa-pop`). The
 * entries are the site's addresses: the main is its character page, the roster is the account page, and the
 * settings are that page carrying the hash the drawer answers (`app/pages/profile.vue`), since a page cannot be
 * asked to open a drawer by a menu that stands somewhere else.
 */
// The class colour the main's name is drawn in, read from the one table the card, the page and the search
// history share (see `#shared/utils/wow-class`).
import { classColorHex } from '#shared/utils/wow-class'

const { t } = useI18n()
const route = useRoute()
const localeUrl = useLocaleUrl()

const { data } = await useFetch<{
  user: { battletag: string | null; authExpired?: boolean; isAdmin?: boolean } | null
  /**
   * The account's roster, which the same answer already carries. The menu reads one row of it - the main - so
   * only the fields that name it and lead to its page are asked for, rather than the whole `ProfileCharacter`
   * shape the profile page draws.
   */
  characters: { region: string; realmSlug: string; name: string; classId: number | null; isMain: boolean }[]
}>('/api/profile', {
  key: 'profile-identity'
})

const user = computed(() => data.value?.user || null)

/** Whether the account's Battle.net sign-in stopped working, which brings the way in back. */
const authExpired = computed(() => user.value?.authExpired === true)

/**
 * Whether this account may open the admin panel, which is the one entry the menu keeps from everybody else.
 *
 * The flag arrives on the identity the menu already reads (`/api/profile`, `server/utils/siteSettings`), so a
 * corner that shows the entry costs no second request - and it is the server's answer rather than the browser's,
 * which is what makes hiding the entry a convenience instead of a lock: the panel's own data is served by an
 * endpoint that refuses anybody the site does not list as an administrator.
 */
const isAdmin = computed(() => user.value?.isAdmin === true)

/** The battletag without the account number the game appends, which is what a button can hold. */
const accountName = computed(() => (user.value?.battletag || '').split('#')[0] || 'Battle.net')

/** The battletag as the game spells it, account number and all: the one place the site prints it whole. */
const battletag = computed(() => user.value?.battletag || '')

/**
 * The character the account leads with, which is the one the menu offers a way to.
 *
 * It is the same row the profile page badges and the hall of fame publishes (`isMain`), and the payload arrives
 * with it first (`server/api/profile` orders by `is_main DESC`); the search here stands in for a build that
 * ordered the roster otherwise, exactly as the front page reads its own main. An account that has not named a
 * main yet leads with its first character, which is what the profile page does with the same roster; `null` is
 * left for an account the site holds no characters for, and that is what keeps the entry out rather than
 * pointing it at nobody.
 */
const mainCharacter = computed(() => {
  const characters = data.value?.characters || []
  return characters.find((entry) => entry.isMain) || characters[0] || null
})

/** The main's own page, in the language being read, or `null` while the account leads with nobody. */
const mainUrl = computed(() => {
  const main = mainCharacter.value
  return main ? localeUrl(`/${regionPath(main.region)}/${main.realmSlug}/${main.name}`) : null
})

/** The colour the main's name is drawn in, which is its class's - the way the site names a character. */
const mainHex = computed(() => classColorHex({ classId: mainCharacter.value?.classId }))

withDefaults(
  defineProps<{
    /** Where the control is drawn: the group in a header's corner, or the sheet a phone's menu drops. */
    variant?: 'bar' | 'panel'
  }>(),
  { variant: 'bar' }
)

/** Whether the dropdown is out, and the box a press has to land outside of to shut it. */
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function close() {
  open.value = false
}

/**
 * A press anywhere but the control and its menu is a reader who is done with the account, read the way the
 * site's other panes read a press: an entry that has just been picked is the page being read (or the address
 * the browser is about to follow), and a click listener would then be reported against an entry the menu has
 * already left behind.
 */
function onDocumentPress(event: MouseEvent) {
  if (!open.value) return

  const target = event.target as Node
  if (root.value?.contains(target)) return

  close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPress)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentPress)
  document.removeEventListener('keydown', onKeydown)
})

/** An entry that has just been picked is the page being read, so the menu is done with. */
watch(
  () => route.fullPath,
  () => {
    close()
  }
)

/** The settings, which are the account page carrying the drawer's own hash (`app/pages/profile.vue`). */
const settingsUrl = computed(() => ({ path: localeUrl('/profile'), hash: '#settings' }))

/** The admin panel's own address, in the language being read (`app/pages/admin.vue`). */
const adminUrl = computed(() => localeUrl('/admin'))

/** A row of the menu, and the states it has - written whole, the way the site's panes write theirs. */
const ROW = 'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors'
const ROW_OFF = `${ROW} text-gray-200 hover:bg-white/10 hover:text-white`
/** The way out, which is the one entry of the menu that is not a place: it is drawn as what it is. */
const ROW_OUT = `${ROW} text-red-300 hover:bg-red-500/10 hover:text-red-200`
/** A row of the panel, which is a touch wider than a row of a menu: it is read at arm's length. */
const PANEL_ROW = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors'
const PANEL_OFF = `${PANEL_ROW} text-gray-200 hover:bg-white/10 hover:text-white`
const PANEL_OUT = `${PANEL_ROW} text-red-300 hover:bg-red-500/10 hover:text-red-200`
/**
 * The administrator's entry, which is the one row of the menu that is not the same for every reader: it wears
 * the brand gold rather than the grey of a place, because it is the site's own machinery rather than a page
 * about the character being read - and both widths draw it, so the panel is as reachable on a phone as in a bar.
 */
const ROW_ADMIN = `${ROW} text-wow-goldLight hover:bg-wow-gold/10 hover:text-wow-gold`
const PANEL_ADMIN = `${PANEL_ROW} text-wow-goldLight hover:bg-wow-gold/10 hover:text-wow-gold`
/** The hairline that says the entry under it is not another of the entries above. */
const SEP = 'my-1 block h-px bg-white/10'
/** The heading a group of the panel is named by, in the reader's own words. */
const HEADING = 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500'
/** The face of an entry, drawn as the panes of the site draw theirs: a small square of glass and a glyph. */
const GLYPH = 'grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10'
/**
 * The face of the main's entry, in the gold the profile page badges that character with: the two corners name
 * one character, so they wear the one mark (`app/pages/profile.vue`).
 */
const MAIN_GLYPH = 'grid h-6 w-6 shrink-0 place-items-center rounded-md border border-wow-gold/50 bg-wow-gold/15 text-wow-goldLight'
/** The way in, at either width: the brand's blue and the brand's mark, which is the whole of its promise. */
const SIGN_IN = 'inline-flex h-9 items-center gap-2 rounded-lg bg-[#0074e0]/30 px-3 text-xs font-bold text-white transition-colors hover:bg-[#0074e0]/45'
</script>

<template>
  <!-- The way in: what a reader without an account sees, and what an account the site can no longer read sees
       as well. In a bar it is one control carrying the brand's mark and, from `sm` up, the words of the promise -
       the password is typed on Blizzard's page and never on this one. In the panel a phone opens the navigation
       in it is a row of that panel, under its heading, like every other entry there. -->
  <template v-if="!user || authExpired">
    <a
      v-if="variant === 'bar'"
      href="/api/auth/login"
      :title="authExpired ? t('sessionExpired') : t('signInBattleNet')"
      :class="SIGN_IN"
    >
      <AppIcon name="battlenet" class="h-[1.15em] w-[1.15em]" />
      <span class="hidden max-w-[10rem] truncate sm:inline">
        {{ authExpired ? t('signInAgain') : t('signInBattleNet') }}
      </span>
    </a>

    <div v-else>
      <p class="mt-1 border-t border-white/10" :class="HEADING">{{ t('navAccountGroup') }}</p>

      <a href="/api/auth/login" :class="PANEL_OFF">
        <span :class="GLYPH"><AppIcon name="battlenet" class="h-4 w-4" /></span>
        {{ authExpired ? t('signInAgain') : t('signInBattleNet') }}
      </a>
    </div>
  </template>

  <!-- The account, in the corner of a header: one control holding the face, the name and the caret, so the bar
       is the same width before and after a reader signs in - and the menu under it is everything the account
       is for. -->
  <div v-else-if="variant === 'bar'" ref="root" class="relative">
    <button
      type="button"
      class="inline-flex h-9 max-w-[11rem] items-center gap-2 rounded-lg px-2.5 text-xs font-bold text-white transition-colors hover:bg-white/10"
      aria-haspopup="true"
      :aria-expanded="open"
      :title="accountName"
      @click="open = !open"
    >
      <span class="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border border-[#00aeff]/40 bg-[#0074e0]/25">
        <AppIcon name="user" class="h-3.5 w-3.5" />
      </span>
      <span class="max-w-[7rem] truncate">{{ accountName }}</span>
      <svg
        class="h-3 w-3 shrink-0 transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>

    <!-- The account's own menu. Its head names the account rather than offering anything - the mark the password
         is typed at, and the battletag whole, account number and all, which is the one place the site spells it
         out - and the three entries under it are the roster, the settings and the way out, the way out drawn
         apart from the other two because it is not a place. -->
    <div
      class="hoa-pop absolute right-0 top-full z-50 mt-2 w-64 p-1.5 transition-opacity duration-150"
      :class="open ? 'opacity-100' : 'invisible opacity-0'"
      role="menu"
    >
      <p :class="HEADING">{{ t('profileSignedIn') }}</p>

      <div class="flex items-center gap-2.5 px-1.5 pb-2">
        <span class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-[#00aeff]/40 bg-[#0074e0]/25">
          <AppIcon name="battlenet" class="h-5 w-5" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-white">{{ accountName }}</p>
          <p v-if="battletag" class="truncate text-xs text-gray-400">{{ battletag }}</p>
        </div>
      </div>

      <span :class="SEP" aria-hidden="true" />

      <!-- The main the account leads with, straight to its page: a reader who has named a main is far more
           often on their way to that character than through the roster to find it. The name is drawn in its
           class's colour and the plate in the gold the profile badges it with, so the two corners say the same
           thing - and the entry is left out entirely while the account leads with nobody. -->
      <NuxtLink
        v-if="mainUrl"
        :to="mainUrl"
        role="menuitem"
        :class="ROW_OFF"
        :title="t('profileMainBadge')"
        @click="close"
      >
        <span :class="MAIN_GLYPH">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 8.4l3.7 2.8L12 4.6l4.3 6.6L20 8.4l-1.5 9.2a1 1 0 0 1-1 .8H6.5a1 1 0 0 1-1-.8L4 8.4Z" />
            <path d="M6.6 20.5h10.8" />
          </svg>
        </span>
        <span class="truncate" :style="{ color: mainHex }">{{ mainCharacter?.name }}</span>
        <span class="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-wow-goldLight">
          {{ t('profileMain') }}
        </span>
      </NuxtLink>

      <NuxtLink :to="localeUrl('/profile')" role="menuitem" :class="ROW_OFF" @click="close">
        <span :class="GLYPH"><AppIcon name="user" class="h-3.5 w-3.5" /></span>
        {{ t('navMyCharacters') }}
      </NuxtLink>

      <NuxtLink :to="settingsUrl" role="menuitem" :class="ROW_OFF" @click="close">
        <span :class="GLYPH">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </span>
        {{ t('profileSettings') }}
      </NuxtLink>

      <!-- The administrator's way into the panel: the menu's one entry that is the site's own machinery rather
           than a page about the character being read, kept behind the gold and behind the flag the server answers
           with (`isAdmin`). It stands under its own hairline so it never reads as another account entry beside
           the settings above it. -->
      <template v-if="isAdmin">
        <span :class="SEP" aria-hidden="true" />

        <NuxtLink :to="adminUrl" role="menuitem" :class="ROW_ADMIN" @click="close">
          <span :class="GLYPH">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3l7.5 3v5.6c0 4.3-3 8.2-7.5 9.4-4.5-1.2-7.5-5.1-7.5-9.4V6L12 3Z" />
              <path d="m9 12 2.2 2.2L15.5 10" />
            </svg>
          </span>
          {{ t('adminTitle') }}
        </NuxtLink>
      </template>

      <span :class="SEP" aria-hidden="true" />

      <a href="/api/auth/logout" role="menuitem" :class="ROW_OUT" @click="close">
        <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-red-400/25 bg-red-500/10">
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
          </svg>
        </span>
        {{ t('signOutAccount') }}
      </a>
    </div>
  </div>

  <!-- The account in the panel a phone opens the navigation in: the same entries as rows of it, under
       the heading of the group - and no pane under them, because the panel is the pane. They carry no way to
       shut anything: a row that has just been picked is the page being read, and the panel closes on the
       address changing (`app/components/SiteNav.vue`). -->
  <div v-else>
    <p class="mt-1 border-t border-white/10" :class="HEADING">{{ t('navAccountGroup') }}</p>

    <NuxtLink v-if="mainUrl" :to="mainUrl" :class="PANEL_OFF" :title="t('profileMainBadge')">
      <span :class="MAIN_GLYPH">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 8.4l3.7 2.8L12 4.6l4.3 6.6L20 8.4l-1.5 9.2a1 1 0 0 1-1 .8H6.5a1 1 0 0 1-1-.8L4 8.4Z" />
          <path d="M6.6 20.5h10.8" />
        </svg>
      </span>
      <span class="truncate" :style="{ color: mainHex }">{{ mainCharacter?.name }}</span>
      <span class="ml-auto shrink-0 text-[10px] font-bold uppercase tracking-wider text-wow-goldLight">
        {{ t('profileMain') }}
      </span>
    </NuxtLink>

    <NuxtLink :to="localeUrl('/profile')" :class="PANEL_OFF">
      <span :class="GLYPH"><AppIcon name="user" class="h-3.5 w-3.5" /></span>
      {{ t('navMyCharacters') }}
    </NuxtLink>

    <NuxtLink :to="settingsUrl" :class="PANEL_OFF">
      <span :class="GLYPH">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
          <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      </span>
      {{ t('profileSettings') }}
    </NuxtLink>

    <!-- The administrator's entry of the panel, which is the bar's own row drawn a touch wider: the same flag,
         the same gold, the same place under the settings (`isAdmin`). -->
    <NuxtLink v-if="isAdmin" :to="adminUrl" :class="PANEL_ADMIN">
      <span :class="GLYPH">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3l7.5 3v5.6c0 4.3-3 8.2-7.5 9.4-4.5-1.2-7.5-5.1-7.5-9.4V6L12 3Z" />
          <path d="m9 12 2.2 2.2L15.5 10" />
        </svg>
      </span>
      {{ t('adminTitle') }}
    </NuxtLink>

    <a href="/api/auth/logout" :class="PANEL_OUT">
      <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-red-400/25 bg-red-500/10">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
        </svg>
      </span>
      {{ t('signOutAccount') }}
    </a>
  </div>
</template>

