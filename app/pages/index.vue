<script setup lang="ts">
interface RealmOption {
  slug: string
  name: string
  region: 'eu' | 'us'
}

const { locale, setLocale, t } = useI18n()
const router = useRouter()

// The language travels in the URL as ?lang=..., so switching it only rewrites the
// query of the current page instead of navigating to a /<lang> prefixed route.
const changeLocale = async (code: 'en' | 'ru') => {
  if (code === locale.value) return
  await setLocale(code)
  await router.replace({ query: langQuery(code) })
}

const realmQuery = ref('')
const selectedRealm = ref<RealmOption | null>(null)
const name = ref('')
const open = ref(false)
const realmError = ref(false)
const activeIndex = ref(-1)
const rootEl = ref<HTMLElement | null>(null)
const realmInput = ref<HTMLInputElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

const realmsUrl = computed(() => `/api/realms?locale=${locale.value === 'ru' ? 'ru_RU' : 'en_US'}`)
const { data: realms, pending: realmsPending } = await useFetch<RealmOption[]>(realmsUrl, {
  key: 'realm-list',
  default: () => []
})

/** Realms matching what has been typed so far (both regions). */
const matches = computed<RealmOption[]>(() => {
  const list = realms.value || []
  const query = realmQuery.value.trim().toLowerCase()
  if (!query) return list
  return list.filter((realm) => realm.name.toLowerCase().includes(query) || realm.slug.includes(query))
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

const highlight = (text: string) => {
  const query = realmQuery.value.trim().toLowerCase()
  const at = query ? text.toLowerCase().indexOf(query) : -1
  if (at < 0) return [{ text, hit: false }]
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + query.length), hit: true },
    { text: text.slice(at + query.length), hit: false }
  ].filter((part) => part.text)
}

const selectRealm = (realm: RealmOption) => {
  selectedRealm.value = realm
  realmQuery.value = realm.name
  realmError.value = false
  open.value = false
  activeIndex.value = -1
  nameInput.value?.focus()
}

const onRealmInput = () => {
  selectedRealm.value = null
  realmError.value = false
  open.value = true
  activeIndex.value = -1
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

const handleSearch = () => {
  const realm = resolvedRealm.value || (matches.value.length === 1 ? matches.value[0]! : null)
  if (!realm) {
    // Without a realm we cannot tell whether the character is on EU or US.
    realmError.value = true
    open.value = true
    realmInput.value?.focus()
    return
  }
  if (!name.value.trim()) return

  router.push({
    path: `/${realm.region}/${realm.slug}/${name.value.trim()}`,
    query: langQuery(locale.value)
  })
}

const onDocumentClick = (event: MouseEvent) => {
  if (!rootEl.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocumentClick))
</script>


<template>
  <div class="relative min-h-screen bg-wow-dark flex items-center justify-center p-4">
    <!-- The community artwork (`app/assets/img/bg-01.jpg`) covers the whole page.
         It is a bright sunset scene, so a flat scrim plus a vignette dim it just
         enough for the glass box and the gold accents to stay readable. -->
    <img
      src="~/assets/img/bg-01.jpg"
      alt=""
      aria-hidden="true"
      class="fixed inset-0 h-full w-full object-cover"
    />
    <div class="fixed inset-0 bg-wow-dark/45"></div>
    <div class="fixed inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(8,10,15,0.65)_100%)]"></div>

    <!-- The form is the same liquid glass as the boxes on the character page. -->
    <div class="relative z-10 max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <!-- The wordmark carries the brand, so the heading is the artwork: it is
               sized to the cap height the text had before (text-3xl). -->
          <h1>
            <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-16 w-auto" />
          </h1>
          <p class="text-xs text-gray-400 mt-2">{{ $t('tagline') }}</p>
        </div>

        <div class="flex gap-1.5 shrink-0">
          <button
            type="button"
            title="English"
            @click="changeLocale('en')"
            class="px-2 py-1.5 rounded-lg border text-base leading-none transition-all"
            :class="locale === 'en' ? 'border-wow-gold bg-wow-gold/10' : 'border-white/10 bg-black/40 opacity-60 hover:opacity-100'"
          >🇬🇧</button>
          <button
            type="button"
            title="Русский"
            @click="changeLocale('ru')"
            class="px-2 py-1.5 rounded-lg border text-base leading-none transition-all"
            :class="locale === 'ru' ? 'border-wow-gold bg-wow-gold/10' : 'border-white/10 bg-black/40 opacity-60 hover:opacity-100'"
          >🇷🇺</button>
        </div>
      </div>

      <form @submit.prevent="handleSearch" class="space-y-4">
        <div>
          <div ref="rootEl" class="relative">
            <input
              ref="realmInput"
              v-model="realmQuery"
              type="text"
              autocomplete="off"
              spellcheck="false"
              :placeholder="$t('realmPlaceholder')"
              class="w-full bg-black/60 border rounded-lg px-4 py-2.5 pr-14 text-white placeholder-gray-500 focus:outline-none focus:border-wow-gold transition-colors"
              :class="realmError ? 'border-red-500/70' : 'border-white/10'"
              @focus="open = true"
              @input="onRealmInput"
              @keydown.down.prevent="move(1)"
              @keydown.up.prevent="move(-1)"
              @keydown.enter.prevent="onEnter"
              @keydown.esc="open = false"
            />
            <span
              v-if="regionBadge"
              class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded border"
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
                    <span class="text-gray-500 text-xs"> · {{ r.slug }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
          <p v-if="realmError" class="mt-1 text-xs text-red-400">{{ $t('pickRealm') }}</p>
        </div>

        <div>
          <input
            ref="nameInput"
            v-model="name"
            type="text"
            :placeholder="$t('characterNamePlaceholder')"
            required
            class="w-full bg-black/60 border border-white/10 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-wow-gold transition-colors"
          />
        </div>

        <button 
          type="submit" 
          class="w-full mt-2 bg-gradient-to-r from-amber-600 to-wow-gold text-black font-extrabold py-3 rounded-lg hover:brightness-110 transition-all shadow-lg uppercase text-sm tracking-wider"
        >
          {{ $t('find') }}
        </button>
      </form>
    </div>
  </div>
</template>
