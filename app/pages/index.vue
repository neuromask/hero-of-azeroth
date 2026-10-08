<script setup lang="ts">
// The Russian copy of this page is the same component under `/ru`; the middleware reads
// the language off whichever of the two addresses was asked for.
definePageMeta({ alias: '/ru' })

// The home page has no rendered card of its own, so its preview image is a still of
// the site. Vite resolves the file to a URL carrying a content hash, which `usePageSeo`
// then makes absolute on the public host - a new picture is a new URL, so a network
// reading the old one picks the new artwork up on its own.
import hoaPrev from '~/assets/img/hoa-prev.jpg'

/**
 * The artwork the page cycles through behind the form: the six community backgrounds in
 * `~/assets/img`, one after another and then back to the first. Vite resolves each file to a
 * URL carrying a content hash, and every picture is in the markup from the first render, so
 * the browser has all six before the first change and a fade never lands on a half-loaded
 * image - which is what makes the change a cross-fade rather than a flash.
 */
import bg01 from '~/assets/img/bg-01.webp'
import bg02 from '~/assets/img/bg-02.webp'
import bg03 from '~/assets/img/bg-03.webp'
import bg04 from '~/assets/img/bg-04.webp'
import bg05 from '~/assets/img/bg-05.webp'
import bg06 from '~/assets/img/bg-06.webp'
// The characters searched before live in `localStorage`; the composable owns the shape and the
// bounds, and the page only reads the list and drops a row.
import { useSearchHistory, searchHistoryKey, type SearchHistoryEntry } from '~/composables/searchHistory'

const backgrounds = [bg01, bg02, bg03, bg04, bg05, bg06]

/** How long one picture is held before the next one fades in. */
const SLIDER_INTERVAL = 6000

/**
 * How long each status is held on the button while a search is in flight: long enough to be
 * read, short enough that a slow realm still reaches the second line before the card lands.
 */
const SEARCH_STATUS_INTERVAL = 1600

/**
 * Which picture is showing, and the id of the timer that walks through them. The server
 * renders the first one and the browser starts on that same index, so hydration sees the
 * markup it was given; the timer is only started in `onMounted`, so no rotation runs during
 * a render. `window` is named the way the character page names it, and it is where the id
 * of a browser timer comes from.
 */
const backgroundIndex = ref(0)
let backgroundTimer: number | null = null

/** Steps to the next picture, wrapping around at the end and back to the first. */
const showNextBackground = () => {
  backgroundIndex.value = (backgroundIndex.value + 1) % backgrounds.length
}

interface RealmOption {
  slug: string
  name: string
  region: 'eu' | 'us'
  /** The realm's other name: Russian for the realms the game has one for. */
  nameRu?: string
}

const { locale, t } = useI18n()
const router = useRouter()
const publicConfig = useRuntimeConfig().public

const realmQuery = ref('')
const selectedRealm = ref<RealmOption | null>(null)
const name = ref('')
const open = ref(false)
const realmError = ref(false)
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)
const realmInput = ref<HTMLInputElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
/** Whether the history list under the name field is open, and the field it hangs from. */
const nameOpen = ref(false)
const nameRootEl = ref<HTMLElement | null>(null)
/** The history row under the pointer, highlighted the way the realm list highlights a realm. */
const nameActiveIndex = ref(-1)

/**
 * The names and realms looked up before, read from `localStorage` on mount and offered under
 * the name field (see `app/composables/searchHistory.ts`). The list is written by the character
 * page once a search has actually found somebody, so it records successes rather than tries.
 */
const { history, load: loadHistory, forget } = useSearchHistory()

/**
 * What the page remembers for the length of a visit: the realm that was last picked. A session
 * rather than a cookie or `localStorage` - the character list is the thing worth keeping across
 * visits (see `useSearchHistory`), and this only keeps the realm field filled in meanwhile.
 */
const SESSION_REALM = 'hoa:realm'

/**
 * A browser can refuse storage outright (a private window, site data blocked), and
 * the form has to keep working without it, so both directions are wrapped.
 */
const readSession = (key: string): string => {
  try {
    return sessionStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

const writeSession = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // Nothing to do: the form simply does not remember anything this time.
  }
}

const realmsUrl = computed(() => `/api/realms?locale=${locale.value === 'ru' ? 'ru_RU' : 'en_US'}`)
const { data: realms, pending: realmsPending } = await useFetch<RealmOption[]>(realmsUrl, {
  key: 'realm-list',
  default: () => []
})

/**
 * The search page is the site's front door, so it carries the site-wide title and
 * description and the `WebSite` node behind the brand in a search result. The
 * characters are described by their own pages, which is where the content is.
 *
 * The `WebSite` node is the one piece of structured data a page without a subject
 * can offer: it names the site and the languages it serves.
 */
usePageSeo({
  title: () => t('homeTitle'),
  description: () => t('homeDescription'),
  // 1200x630, the size every network lays a large preview out for, and a JPEG while
  // the default is the PNG of the shared card, so the tags describe this file.
  image: hoaPrev,
  imageType: 'image/jpeg',
  jsonLd: () => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'HeroOfAzeroth',
    url: publicConfig.siteUrl,
    description: t('homeDescription'),
    inLanguage: [...SUPPORTED_LOCALES]
  })
})

/**
 * Realms matching what has been typed so far (both regions), under either of their
 * names: a Russian realm is found as `Гордунни` and as `Gordunni` alike.
 */
const matches = computed<RealmOption[]>(() => {
  const list = realms.value || []
  const query = realmQuery.value.trim().toLowerCase()
  if (!query) return list
  return list.filter(
    (realm) =>
      realm.name.toLowerCase().includes(query) ||
      (realm.nameRu || '').toLowerCase().includes(query) ||
      realm.slug.includes(query)
  )
})

/** Matches split into the EU / US blocks shown in the dropdown. */
const sections = computed(() => {
  let index = 0
  const blocks: Array<{ key: 'eu' | 'us'; label: string; items: Array<RealmOption & { index: number }> }> = []
  const labels: Array<{ key: 'eu' | 'us'; label: string }> = [
    { key: 'eu', label: `🇪🇺 ${t('europe')}` },
    { key: 'us', label: `🇺🇸 ${t('america')}` }
  ]

  for (const { key, label } of labels) {
    const items = matches.value
      .filter((realm) => realm.region === key)
      .map((realm) => ({ ...realm, index: index++ }))
    if (items.length) blocks.push({ key, label, items })
  }

  return blocks
})

/** Exact match on the typed text, used to keep the region in sync while typing. */
const resolvedRealm = computed<RealmOption | null>(() => {
  if (selectedRealm.value) return selectedRealm.value
  const query = realmQuery.value.trim().toLowerCase()
  if (!query) return null
  return (realms.value || []).find(
    (realm) => realm.name.toLowerCase() === query || realm.slug === query
  ) || null
})

const regionBadge = computed(() => {
  if (resolvedRealm.value) return resolvedRealm.value.region.toUpperCase()
  return ''
})

const highlightIn = (text: string, query: string) => {
  const at = query ? text.toLowerCase().indexOf(query) : -1
  if (at < 0) return [{ text, hit: false }]
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + query.length), hit: true },
    { text: text.slice(at + query.length), hit: false }
  ].filter((part) => part.text)
}

/** The realm list marks the typed part of a realm; the history rows mark their match the same way. */
const highlight = (text: string) => highlightIn(text, realmQuery.value.trim().toLowerCase())
const highlightName = (text: string) => highlightIn(text, name.value.trim().toLowerCase())

/**
 * The second name in a realm row: the Russian one, wherever it says something the first
 * does not, so a Russian realm reads `Gordunni · Гордунни`. When the two names are the
 * same string the slug stands in, which keeps every row naming the realm the address
 * will carry.
 */
const realmSecondary = (realm: RealmOption) =>
  realm.nameRu && realm.nameRu.toLowerCase() !== realm.name.toLowerCase() ? realm.nameRu : realm.slug

const selectRealm = (realm: RealmOption) => {
  selectedRealm.value = realm
  realmQuery.value = realm.name
  realmError.value = false
  open.value = false
  activeIndex.value = -1
  // A realm that was chosen is remembered as such, whether or not it is searched.
  writeSession(SESSION_REALM, realm.slug)
  nameInput.value?.focus()
}

const onRealmInput = () => {
  selectedRealm.value = null
  realmError.value = false
  open.value = true
  activeIndex.value = -1
}

/**
 * Empties the realm field in one tap, the way the best search fields do. The pointer is put
 * back in the field, and the `focus` handler above opens the list again - now on the empty
 * field, which is the whole realm list.
 */
const clearRealm = () => {
  realmQuery.value = ''
  selectedRealm.value = null
  realmError.value = false
  activeIndex.value = -1
  realmInput.value?.focus()
}

/** The same one-tap clear on the name field: the empty field brings the whole history back. */
const clearName = () => {
  name.value = ''
  nameActiveIndex.value = -1
  nameInput.value?.focus()
}

const move = (delta: number) => {
  open.value = true
  const total = matches.value.length
  if (!total) return
  const next = activeIndex.value + delta
  activeIndex.value = next < 0 ? total - 1 : next >= total ? 0 : next
  nextTick(() => {
    rootEl.value?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })
}

const onEnter = () => {
  if (open.value && activeIndex.value >= 0 && matches.value[activeIndex.value]) {
    selectRealm(matches.value[activeIndex.value]!)
    return
  }
  handleSearch()
}

/**
 * The realm a search is about to run on is remembered for the visit, so a return to this page
 * comes back with it filled in. The character itself is kept by the page that finds it (see
 * `useSearchHistory`), which is what makes the list a record of successes rather than of tries.
 */
const rememberRealm = (realm: RealmOption) => {
  writeSession(SESSION_REALM, realm.slug)
}

/**
 * The realm name a history row shows: the realm list's own name for the slug, which follows the
 * language, falling back to the name the entry was written with before the list arrives.
 */
const historyRealmName = (entry: SearchHistoryEntry) => {
  const known = (realms.value || []).find((realm) => realm.slug === entry.realm && realm.region === entry.region)
  return known?.name || entry.realmName
}

/**
 * The history narrowed by what is being typed - matched on the character, the realm name and the
 * slug alike, the same way the realm list narrows. An empty field shows the whole list, which is
 * what makes focusing the field the way back to it.
 */
const historyMatches = computed<SearchHistoryEntry[]>(() => {
  const query = name.value.trim().toLowerCase()
  if (!query) return history.value

  return history.value.filter((entry) =>
    entry.name.toLowerCase().includes(query) ||
    historyRealmName(entry).toLowerCase().includes(query) ||
    entry.realm.includes(query)
  )
})

/** Opens the list on focus or on typing, but only when there is something to show. */
const openName = () => {
  // A fresh list has nothing highlighted, the way the realm list starts on every keystroke.
  nameActiveIndex.value = -1
  if (history.value.length) nameOpen.value = true
}

/**
 * Picks a row: the name fills the field and the realm goes into the realm field, so the button
 * that follows can be pressed right away. A realm the list no longer holds - renamed since - is
 * still filled in from what the entry kept, so the search can go ahead.
 */
const selectHistory = (entry: SearchHistoryEntry) => {
  name.value = entry.name

  const known = (realms.value || []).find((realm) => realm.slug === entry.realm && realm.region === entry.region)
  const realm: RealmOption = known || { slug: entry.realm, name: entry.realmName, region: entry.region }
  selectedRealm.value = realm
  realmQuery.value = realm.name
  realmError.value = false

  writeSession(SESSION_REALM, realm.slug)
  open.value = false
  nameOpen.value = false
  nameActiveIndex.value = -1
}

/** Drops one row from the list, and closes it once the last one has gone. */
const removeHistory = (entry: SearchHistoryEntry) => {
  forget(entry)
  nameActiveIndex.value = -1
  if (!history.value.length) nameOpen.value = false
}

/**
 * Puts back what an earlier visit to the page left behind. A remembered slug that is
 * not in the realm list - the API renamed a realm, say - selects nothing rather than
 * filling the field with something that cannot be searched.
 */
const restoreSession = () => {
  const slug = readSession(SESSION_REALM)
  const realm = slug ? (realms.value || []).find((entry) => entry.slug === slug) : undefined

  if (realm) {
    selectedRealm.value = realm
    realmQuery.value = realm.name
  }
}

/**
 * What the button reads while a search is in flight. The address being pushed renders a
 * character, and that page asks Blizzard for it before it can draw: the navigation is held on
 * that fetch, so this page - and its button - stays on screen for as long as the request takes.
 * Two statuses take turns there, so a slow realm reads as progress rather than as a hang.
 */
const searching = ref(false)
const searchStatusIndex = ref(0)
const searchStatus = computed(() => {
  const statuses = [t('searchingRealm'), t('renderingCard')]
  return statuses[searchStatusIndex.value % statuses.length] || ''
})
let searchStatusTimer: number | null = null

const startSearchStatus = () => {
  searchStatusIndex.value = 0
  searchStatusTimer = window.setInterval(() => {
    searchStatusIndex.value += 1
  }, SEARCH_STATUS_INTERVAL)
}

const stopSearchStatus = () => {
  if (searchStatusTimer !== null) {
    window.clearInterval(searchStatusTimer)
    searchStatusTimer = null
  }
}

const handleSearch = async () => {
  if (searching.value) return

  const realm = resolvedRealm.value || (matches.value.length === 1 ? matches.value[0]! : null)
  if (!realm) {
    // Without a realm we cannot tell whether the character is on EU or US.
    realmError.value = true
    open.value = true
    realmInput.value?.focus()
    return
  }

  const character = name.value.trim()
  if (!character) return

  // Recorded before the navigation, which leaves this page behind.
  rememberRealm(realm)

  // The button turns into the progress indicator for as long as the character page is fetching
  // from Blizzard. That page only paints once it has its character, and until it does the form is
  // still on screen - so the wait is shown here, and it is the page unmounting that ends it (see
  // `onBeforeUnmount`) rather than the address changing, which happens before the character does.
  searching.value = true
  startSearchStatus()
  try {
    await router.push(localePath(locale.value, `/${regionPath(realm.region)}/${realm.slug}/${character}`))
  } catch {
    // The navigation never left - a guard turned it away, say - so the form goes back to normal.
    stopSearchStatus()
    searching.value = false
  }
}

const onDocumentClick = (event: MouseEvent) => {
  const target = event.target as Node
  if (!rootEl.value?.contains(target)) open.value = false
  if (!nameRootEl.value?.contains(target)) nameOpen.value = false
}

onMounted(() => {
  // Only in the browser: the server has no session to read, and filling the fields
  // after hydration keeps the rendered page the same for everyone.
  restoreSession()
  loadHistory()
  document.addEventListener('mousedown', onDocumentClick)
  // Likewise, the rotation only exists here: a server render has no timer, and the first
  // picture is already the one the markup was drawn with.
  backgroundTimer = window.setInterval(showNextBackground, SLIDER_INTERVAL)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  if (backgroundTimer !== null) window.clearInterval(backgroundTimer)
  stopSearchStatus()
})
</script>


<template>
  <div class="relative min-h-screen bg-wow-dark flex flex-col items-center justify-center p-4">
    <!-- The community artwork (`app/assets/img/bg-01.webp` through `bg-06.webp`) covers the
         whole page, one picture at a time: the six are stacked on each other and the page
         fades between them, so the change is a cross-fade and never a blank frame. Every
         scene is a bright one, so a flat scrim plus a vignette dim whichever is showing
         just enough for the glass box and the gold accents to stay readable. -->
    <img
      v-for="(picture, index) in backgrounds"
      :key="picture"
      :src="picture"
      alt=""
      aria-hidden="true"
      class="fixed inset-0 h-full w-full object-cover transition-opacity duration-[3200ms] ease-in-out"
      :class="index === backgroundIndex ? 'opacity-100' : 'opacity-0'"
    />
    <div class="fixed inset-0 bg-wow-dark/45"></div>
    <div class="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(8,10,15,0.65)_100%)]"></div>

    <!-- The form is the same liquid glass as the boxes on the character page. -->
    <div class="relative z-20 max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <!-- The wordmark carries the brand, so the heading is the artwork: it is
               sized to the cap height the text had before (text-3xl). -->
          <h1>
            <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-16 w-auto" />
          </h1>
          <p class="text-xs text-white-400 mt-2">{{ $t('tagline') }}</p>
        </div>

        <!-- The languages are the pair every page carries, so the switch a reader learns on the
             character page is the one they meet here (`app/components/LocaleSwitch.vue`). -->
        <LocaleSwitch />
      </div>

      <form @submit.prevent="handleSearch" class="space-y-4">
        <div ref="nameRootEl" class="relative">
          <input
            ref="nameInput"
            v-model="name"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('characterNamePlaceholder')"
            required
            class="w-full bg-black/60 border border-white/10 rounded-lg px-4 py-2.5 pr-10 text-white placeholder-gray-500 focus:outline-none focus:border-wow-gold transition-colors"
            @focus="openName"
            @input="openName"
            @keydown.esc="nameOpen = false"
          />
          <!-- One tap empties the whole field, the way the best search fields do: it is there only
               while there is something to clear, it keeps the focus on the field (so the list does
               not flicker), and the empty field is the way back to the whole history. -->
          <button
            v-if="name"
            type="button"
            :aria-label="$t('clearField')"
            :title="$t('clearField')"
            class="absolute right-3 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            @mousedown.prevent
            @click="clearName"
          >&#10005;</button>
          <!-- The characters searched before, a row each. The list is the same glass as the realm
               dropdown, and a row is shaped the same way - the name, then ` · ` and the realm in
               the smaller grey type - so the two lists read as one control. It opens on focus or
               on typing when there is something to show, a row fills the name and the realm both,
               and the cross on the right drops one character without picking it. -->
          <div
            v-if="nameOpen && historyMatches.length"
            class="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150"
          >
            <p class="sticky top-0 bg-black/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-white/5 backdrop-blur-xl">
              {{ $t('searchHistory') }}
            </p>
            <div
              v-for="(entry, i) in historyMatches"
              :key="searchHistoryKey(entry)"
              class="group relative"
              @mouseenter="nameActiveIndex = i"
            >
              <button
                type="button"
                :data-active="nameActiveIndex === i"
                class="w-full text-left px-4 py-2 pr-10 text-sm transition-colors"
                :class="nameActiveIndex === i ? 'bg-wow-gold/15 text-wow-gold' : 'text-gray-200 hover:bg-white/5'"
                @click="selectHistory(entry)"
              >
                <!-- The remembered name wears the colour of the class it was found with; a
                     match under the pointer keeps the gold the search marks it with. -->
                <CharacterName :class-id="entry.classId" :class-name="entry.class">
                  <span v-for="(part, k) in highlightName(entry.name)" :key="k" :class="part.hit ? 'text-wow-gold font-bold' : ''">{{ part.text }}</span>
                </CharacterName>
                <span class="text-gray-500 text-xs"> · <span v-for="(part, k) in highlightName(historyRealmName(entry))" :key="'realm-' + k" :class="part.hit ? 'text-wow-gold font-bold' : ''">{{ part.text }}</span></span>
              </button>
              <button
                type="button"
                class="absolute right-2 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-xs leading-none text-gray-500 opacity-0 transition-colors hover:bg-white/10 hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100"
                :aria-label="$t('removeFromHistory')"
                :title="$t('removeFromHistory')"
                @click.stop="removeHistory(entry)"
              >&#10005;</button>
            </div>
          </div>
        </div>

        <div>
          <div ref="rootEl" class="relative">
            <input
              ref="realmInput"
              v-model="realmQuery"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :placeholder="$t('realmPlaceholder')"
              class="w-full bg-black/60 border rounded-lg px-4 py-2.5 pr-24 text-white placeholder-gray-500 focus:outline-none focus:border-wow-gold transition-colors"
              :class="realmError ? 'border-red-500/70' : 'border-white/10'"
              @focus="open = true"
              @input="onRealmInput"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="onEnter"
              @keydown.esc="open = false"
            />
            <!-- The realm field carries the same one-tap clear; it keeps the focus so the list
                 reopens on the now-empty field. It sits to the left of the region badge. -->
            <button
              v-if="realmQuery"
              type="button"
              :aria-label="$t('clearField')"
              :title="$t('clearField')"
              class="absolute right-3 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              @mousedown.prevent
              @click="clearRealm"
            >&#10005;</button>
            <span
              v-if="regionBadge"
              class="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded border"
              :class="resolvedRealm?.region === 'eu'
                ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
                : 'border-rose-400/40 bg-rose-400/10 text-rose-300'"
            >{{ regionBadge }}</span>

            <div
              v-if="open"
              class="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150"
            >
              <p v-if="realmsPending && !realms.length" class="px-4 py-3 text-sm text-gray-400">{{ $t('loading') }}</p>
              <p v-else-if="!matches.length" class="px-4 py-3 text-sm text-gray-400">{{ $t('noRealms') }}</p>
              <template v-else>
                <div v-for="section in sections" :key="section.key">
                  <p class="sticky top-0 bg-black/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-white/5 backdrop-blur-xl">
                    {{ section.label }}
                  </p>
                  <button
                    v-for="r in section.items"
                    :key="r.slug"
                    type="button"
                    :data-active="activeIndex === r.index"
                    class="w-full text-left px-4 py-2 text-sm transition-colors"
                    :class="activeIndex === r.index ? 'bg-wow-gold/15 text-wow-gold' : 'text-gray-200 hover:bg-white/5'"
                    @mouseenter="activeIndex = r.index"
                    @click="selectRealm(r)"
                  >
                    <span v-for="(part, i) in highlight(r.name)" :key="i" :class="part.hit ? 'text-wow-gold font-bold' : ''">{{ part.text }}</span>
                    <span class="text-gray-500 text-xs"> · <span v-for="(part, j) in highlight(realmSecondary(r))" :key="j" :class="part.hit ? 'text-wow-gold font-bold' : ''">{{ part.text }}</span></span>
                  </button>
                </div>
              </template>
            </div>
          </div>
          <p v-if="realmError" class="mt-1 text-xs text-red-400">{{ $t('pickRealm') }}</p>
        </div>

        <button 
          type="submit" 
          class="w-full mt-2 bg-gradient-to-r from-amber-600 to-wow-gold text-black font-extrabold py-3 rounded-lg hover:brightness-110 transition-all shadow-lg uppercase text-sm tracking-wider disabled:cursor-wait disabled:brightness-95"
          :disabled="searching"
        >
          <!-- While the character page is fetching from Blizzard, the button becomes the wait:
               a spinner and a status that takes turns, so a slow realm reads as progress. -->
          <span v-if="searching" class="inline-flex items-center justify-center gap-2.5">
            <span class="h-4 w-4 animate-spin rounded-full border-2 border-black/70 border-t-transparent" aria-hidden="true"></span>
            <span class="animate-pulse">{{ searchStatus }}</span>
          </span>
          <span v-else>{{ $t('find') }}</span>
        </button>
      </form>
    </div>

    <!-- The brand line under the box, drawn by the same component the character page's footer
         carries, so the two pages sign off identically. The column above centres the box and the
         line as one block, so the box keeps its place while the line stays the same. -->
    <footer class="relative z-10 mt-4 text-xs text-gray-500">
      <SiteFooter />
    </footer>

    <!-- Back to the top of the page, and the support plate - the two corners the site keeps a
         floating control in. -->
    <BackToTop />
    <SupportButton />
  </div>
</template>
