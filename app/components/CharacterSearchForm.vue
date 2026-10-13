<script setup lang="ts">
/**
 * The two fields that look a character up: the realm, and the name on it.
 *
 * It is the site's front door cut down to what finds a character, and it is one component rather than
 * two copies because it is the same act wherever it is offered - the card on the front page and the
 * panel the hall of fame's row opens are the same two fields, the same suggestions and the same
 * progress. A copy of either would be a second place for a realm to be resolved, a name to be
 * remembered and a search to be sent, and the two would drift the moment one of them was touched.
 *
 * What it owns is the whole act: the realm list and its keyboard handling, the characters this
 * browser has looked up before, the rule for what makes a search possible, and the navigation to the
 * character's own page. The page it is dropped into owns the frame around it and nothing else, which
 * is why `autofocus` is the only thing either caller tells it.
 *
 * A search is also how a character enters the hall of fame: the page it opens is what reads the
 * profile from Blizzard and writes the row into the table (see the note on the feed point in
 * `server/api/character/[region]/[realm]/[name].get.ts`), so the progress the button shows while the
 * realm is being read is the progress of a character being added to the ranking.
 */
import { useSearchHistory, searchHistoryKey, mergeSearchEntries, type SearchHistoryEntry } from '~/composables/searchHistory'

const props = withDefaults(
  defineProps<{
    /**
     * Whether the form puts the cursor in the name field as soon as it appears. The front page's card
     * is the subject of the page and is left alone; a panel a reader has just opened is focused,
     * because that is what they opened it for.
     */
    autofocus?: boolean
    /**
     * The name the field opens with, when the search was asked for on one rather than typed into - the
     * reader pressed the way out of an empty table, or arrived from a page that has no row for the
     * character they want. The caller owns the name and the form owns the field: it goes in exactly as a
     * remembered character would, and nothing else about the form changes.
     */
    initialName?: string
    /**
     * Whether the two fields and the button stand in one row rather than stacked.
     *
     * The form is offered in two shapes and both are the same act: the card a page sets room aside for, and the
     * bar of a page that has no room to set aside - the front door, where a reader who has never been here meets
     * the search in the header and everything the search finds stands under it (`app/pages/index.vue`). Only the
     * room each control takes changes. The shells a field drops, the remembered characters, the progress on the
     * button and the address a search opens are the same ones, because a second implementation of any of them is
     * the very thing this component exists to prevent.
     */
    compact?: boolean
    /**
     * Where a search leads.
     *
     * Everywhere else on the site a search opens the character's own page, because rendering that page is
     * what reads the profile and writes the character into the table. The comparison page asks the same two
     * fields for a different reason - the second character is looked up only to be read beside the first -
     * so the address it opens is the comparing one (`/${current}/vs/${region}/${realm}/${name}`) and nothing
     * else about the act changes: the realm list, the remembered characters and the progress are the same.
     */
    target?: 'profile' | 'versus'
    /**
     * The address of the comparison page this form stands on, in the language being read, and only used when
     * `target` is `versus`: the path the looked-up character's own three segments are appended to. It is
     * handed in rather than worked out here, because only the page knows which character is being compared.
     */
    vsBase?: string
  }>(),
  { autofocus: false, initialName: '', compact: false, target: 'profile', vsBase: '' }
)

/**
 * The room each control takes, in the two shapes the form is offered in.
 *
 * It is one object of whole class strings rather than a set of classes the compact form adds, because the two
 * shapes are not additive: `px-4` does not stop applying because a second class says `px-3` - which utility wins
 * is the order Tailwind emits them in, not the order they are written in the markup - so a field that is a
 * column wide in one place and a row narrow in another has to be one string chosen per shape, not two strings
 * stacked. What is shared is what the controls *are* (their colour, their border, their focus ring), and that
 * stays in the markup where both shapes can be read against it.
 */
const layout = computed(() =>
  props.compact
    ? {
        /** The three controls in one row, wrapping when the window is narrow. */
        form: 'flex flex-wrap items-center gap-2',
        /** The room a field takes in a bar: a fraction of a row rather than the whole of a card. */
        cell: 'w-full sm:w-48',
        /**
         * The field itself, which draws no box of its own: its box is the glass under it (`hoa-liquid-glass`
         * on the wrapper), because an `<input>` is a replaced element and never gets a `::before` - the layer
         * the site's whole material is painted on. So the height, the room inside and the type size live here,
         * and the colour, the rim and the frost live on the box around it.
         */
        input: 'h-10 px-3 text-sm',
        /** Room kept inside the field for what stands at its right edge, and for the clear button. */
        name: 'pr-9',
        realm: 'pr-20',
        clear: 'right-2',
        badge: 'right-8',
        /** The button in a row: as wide as its own word, and exactly as tall as the fields beside it. */
        submit: 'h-10 shrink-0 px-4 text-xs'
      }
    : {
        form: 'space-y-4',
        cell: '',
        input: 'h-11 px-4',
        name: 'pr-10',
        realm: 'pr-24',
        clear: 'right-3',
        badge: 'right-12',
        submit: 'w-full mt-2 h-11 text-sm'
      }
)

/**
 * What the two fields say while they are empty.
 *
 * The card has room for the invitation the site has always written there ("Start typing a realm..."), and the bar
 * of a page does not: a field of twelve rems shows about ten characters before it clips, so the bar asks for the
 * same two things in the shortest words the site has for them. The realm's own list and the remembered characters
 * are what tell a reader the rest, and both are one tap away (`focus`).
 */
const placeholders = computed(() =>
  props.compact
    ? { name: t('nameShort'), realm: t('realmShort') }
    : { name: t('characterNamePlaceholder'), realm: t('realmPlaceholder') }
)

interface RealmOption {
  slug: string
  name: string
  region: 'eu' | 'us'
  /** The realm's other name: Russian for the realms the game has one for. */
  nameRu?: string
}

/**
 * How long each status is held on the button while a search is in flight: long enough to be
 * read, short enough that a slow realm still reaches the second line before the card lands.
 */
const SEARCH_STATUS_INTERVAL = 1600

const { locale, t } = useI18n()
const router = useRouter()

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
 * The characters saved for a quick comparison, which the star on a remembered row toggles.
 *
 * The saved characters are not a list of their own: they are offered under the name field beside the ones this
 * browser looked up, as one list (see `historyMatches`), because a reader looking for a character does not care
 * which of the two remembered it. The star is therefore on every row rather than only on the comparison page's
 * rows - a list a reader can see is a list a reader can change - and the state is shared rather than private
 * (`useVersusFavorites`), because the comparison board draws the same list.
 */
const {
  favorites,
  load: loadVersusFavorites,
  has: isVersusFavorite,
  toggle: toggleVersusFavorite,
  remove: removeFavorite
} = useVersusFavorites()

/** Whether this form is the one that opens a comparison, which is where a search leads on the board. */
const versusMode = computed(() => props.target === 'versus')

/**
 * What the form remembers for the length of a visit: the realm that was last picked. A session
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

/**
 * The realm list, asked for in the language being read. It is not awaited: nothing on the way to the
 * first frame needs it - the dropdown is shut until a reader opens it, and the remembered realm is
 * put back on mount, which is a browser-side step in any case - and a form that can be opened from a
 * panel must not hold that panel's first frame on a fetch. Nuxt still collects the request while the
 * server renders, so the pages that draw the form up front serve the list with the document.
 */
const realmsUrl = computed(() => `/api/realms?locale=${locale.value === 'ru' ? 'ru_RU' : 'en_US'}`)
const { data: realms, pending: realmsPending } = useFetch<RealmOption[]>(realmsUrl, {
  key: 'realm-list',
  default: () => []
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
 * The realm a search is about to run on is remembered for the visit, so a return to this form
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
 * The list under the name field: what this browser looked up and what it saved for a quick compare, merged
 * into one list (`mergeSearchEntries`), then narrowed by what is being typed - matched on the character, the
 * realm name and the slug alike, the same way the realm list narrows. An empty field shows everything, which is
 * what makes focusing the field the way back to it.
 */
const historyMatches = computed<SearchHistoryEntry[]>(() => {
  const list = mergeSearchEntries(favorites.value, history.value)

  const query = name.value.trim().toLowerCase()
  if (!query) return list

  return list.filter((entry) =>
    entry.name.toLowerCase().includes(query) ||
    historyRealmName(entry).toLowerCase().includes(query) ||
    entry.realm.includes(query)
  )
})

/**
 * Whether the remembered characters are under the name field: the list is drawn while this browser has
 * one and the field holds the cursor (`nameOpen`).
 *
 * It is named once because two things read the same answer. One is the pane itself. The other is the lift
 * on the field (`z-30` in the template): a field's glass is a stacking context of its own (`isolation` in
 * `app/assets/css/main.css`), so the pane's `z-50` counts only against what stands inside the field - the
 * field *box* has to be lifted, or the realm field under it, later in the document and a glass of its own,
 * is painted over the pane's first rows. It is the arrangement the hall of fame's filter bar is built on
 * (`relative z-20` on the panel, `app/components/leaderboard/LeaderboardFilters.vue`).
 */
const historyOpen = computed(() => nameOpen.value && historyMatches.value.length > 0)

/**
 * Opens the list on focus or on typing, but only when there is something to show.
 *
 * Only one of the form's two lists can be under it: the cursor is in this field, so the realm list the
 * field below opened is shut as the cursor arrives. A press does the same thing (`onDocumentClick`), and
 * the two would otherwise be drawn over each other - the realm field, later in the document, over the
 * first rows of this list.
 */
const openName = () => {
  open.value = false
  // A fresh list has nothing highlighted, the way the realm list starts on every keystroke.
  nameActiveIndex.value = -1
  if (history.value.length || favorites.value.length) nameOpen.value = true
}

/** The same act for the realm field: its list opens as the cursor enters the field, and the history list shuts. */
const openRealm = () => {
  nameOpen.value = false
  open.value = true
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

/**
 * Drops one row from the list. The row may be there because the character was looked up, because it was saved,
 * or because of both - and the cross means "not this one any more" rather than "not in this half of the list",
 * so it goes from both. The list shuts once the last row has gone.
 */
const removeHistory = (entry: SearchHistoryEntry) => {
  forget(entry)
  if (isVersusFavorite(entry)) removeFavorite(entry)
  nameActiveIndex.value = -1
  if (!history.value.length && !favorites.value.length) nameOpen.value = false
}

/**
 * Puts back what an earlier visit left behind. A remembered slug that is not in the realm list - the
 * API renamed a realm, say - selects nothing rather than filling the field with something that
 * cannot be searched.
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
 * Puts the cursor in the name field, which is the field a reader already has an answer to. The realm
 * is the form's own job rather than theirs: it is remembered from the last visit, and a search with
 * no realm picked offers the realm list at the moment it is submitted.
 */
const focusStart = () => {
  if (!props.autofocus) return
  nextTick(() => nameInput.value?.focus())
}

/**
 * Puts a name the caller asked for into the field.
 *
 * A search that is asked for rather than typed is the same act from the form's side: the field is filled
 * and the reader presses the button, so the form keeps its own rules about what makes a search possible -
 * a realm is still picked from the list, and the name is still the reader's to correct. It is applied on
 * mount, because a sheet that was opened for the ask brings a fresh form with it, and watched as well,
 * because a form that is already on screen can be asked a second time: another row of the table, or the
 * same row of another page.
 */
const applyInitialName = () => {
  const asked = props.initialName.trim()
  if (asked) name.value = asked
}

watch(() => props.initialName, applyInitialName)

/**
 * What the button reads while a search is in flight. The address being pushed renders a
 * character, and that page asks Blizzard for it before it can draw: the navigation is held on
 * that fetch, so this form - and its button - stays on screen for as long as the request takes.
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
    // A search on the comparison page does not open the character's own page - it opens the comparison of
    // this character against them, which is why the second character's three segments are appended to the
    // board's own address rather than standing as an address of their own. The segments are spelled the way
    // the comparison address spells them (`/vs/eu/azuregos/name`): the region bare, the way the address was
    // asked for, and the realm's slug rather than its name.
    const address = versusMode.value && props.vsBase
      ? `${props.vsBase}/${realm.region}/${realm.slug}/${character}`
      : localePath(locale.value, `/${regionPath(realm.region)}/${realm.slug}/${character}`)

    await router.push(address)
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
  loadVersusFavorites()
  applyInitialName()
  focusStart()
  document.addEventListener('mousedown', onDocumentClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  stopSearchStatus()
})
</script>


<template>
  <!-- The name first, the realm under it, then the button: the field a reader has an opinion about is the one
       they fill in first, and the realm is the one the form can remember for them. In the bar of a page that
       has no room for a card the three stand in one row instead (`compact`), in the same order - a reader who
       met the search once should not have to find where each field went the second time.

       A field is the site's own glass (`hoa-liquid-glass`) on the box that carries it, with the input itself
       transparent inside: the material is painted on a layer the box owns, and an `<input>` is a replaced
       element that never gets one, so the box is the field's body and the input is its text. The rim warms to
       the brand gold while the field holds the cursor (`focus-within`), which is what the box's own
       `focus:border-wow-gold` used to do on the input.

       The list a field drops is drawn inside that glass, and a glass surface is a stacking context of its
       own (`isolation`, in `app/assets/css/main.css`) - so the pane's own `z-50` says nothing against what
       stands outside the field, and the field below it, later in the document and a glass of its own, would
       be painted over the pane's first rows. The field whose list is showing is therefore lifted over the
       rest of the form (`z-30`, which is above the hall of fame's filter bar at `z-20` as well - this form
       stands over that bar on the front door) while the field beside it stays where it is, and the two lists
       take turns (`openName`, `openRealm`), so no field is ever drawn over a list that is already open.
       Nothing else about the shape moves, and while no list is open neither field is lifted at all. -->
  <form :class="layout.form" @submit.prevent="handleSearch">
    <div
      ref="nameRootEl"
      class="hoa-liquid-glass relative rounded-lg focus-within:[--hoa-ring:rgba(248,183,0,0.55)]"
      :class="[layout.cell, historyOpen ? 'z-30' : '']"
    >
      <input
        ref="nameInput"
        v-model="name"
        type="text"
        autocomplete="off"
        spellcheck="false"
        :placeholder="placeholders.name"
        required
        class="w-full rounded-lg bg-transparent text-white placeholder-gray-400 focus:outline-none"
        :class="[layout.input, layout.name]"
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
        class="absolute top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        :class="layout.clear"
        @mousedown.prevent
        @click="clearName"
      >&#10005;</button>
      <!-- The characters searched before, a row each. The list is the same pane the realm field
           drops below it (`hoa-pop`), and a row is shaped the same way - the name, then ` · ` and the
           realm in the smaller grey type - so the two lists read as one control. It opens on focus or
           on typing when there is something to show, a row fills the name and the realm both, and the
           cross on the right drops one character without picking it. -->
      <div
        v-if="historyOpen"
        class="hoa-pop absolute mt-1 w-full"
      >
        <div class="max-h-72 overflow-y-auto">
          <p class="hoa-pop-title">
            {{ $t('searchListTitle') }}
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
              class="w-full text-left px-4 py-2 pr-16 text-sm transition-colors"
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
            <!-- The star, on every row: the list under this field holds both what was looked up and what was
                 saved for a comparison, so the way to change which of the two a character is has to stand
                 beside it. It is the gesture the account page offers for a main (`app/pages/profile.vue`) - a
                 hollow star is a press away from being saved, a filled one is already saved - and it wears the
                 brand gold when filled, the colour the site saves a choice with. -->
            <button
              type="button"
              class="absolute right-8 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded transition-colors hover:bg-white/10"
              :class="isVersusFavorite(entry) ? 'text-wow-goldLight' : 'text-gray-500 hover:text-wow-goldLight'"
              :aria-label="isVersusFavorite(entry) ? $t('vsFavoriteRemove') : $t('vsFavoriteAdd')"
              :title="isVersusFavorite(entry) ? $t('vsFavoriteRemove') : $t('vsFavoriteAdd')"
              :aria-pressed="isVersusFavorite(entry)"
              @click.stop="toggleVersusFavorite(entry)"
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                :fill="isVersusFavorite(entry) ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
              </svg>
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
    </div>


    <div>
      <div
        ref="rootEl"
        class="hoa-liquid-glass relative rounded-lg focus-within:[--hoa-ring:rgba(248,183,0,0.55)]"
        :class="[layout.cell, realmError ? '[--hoa-ring:rgba(239,68,68,0.75)]' : '', open ? 'z-30' : '']"
      >
        <input
          ref="realmInput"
          v-model="realmQuery"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="placeholders.realm"
          class="w-full rounded-lg bg-transparent text-white placeholder-gray-400 focus:outline-none"
          :class="[layout.input, layout.realm]"
          @focus="openRealm"
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
          class="absolute top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
          :class="layout.clear"
          @mousedown.prevent
          @click="clearRealm"
        >&#10005;</button>
        <span
          v-if="regionBadge"
          class="pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded border"
          :class="[layout.badge, resolvedRealm?.region === 'eu'
            ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
            : 'border-rose-400/40 bg-rose-400/10 text-rose-300']"
        >{{ regionBadge }}</span>

        <!-- The realms, in the pane every menu on the site is drawn in (`hoa-pop`): the same glass
             the hall of fame's realm menu and the history list above this field wear. -->
        <div
          v-if="open"
          class="hoa-pop absolute mt-1 w-full"
        >
          <div class="max-h-72 overflow-y-auto">
            <p v-if="realmsPending && !realms.length" class="px-4 py-3 text-sm text-gray-400">{{ $t('loading') }}</p>
            <p v-else-if="!matches.length" class="px-4 py-3 text-sm text-gray-400">{{ $t('noRealms') }}</p>
            <template v-else>
              <div v-for="section in sections" :key="section.key">
                <p class="hoa-pop-title">
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
      </div>
      <p v-if="realmError" class="mt-1 text-xs text-red-400">{{ $t('pickRealm') }}</p>
    </div>

    <button
      type="submit"
      class="bg-gradient-to-r from-amber-600 to-wow-gold text-black font-extrabold rounded-lg hover:brightness-110 transition-all shadow-lg uppercase tracking-wider disabled:cursor-wait disabled:brightness-95"
      :class="layout.submit"
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
</template>

