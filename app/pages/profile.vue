<script setup lang="ts">
/**
 * The account's own page: the main a player leads with, the characters beside it, and what they add
 * up to.
 *
 * It draws what `/api/profile` answers, which is SQLite alone - the page opens the moment a sign-in
 * lands and never waits on Blizzard. The figures a character is still missing are filled in behind
 * the reader's back: on mount the page starts `/api/profile/sync`, which reads a few characters and
 * writes their snapshots, and a character's own refresh button reads that one on the spot
 * (`server/api/profile/character/[id].get.ts`).
 *
 * The address is `/profile` in English and `/ru/profile` in Russian, exactly as the front page is
 * one route with two addresses.
 */
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { formatNumber } from '#shared/utils/formatNumber'
// The Mythic+ ladder the character page colours the rating by, so a figure keeps its colour here.
import { mPlusQualityTextClass } from '#shared/utils/wow-quality'
// The overall rating, off the same formula the hall of fame ranks by, so the profile's figure and the
// table's own column are one number.
import { calculatePlayerScore } from '#shared/utils/leaderboardScore'

definePageMeta({ alias: '/ru/profile' })

/** One reading of a character, as the endpoint hands it over. */
interface LatestStats {
  takenAt: number
  ilvl: number | null
  mplus: number | null
  achievements: number | null
  mounts: number | null
  pets: number | null
  toys: number | null
  decor: number | null
  reputations: number | null
}

/** One character of the account. */
interface ProfileCharacter {
  id: number
  region: string
  realmSlug: string
  realmName: string | null
  name: string
  displayName: string | null
  classId: number | null
  level: number | null
  faction: string | null
  /** Blizzard's square portrait, or `null` while the character has not been read in full. */
  avatar: string | null
  /** The primary professions the game names, up to two. */
  professions: string[]
  isMain: boolean
  lastSeenAt: number
  latest: LatestStats | null
}

interface ProfileResponse {
  user: { bnetSub: string; battletag: string | null; mainCharacterId: number | null; isPublic: boolean } | null
  characters: ProfileCharacter[]
}

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()

/** The locale Blizzard should localise a character read in, which is the page's own language. */
const apiLocale = computed(() => (locale.value === 'ru' ? 'ru_RU' : 'en_US'))

const { data, refresh } = await useFetch<ProfileResponse>('/api/profile')

const user = computed(() => data.value?.user || null)
const characters = computed(() => data.value?.characters || [])

/** The character the account leads with, or the first one while nobody has named a main yet. */
const main = computed(() => characters.value.find((entry) => entry.isMain) || characters.value[0] || null)

/**
 * The profile's own menu: how the roster is ordered, which of it is shown, and the account's
 * privacy. All of it lives in the browser and none of it is sent anywhere but the one write the
 * privacy switch makes - the reader's view of their own roster is theirs to arrange.
 */
const SORTS = ['main', 'ilvl', 'mplus', 'level', 'name'] as const
type SortKey = (typeof SORTS)[number]

/** The sides a roster can be narrowed to, `all` included. */
const FACTIONS = ['all', 'alliance', 'horde'] as const

const settingsOpen = ref(false)
const sort = ref<SortKey>('main')
const factionFilter = ref<'all' | 'alliance' | 'horde'>('all')
const classFilter = ref<number | 'all'>('all')
const realmFilter = ref<string>('all')
const nameQuery = ref('')

/** The classes actually present in the roster, which is all a filter may offer. */
const classOptions = computed(() => {
  const seen = new Map<number, string>()

  for (const character of characters.value) {
    if (typeof character.classId !== 'number' || character.classId <= 0 || seen.has(character.classId)) continue
    const entry = classById(character.classId)
    seen.set(character.classId, entry ? (locale.value === 'ru' ? entry.nameRu : entry.name) : String(character.classId))
  }

  return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
})

/** The realms present in the roster. */
const realmOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const character of characters.value) seen.set(character.realmSlug, character.realmName || character.realmSlug)

  return [...seen.entries()].map(([slug, label]) => ({ slug, label })).sort((a, b) => a.label.localeCompare(b.label))
})

/** The roster as the menu asked for it: filtered first, then ordered. */
const visibleCharacters = computed(() => {
  const query = nameQuery.value.trim().toLowerCase()

  const kept = characters.value.filter((character) => {
    if (factionFilter.value !== 'all' && (character.faction || '') !== factionFilter.value) return false
    if (classFilter.value !== 'all' && character.classId !== classFilter.value) return false
    if (realmFilter.value !== 'all' && character.realmSlug !== realmFilter.value) return false
    if (query && !(character.displayName || character.name).toLowerCase().includes(query)) return false
    return true
  })

  return kept.sort((a, b) => {
    switch (sort.value) {
      case 'ilvl':
        return (b.latest?.ilvl ?? -1) - (a.latest?.ilvl ?? -1)
      case 'mplus':
        return (b.latest?.mplus ?? -1) - (a.latest?.mplus ?? -1)
      case 'level':
        return (b.level ?? 0) - (a.level ?? 0)
      case 'name':
        return (a.displayName || a.name).localeCompare(b.displayName || b.name)
      default:
        // The account's own order: the main first, then the strongest, then the alphabet.
        return Number(b.isMain) - Number(a.isMain) || (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name)
    }
  })
})

/** Whether anything is narrowing the roster, which is what the menu's button marks. */
const filtersActive = computed(
  () =>
    factionFilter.value !== 'all' ||
    classFilter.value !== 'all' ||
    realmFilter.value !== 'all' ||
    Boolean(nameQuery.value.trim())
)

/** Puts every filter back to the whole roster. */
function resetFilters() {
  factionFilter.value = 'all'
  classFilter.value = 'all'
  realmFilter.value = 'all'
  nameQuery.value = ''
}

/**
 * The bar's dropdowns, one at a time.
 *
 * Each is the site's own menu pane (`.hoa-pop`) rather than a native `<select>`, which would paint
 * the operating system's list into a dark page - the same choice, and the same look, the hall of
 * fame's filter bar makes (`app/components/leaderboard/LeaderboardFilters.vue`).
 */
const openMenu = ref<'' | 'sort' | 'class' | 'realm'>('')

function toggleMenu(menu: 'sort' | 'class' | 'realm') {
  openMenu.value = openMenu.value === menu ? '' : menu
}

/** A click anywhere else - or Escape - shuts whatever is open. */
function closeMenus() {
  openMenu.value = ''
}

function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenus()
}

onMounted(() => {
  document.addEventListener('click', closeMenus)
  document.addEventListener('keydown', onMenuKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenus)
  document.removeEventListener('keydown', onMenuKeydown)
})

/** The label the sort button wears: the chosen key's own name. */
const sortLabel = computed(() => t(`sort${sort.value.charAt(0).toUpperCase()}${sort.value.slice(1)}`))

/** The label the class button wears: the chosen class, or "all". */
const chosenClassLabel = computed(
  () => classOptions.value.find((entry) => entry.id === classFilter.value)?.label || t('filterAll')
)

/** The label the realm button wears: the chosen realm, or "all". */
const chosenRealmLabel = computed(
  () => realmOptions.value.find((entry) => entry.slug === realmFilter.value)?.label || t('filterAll')
)

/** The privacy switch, kept in step with the server on every change. */
const isPublic = ref(false)
watch(user, (value) => {
  isPublic.value = value?.isPublic ?? true
}, { immediate: true })

const accountName = computed(() => (user.value?.battletag || '').split('#')[0] || 'Battle.net')

/** The colour a character's name is drawn in, which is what ties a row to its class. */
const hexOf = (character: ProfileCharacter) => classById(character.classId)?.hex || DEFAULT_CLASS_HEX

/** The address of a character's own page, which is where a row leads. */
const characterUrl = (character: ProfileCharacter) =>
  localeUrl(`/${regionPath(character.region)}/${character.realmSlug}/${character.name}`)

/** A figure as the endpoint left it, with a dash where nothing has been read yet. */
const figure = (value: number | null | undefined) => (typeof value === 'number' ? formatNumber(value) : '—')

/**
 * The account's overall rating, read off the main's figures - which are the account's own, because
 * every tile on this page is overlaid with the pool. It is the very number the hall of fame orders its
 * table by, taken from the shared formula rather than stored twice.
 */
const mainScore = computed(() =>
  calculatePlayerScore({
    achievements: main.value?.latest?.achievements ?? 0,
    mounts: main.value?.latest?.mounts ?? 0,
    toys: main.value?.latest?.toys ?? 0,
    decor: main.value?.latest?.decor ?? 0,
    pets: main.value?.latest?.pets ?? 0
  })
)

/**
 * The main's whole stat line as one list, so the template stays a `v-for`.
 *
 * Each entry is drawn the way a character page draws its own tiles
 * (`app/pages/[region]/[realm]/[name]/index.vue`): the same glyph, the same label size and the same
 * figure size, in the same order of importance. The figures are the account's, because every tile on
 * this page is overlaid with the pool, and the colours follow the page's own rule - a figure with a
 * ladder of its own wears its tier (the rating), the headline score wears the brand gold, and a single
 * number with nothing to be read against stays white.
 */
const mainStats = computed(() => {
  const latest = main.value?.latest

  return [
    { key: 'score', icon: 'trophy', label: t('lbColScore'), display: figure(mainScore.value), color: 'text-wow-goldLight' },
    { key: 'ilvl', icon: 'item-level', label: t('itemLevel'), display: figure(latest?.ilvl), color: 'text-white' },
    { key: 'mplus', icon: 'key', label: t('mPlus'), display: figure(latest?.mplus), color: mPlusQualityTextClass(latest?.mplus ?? 0) },
    { key: 'achievements', icon: 'achievments', label: t('achievements'), display: figure(latest?.achievements), color: 'text-white' },
    { key: 'mounts', icon: 'mounts', label: t('mounts'), display: figure(latest?.mounts), color: 'text-white' },
    { key: 'pets', icon: 'pets', label: t('pets'), display: figure(latest?.pets), color: 'text-white' },
    { key: 'toys', icon: 'toys', label: t('toys'), display: figure(latest?.toys), color: 'text-white' },
    { key: 'decor', icon: 'decor', label: t('decor'), display: figure(latest?.decor), color: 'text-white' },
    { key: 'reputations', icon: 'exalted-rep', label: t('reputations'), display: figure(latest?.reputations), color: 'text-white' }
  ]
})

const { formatRelative, formatAbsolute } = useRelativeTime()

/**
 * When a tile's reading was taken, in words: "3 days ago", "just now".
 *
 * A character that has never been read in full has no snapshot, and the day the roster met it is the
 * only moment there is - so the row's own `lastSeenAt` stands in rather than the tile saying nothing.
 */
const updatedAt = (character: ProfileCharacter) =>
  formatRelative((character.latest?.takenAt ?? character.lastSeenAt) * 1000)

/** The exact moment behind those words, for the tooltip they stand on. */
const updatedTitle = (character: ProfileCharacter) =>
  formatAbsolute((character.latest?.takenAt ?? character.lastSeenAt) * 1000)

/** A portrait that failed to load, which the monogram then stands in for. */
const brokenAvatars = ref<Record<number, boolean>>({})

/**
 * The artwork the page stands on: Blizzard's class art for the main, the same picture a character
 * page uses behind the same class (`server/utils/armory.ts`). It is built from the class slug rather
 * than stored per character, because the armory's asset only changes with a patch - and the slug in
 * the shared table is already the CDN's own spelling.
 */
const ARMORY_CDN = 'https://render.worldofwarcraft.com'

const mainBackground = computed(() => {
  const slug = classById(main.value?.classId)?.slug
  return slug ? `${ARMORY_CDN}/profile-backgrounds/v2/armory_bg_class_${slug}.jpg` : ''
})

/** The character whose own card is being drawn right now, if any. */
const cardBusy = ref<number | null>(null)

/**
 * Saves one character's own card - the picture the public character page hands out, drawn by
 * `/api/card` from that character's profile. The account's own card (the main's face with the
 * account's numbers) stays on the main tile's button beside it.
 */
async function downloadCharacterCard(character: ProfileCharacter) {
  if (cardBusy.value !== null) return
  cardBusy.value = character.id
  try {
    const blob = await $fetch<Blob>(
      `/api/card/${character.region}/${character.realmSlug}/${character.name}`,
      { query: { locale: apiLocale.value }, responseType: 'blob' }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `heroofazeroth-${character.displayName || character.name}.jpg`
    link.click()
    URL.revokeObjectURL(url)
  } finally {
    cardBusy.value = null
  }
}

/**
 * One character read and the tile it belongs to: the grid's own way of moving under the reader.
 *
 * `readCharacter` is the single read both controls use - the tile's own button and a pass of
 * `updateAll` - so a character refreshed by a pass is the same character refreshed by hand. What
 * the endpoint answers is laid into the tile at once, which is what makes a long pass visible
 * (each card fills in as it is reached) instead of one repaint at the end.
 */
async function readCharacter(character: ProfileCharacter) {
  const profile = await $fetch<any>(`/api/profile/character/${character.id}`, { query: { locale: apiLocale.value } })
  applyLatest(character.id, profile)
  return profile
}

/** A fresh reading laid into the tile, so the grid moves while a pass is running. */
function applyLatest(id: number, profile: any) {
  const entry = data.value?.characters?.find((candidate) => candidate.id === id)
  if (!entry || !profile?.stats) return

  entry.latest = {
    takenAt: Math.floor(Date.now() / 1000),
    ilvl: profile.ilvl ?? null,
    mplus: profile.mPlusScore ?? null,
    achievements: profile.ap ?? null,
    mounts: profile.stats.mounts?.count ?? null,
    pets: profile.stats.pets?.count ?? null,
    toys: profile.stats.toys?.count ?? null,
    decor: profile.stats.decor?.count ?? null,
    reputations: profile.stats.reputations?.count ?? null
  }
  entry.classId = profile.classId ?? entry.classId
  entry.level = profile.level ?? entry.level
  entry.displayName = profile.name || entry.displayName
  entry.realmName = profile.realm || entry.realmName
  entry.avatar = profile.avatarUrl || entry.avatar
  if (Array.isArray(profile.professions) && profile.professions.length) entry.professions = profile.professions
}

/**
 * How long a character's own read rests before another can be asked for.
 *
 * The public character page keeps the same rule for the same reason: Blizzard answers a person
 * slowly, and a second press while the first is still travelling is a second read of the same
 * account. The tile counts the seconds down where its own label stood.
 */
const CHARACTER_COOLDOWN = 30

/** The gap between two characters of an "update all" pass, which is what keeps a roster off the limit. */
const UPDATE_GAP_MS = 700

/** The character being read right now, whichever control asked for it. */
const reading = ref<number | null>(null)
/** Seconds left on each character's own cooldown, by character id. */
const cooldowns = ref<Record<number, number>>({})
const updatingAll = ref(false)
const progress = ref({ done: 0, total: 0 })

const cooldownOf = (id: number) => cooldowns.value[id] || 0
const isReading = (id: number) => reading.value === id

/** A character may be read while no pass is running, nobody else is being read and its cooldown is out. */
const canRefresh = (character: ProfileCharacter) =>
  !updatingAll.value && !isReading(character.id) && cooldownOf(character.id) === 0

function startCooldown(id: number) {
  cooldowns.value = { ...cooldowns.value, [id]: CHARACTER_COOLDOWN }

  const tick = window.setInterval(() => {
    const left = (cooldowns.value[id] || 0) - 1
    cooldowns.value = { ...cooldowns.value, [id]: Math.max(0, left) }
    if (left <= 0) window.clearInterval(tick)
  }, 1000)
}

/** The tile's own read: one character, then its cooldown. */
async function refreshCharacter(character: ProfileCharacter) {
  if (!canRefresh(character)) return
  reading.value = character.id
  try {
    await readCharacter(character)
    startCooldown(character.id)
  } finally {
    reading.value = null
  }
}

/**
 * Every character of the account, one after another with a gap between them.
 *
 * A roster is a hundred Blizzard reads, and a hundred at once is what a rate limit is for - so the
 * pass is strictly sequential, waits `UPDATE_GAP_MS` between characters, and reports where it is.
 * A character the API will not answer for is skipped rather than ending the pass, and the button
 * stands down for the whole run (a second press cannot start a second pass).
 */
async function updateAll() {
  if (updatingAll.value) return

  const list = characters.value.slice()
  if (!list.length) return

  updatingAll.value = true
  progress.value = { done: 0, total: list.length }

  try {
    for (const character of list) {
      reading.value = character.id
      try {
        await readCharacter(character)
        startCooldown(character.id)
      } catch {
        // One character left for the next pass; the roster's own read is not worth failing over.
      } finally {
        reading.value = null
      }

      progress.value = { done: progress.value.done + 1, total: list.length }
      if (progress.value.done < list.length) {
        await new Promise((resolve) => window.setTimeout(resolve, UPDATE_GAP_MS))
      }
    }
  } finally {
    updatingAll.value = false
    reading.value = null
  }
}

/** What the "update all" button says: where the pass is, or what it would start. */
const updateLabel = computed(() =>
  updatingAll.value ? t('updating', { done: progress.value.done, total: progress.value.total }) : t('updateAll')
)

/** The share of the pass that is done, for the bar under the header. */
const progressPercent = computed(() =>
  progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
)

const downloading = ref(false)

/**
 * Saves the account's card: the main's picture with the account's own numbers
 * (see `server/api/profile/card`), which is the card the public page hands out, drawn for the
 * account rather than for one of its characters.
 */
async function downloadCard() {
  if (downloading.value) return
  downloading.value = true
  try {
    const blob = await $fetch<Blob>('/api/profile/card', { query: { locale: apiLocale.value }, responseType: 'blob' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `heroofazeroth-${accountName.value}.jpg`
    link.click()
    URL.revokeObjectURL(url)
  } finally {
    downloading.value = false
  }
}

const saving = ref(false)

/** What a roster read reported, which is what explains a grid that came back empty. */
interface RosterResult {
  accounts: number
  characters: number
  stored: number
  responseKeys: string[]
  accountKeys: string[]
  characterKeys: string[]
}

const roster = ref<RosterResult | null>(null)
const refreshingRoster = ref(false)

/**
 * Re-reads the account's roster: the way back from a sign-in that could not see it.
 *
 * One Battle.net call, the same one the callback makes - so a roster that came back empty the first
 * time (a privacy setting, an API hiccup) appears without signing out and in again.
 */
async function refreshRoster() {
  if (refreshingRoster.value) return
  refreshingRoster.value = true
  try {
    roster.value = await $fetch<RosterResult>('/api/profile/refresh', {
      method: 'POST',
      query: { locale: apiLocale.value }
    })
    await refresh()
  } finally {
    refreshingRoster.value = false
  }
}

/** Names a character as the main: the one row of the account the public table shows. */
async function chooseMain(character: ProfileCharacter) {
  if (character.isMain || saving.value) return
  saving.value = true
  try {
    await $fetch('/api/profile/main', { method: 'POST', body: { characterId: character.id } })
    await refresh()
  } finally {
    saving.value = false
  }
}

/** Opens or closes the roster to other readers. */
async function setPrivacy(value: boolean) {
  const previous = isPublic.value
  isPublic.value = value
  try {
    await $fetch('/api/profile/privacy', { method: 'POST', body: { isPublic: value } })
  } catch {
    isPublic.value = previous
  }
}

usePageSeo({
  title: () => t('profileTitle'),
  description: () => t('profilePrivacyHint'),
  // An account page is nobody's search result: it carries a private roster and no public copy.
  noindex: true
})

// The background fill: a few characters get their figures on the server after this page is drawn.
// A roster that came back empty at sign-in is retried here at once - the summary is one cheap call,
// and it is the difference between an empty page and the account.
onMounted(() => {
  if (!user.value) return
  if (!characters.value.length) void refreshRoster()
  $fetch('/api/profile/sync', { method: 'POST', query: { locale: apiLocale.value } }).catch(() => {})
})
</script>

<template>
  <div class="relative min-h-screen">
    <!-- The page stands on the main's class artwork, exactly as a character page stands on that
         character's: the roster has a face, and it is the one leading it. -->
    <SiteBackdrop :image="mainBackground" treatment="armoury" />

    <SiteHeader :title="t('profileTitle')" :meta="user ? accountName : ''">
      <template #actions>
        <div class="flex items-center gap-3">
          <!-- The whole roster, in one pass: the same plate the public character page gives its own
               Refresh button, with the same spinner - and it stands down while the pass runs, so a
               second press cannot start a second one. -->
          <button
            v-if="user && characters.length"
            type="button"
            :disabled="updatingAll"
            class="flex shrink-0 items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-300 hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 sm:text-base"
            :title="t('updateAll')"
            :aria-label="t('updateAll')"
            @click="updateAll"
          >
            <AppIcon name="refresh" class="h-[1.2em] w-[1.2em]" :class="updatingAll ? 'animate-spin' : ''" />
            <span class="tabular-nums">{{ updateLabel }}</span>
          </button>

          <!-- The account's settings: the privacy switch, and nothing else - the roster's order and
               its filters live in the bar above the grid, where they act. The plate is the roster's
               own size, so the two controls in this corner read as one row. -->
          <button
            v-if="user"
            type="button"
            class="flex shrink-0 items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-300 hover:border-white/30 hover:bg-white/15 sm:px-5 sm:text-base"
            :title="t('profileSettings')"
            :aria-label="t('profileSettings')"
            :aria-expanded="settingsOpen"
            @click="settingsOpen = true"
          >
            <svg
              class="h-[1.2em] w-[1.2em]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span class="hidden sm:inline">{{ t('profileSettings') }}</span>
          </button>
        </div>
      </template>
    </SiteHeader>

    <div class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4">
      <!-- The pass the header's button started: a bar that says how far along it is. -->
      <div v-if="updatingAll" class="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full rounded-full bg-wow-goldLight transition-all duration-300"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>

      <!-- Nobody signed in: one plate that offers the only thing there is to do. -->
      <div v-if="!user" class="hoa-panel mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
        <p class="text-lg text-gray-200">{{ t('profileSignedOut') }}</p>
        <a href="/api/auth/login" class="hoa-tab hoa-liquid-glass mt-4 inline-flex px-5 py-2 text-sm font-semibold">
          {{ t('signInBattleNet') }}
        </a>
      </div>

      <template v-else>
        <!-- The main: the character the account leads with, drawn large. Its portrait wears the
             character's own class as a frame, its two controls sit at the right of the head, and its
             whole stat line runs along the bottom. -->
        <section v-if="main" class="hoa-panel rounded-2xl p-5">
          <div class="flex flex-wrap items-start gap-4">
            <span
              class="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border-2 text-2xl font-extrabold"
              :style="{ borderColor: `${hexOf(main)}cc`, backgroundColor: `${hexOf(main)}22`, color: hexOf(main) }"
            >
              <img
                v-if="main.avatar && !brokenAvatars[main.id]"
                :src="main.avatar"
                :alt="main.displayName || main.name"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 h-full w-full object-cover"
                @error="brokenAvatars = { ...brokenAvatars, [main.id]: true }"
              />
              <span v-else>{{ main.name.charAt(0).toUpperCase() }}</span>
            </span>

            <div class="min-w-0">
              <!-- The main is marked with the same pill the hall of fame marks its own rows with,
                   right after the name it belongs to. -->
              <div class="flex min-w-0 items-center gap-2.5">
                <NuxtLink
                  :to="characterUrl(main)"
                  class="truncate text-[1.95rem] font-extrabold leading-tight"
                  :style="{ color: hexOf(main) }"
                >{{ main.displayName || main.name }}</NuxtLink>

                <span
                  class="inline-flex shrink-0 items-center rounded bg-wow-gold px-2 py-1 text-xs font-bold uppercase leading-none text-black"
                >{{ t('profileMain') }}</span>
              </div>
              <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-400">
                <span>
                  {{ main.realmName || main.realmSlug }}<span v-if="main.level"> · {{ main.level }}</span>
                </span>
                <span
                  v-for="profession in main.professions"
                  :key="profession"
                  class="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[11px] text-gray-300"
                >{{ profession }}</span>
              </p>
            </div>

            <!-- The two controls the public character page carries in its bar, at the right of the
                 head: the main's own read of Blizzard, and the card that is drawn from it. Under them,
                 along the same right edge, stands when that reading was taken - the figure belongs with
                 the controls that change it rather than with the name and the realm beside it. -->
            <div class="ml-auto flex shrink-0 flex-col items-end gap-2">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  :disabled="!canRefresh(main)"
                  class="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-300 hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  :title="cooldownOf(main.id) > 0 ? `${cooldownOf(main.id)}s` : t('refreshProfile')"
                  :aria-label="t('refreshProfile')"
                  @click="refreshCharacter(main)"
                >
                  <AppIcon name="refresh" class="h-5 w-5" :class="isReading(main.id) ? 'animate-spin' : ''" />
                </button>

                <div class="flex items-stretch overflow-hidden rounded-xl border border-amber-500/60 bg-amber-950/30 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all duration-300 hover:border-amber-400/90 hover:bg-amber-900/40 hover:shadow-[0_0_28px_rgba(245,158,11,0.5)]">
                  <button
                    type="button"
                    :disabled="downloading"
                    class="flex items-center justify-center gap-2.5 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 sm:px-6"
                    @click="downloadCard"
                  >
                    <AppIcon name="download-button" class="h-[1.2em] w-[1.2em]" />
                    {{ downloading ? t('loading') : t('downloadCard') }}
                  </button>
                </div>
              </div>

              <p class="text-[12px] font-medium text-gray-400" :title="updatedTitle(main)">
                {{ t('profileUpdated') }}: {{ updatedAt(main) }}
              </p>
            </div>
          </div>

          <!-- The stat line: the part of the page a collector comes for, so it is set apart from the
               head by a hairline in the character's own colour. It is drawn exactly as a character
               page draws its tiles - the glyph, the label at `text-[22px]`, the figure at
               `text-2xl sm:text-3xl` - laid inline three to a row. -->
          <div class="relative mt-7">
            <div
              class="absolute -top-4 left-0 right-0 h-px"
              :style="{ backgroundImage: `linear-gradient(90deg, transparent, ${hexOf(main)}99, transparent)` }"
              aria-hidden="true"
            />

            <!-- Each figure is its own plate: a hairline border and the faintest wash, so the nine
                 read as a grid of cells rather than one long line of numbers - the pattern a stats
                 panel is laid out with in Tailwind (`grid` + a bordered cell + `justify-between`).
                 The label stays close to the size a character page sets it at; only the wide tracking
                 is dropped, which is what keeps a long word inside its third of the row. -->
            <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <div
                v-for="stat in mainStats"
                :key="stat.key"
                class="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-base transition-colors hover:border-white/10 hover:bg-white/[0.05] sm:text-lg"
              >
                <AppIcon :name="stat.icon" class="h-[1.5em] w-[1.5em] shrink-0 opacity-80" />
                <span class="truncate text-[17px] font-bold uppercase tracking-wide text-gray-300 sm:text-[18px]">{{ stat.label }}</span>
                <span
                  class="ml-auto whitespace-nowrap text-2xl font-extrabold leading-none tabular-nums sm:text-3xl"
                  :class="stat.color"
                >{{ stat.display }}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- The roster: everybody the filters kept, the main among them, so the grid carries the
             whole account - which is why the main's own tile wears the star already filled. -->
        <section class="mt-3">
          <div class="flex flex-wrap items-baseline gap-3">
            <h2 class="text-lg font-bold text-white">{{ t('profileAlts') }}</h2>
            <p class="text-xs text-gray-500">{{ t('profileMainHint') }}</p>
          </div>

          <!-- The order and the filters, above the grid they act on - the same bar the hall of fame
               puts over its table: the site's own menu panes for the choices, chips for the sides,
               and a search field that narrows whatever is left (`LeaderboardFilters.vue`). -->
          <div v-if="characters.length" class="hoa-panel hoa-panel-layered relative z-20 mt-3 space-y-3 p-3 sm:p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="relative">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                  :class="sort !== 'main'
                    ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
                    : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
                  aria-haspopup="true"
                  :aria-expanded="openMenu === 'sort'"
                  @click.stop="toggleMenu('sort')"
                >
                  <span>{{ t('profileSort') }}: {{ sortLabel }}</span>
                  <svg
                    class="h-4 w-4 shrink-0 transition-transform duration-200"
                    :class="openMenu === 'sort' ? 'rotate-180' : ''"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
                  </svg>
                </button>

                <div
                  class="hoa-pop absolute left-0 top-full mt-2 w-56 transition-opacity duration-150"
                  :class="openMenu === 'sort' ? 'opacity-100' : 'invisible opacity-0'"
                  role="menu"
                >
                  <p class="hoa-pop-title">{{ t('profileSort') }}</p>
                  <button
                    v-for="key in SORTS"
                    :key="key"
                    type="button"
                    role="menuitem"
                    class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
                    :class="sort === key ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
                    @click="sort = key; closeMenus()"
                  >{{ t(`sort${key.charAt(0).toUpperCase()}${key.slice(1)}`) }}</button>
                </div>
              </div>

              <label class="relative block w-full lg:w-72">
                <span class="sr-only">{{ t('lbSearch') }}</span>
                <svg
                  class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  v-model="nameQuery"
                  type="search"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="t('lbSearchPlaceholder')"
                  class="w-full rounded-xl border border-white/10 bg-black/40 py-2 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-wow-gold/60 focus:outline-none"
                />
              </label>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                v-for="option in FACTIONS"
                :key="option"
                type="button"
                :aria-pressed="factionFilter === option"
                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                :class="factionFilter === option
                  ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
                  : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
                @click="factionFilter = option"
              >{{ option === 'all' ? t('filterAll') : t(`faction${option.charAt(0).toUpperCase()}${option.slice(1)}`) }}</button>

              <div v-if="classOptions.length" class="relative">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                  :class="classFilter !== 'all'
                    ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
                    : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
                  aria-haspopup="true"
                  :aria-expanded="openMenu === 'class'"
                  @click.stop="toggleMenu('class')"
                >
                  <span>{{ chosenClassLabel }}</span>
                  <svg
                    class="h-4 w-4 shrink-0 transition-transform duration-200"
                    :class="openMenu === 'class' ? 'rotate-180' : ''"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
                  </svg>
                </button>

                <div
                  class="hoa-pop absolute left-0 top-full mt-2 w-56 transition-opacity duration-150"
                  :class="openMenu === 'class' ? 'opacity-100' : 'invisible opacity-0'"
                  role="menu"
                >
                  <p class="hoa-pop-title">{{ t('classLabel') }}</p>
                  <div class="max-h-72 overflow-y-auto">
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
                      :class="classFilter === 'all' ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
                      @click="classFilter = 'all'; closeMenus()"
                    >{{ t('filterAll') }}</button>
                    <button
                      v-for="entry in classOptions"
                      :key="entry.id"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
                      :class="classFilter === entry.id ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
                      @click="classFilter = entry.id; closeMenus()"
                    >{{ entry.label }}</button>
                  </div>
                </div>
              </div>

              <div v-if="realmOptions.length > 1" class="relative">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                  :class="realmFilter !== 'all'
                    ? 'border-wow-gold/60 bg-wow-gold/10 text-wow-goldLight'
                    : 'border-white/10 bg-white/[0.04] text-gray-300 hover:border-white/25 hover:text-white'"
                  aria-haspopup="true"
                  :aria-expanded="openMenu === 'realm'"
                  @click.stop="toggleMenu('realm')"
                >
                  <span>{{ chosenRealmLabel }}</span>
                  <svg
                    class="h-4 w-4 shrink-0 transition-transform duration-200"
                    :class="openMenu === 'realm' ? 'rotate-180' : ''"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
                  </svg>
                </button>

                <div
                  class="hoa-pop absolute left-0 top-full mt-2 w-64 transition-opacity duration-150"
                  :class="openMenu === 'realm' ? 'opacity-100' : 'invisible opacity-0'"
                  role="menu"
                >
                  <p class="hoa-pop-title">{{ t('realm') }}</p>
                  <div class="max-h-72 overflow-y-auto">
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
                      :class="realmFilter === 'all' ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
                      @click="realmFilter = 'all'; closeMenus()"
                    >{{ t('filterAll') }}</button>
                    <button
                      v-for="entry in realmOptions"
                      :key="entry.slug"
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center px-4 py-2 text-left text-sm font-normal transition-colors"
                      :class="realmFilter === entry.slug ? 'bg-wow-gold/10 text-wow-goldLight' : 'text-gray-200 hover:bg-white/10 hover:text-white'"
                      @click="realmFilter = entry.slug; closeMenus()"
                    >{{ entry.label }}</button>
                  </div>
                </div>
              </div>

              <button
                v-if="filtersActive"
                type="button"
                class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:border-white/25 hover:text-white"
                @click="resetFilters"
              >{{ t('lbReset') }}</button>
            </div>
          </div>

          <div v-if="!characters.length" class="hoa-panel mt-2 rounded-2xl p-5">
            <p class="text-sm text-gray-400">{{ t('profileNoCharacters') }}</p>
            <button
              type="button"
              class="hoa-tab hoa-liquid-glass mt-3 px-4 py-1.5 text-xs disabled:opacity-40"
              :disabled="refreshingRoster"
              @click="refreshRoster"
            >{{ refreshingRoster ? t('loading') : t('profileRefreshRoster') }}</button>

            <!-- What the last read actually carried, so an empty grid is never a mystery: the
                 counts Blizzard answered with and the keys of its shape. -->
            <p v-if="roster" class="mt-2 text-[11px] text-gray-500">
              accounts {{ roster.accounts }} · characters {{ roster.characters }} · stored {{ roster.stored }}
              <span v-if="roster.responseKeys.length"> · keys: {{ roster.responseKeys.join(', ') }}</span>
              <span v-if="roster.accountKeys.length"> · account: {{ roster.accountKeys.join(', ') }}</span>
              <span v-if="roster.characterKeys.length"> · entry: {{ roster.characterKeys.join(', ') }}</span>
            </p>
          </div>

          <p v-else-if="!visibleCharacters.length" class="hoa-panel mt-2 rounded-2xl p-5 text-sm text-gray-400">
            {{ t('profileNoMatches') }}
          </p>

          <div v-else class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="character in visibleCharacters"
              :key="character.id"
              class="hoa-panel flex items-center gap-3 rounded-2xl p-3"
            >
              <!-- The portrait Blizzard serves, framed in the character's own class; a character that
                   has not been read in full yet falls back to a monogram in that colour. -->
              <span
                class="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border-2 text-lg font-extrabold"
                :style="{ borderColor: `${hexOf(character)}cc`, backgroundColor: `${hexOf(character)}22`, color: hexOf(character) }"
              >
                <img
                  v-if="character.avatar && !brokenAvatars[character.id]"
                  :src="character.avatar"
                  :alt="character.displayName || character.name"
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 h-full w-full object-cover"
                  @error="brokenAvatars = { ...brokenAvatars, [character.id]: true }"
                />
                <span v-else>{{ character.name.charAt(0).toUpperCase() }}</span>
              </span>

              <div class="min-w-0">
                <NuxtLink
                  :to="characterUrl(character)"
                  class="block truncate text-[1.3rem] font-bold leading-snug"
                  :style="{ color: hexOf(character) }"
                >{{ character.displayName || character.name }}</NuxtLink>
                <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
                  <span>
                    {{ character.realmName || character.realmSlug }}<span v-if="character.level"> · {{ character.level }}</span>
                  </span>
                  <span
                    v-for="profession in character.professions"
                    :key="profession"
                    class="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-gray-300"
                  >{{ profession }}</span>
                </p>
                <p class="truncate text-[11px] text-gray-400">
                  <template v-if="character.latest">
                    ilvl <span class="font-semibold text-white">{{ figure(character.latest.ilvl) }}</span>
                    · M+ <span class="font-semibold text-white">{{ figure(character.latest.mplus) }}</span>
                  </template>
                  <template v-else>{{ t('profileStatsPending') }}</template>
                </p>
                <p class="truncate text-[13px] font-medium text-gray-400" :title="updatedTitle(character)">
                  {{ t('profileUpdated') }}: {{ updatedAt(character) }}
                </p>
              </div>

              <!-- The tile's own read, the card drawn from it, and the star that marks the account's
                   main. None of them wears a word: the marks are the ones the public page uses, at a
                   tile's size. On the main's own tile the star is filled and golden and there is no
                   way to press it - it already stands where the button would send it - while every
                   other tile carries the same star left hollow, and pressing that is the promotion. -->
              <div class="ml-auto flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  :disabled="!canRefresh(character)"
                  class="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/10 text-white transition-colors hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  :title="cooldownOf(character.id) > 0 ? `${cooldownOf(character.id)}s` : t('refreshProfile')"
                  :aria-label="t('refreshProfile')"
                  @click="refreshCharacter(character)"
                >
                  <AppIcon name="refresh" class="h-4 w-4" :class="isReading(character.id) ? 'animate-spin' : ''" />
                </button>

                <button
                  type="button"
                  :disabled="cardBusy !== null"
                  class="grid h-9 w-9 place-items-center rounded-xl border border-amber-500/60 bg-amber-950/30 text-white transition-colors hover:border-amber-400/90 hover:bg-amber-900/40 disabled:cursor-wait disabled:opacity-40"
                  :title="t('downloadCard')"
                  :aria-label="t('downloadCard')"
                  @click="downloadCharacterCard(character)"
                >
                  <AppIcon name="download-button" class="h-4 w-4" :class="cardBusy === character.id ? 'animate-pulse' : ''" />
                </button>

                <span
                  v-if="character.isMain"
                  class="grid h-9 w-9 place-items-center rounded-xl border border-wow-gold/60 bg-wow-gold/15 text-wow-goldLight"
                  role="img"
                  :title="t('profileMainBadge')"
                  :aria-label="t('profileMainBadge')"
                >
                  <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                  </svg>
                </span>

                <button
                  v-else
                  type="button"
                  :disabled="saving"
                  class="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/10 text-wow-goldLight transition-colors hover:border-wow-gold/40 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                  :title="t('profileSetMain')"
                  :aria-label="t('profileSetMain')"
                  @click="chooseMain(character)"
                >
                  <svg
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </section>

      </template>
    </div>

    <!-- The account's settings, sliding in from the right: the privacy switch, which is the one
         setting here that leaves the browser. The roster's order and its filters are not here - they
         live in the bar above the grid, where a reader can watch them act. -->
    <div v-if="settingsOpen" class="fixed inset-0 z-[60]" role="dialog" aria-modal="true" :aria-label="t('profileSettings')">
      <div class="absolute inset-0 bg-black/60" @click="settingsOpen = false" />

      <aside
        class="hoa-panel hoa-panel-layered absolute right-0 top-0 h-full w-[min(92vw,23rem)] overflow-y-auto rounded-none border-r-0 p-5"
      >
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-bold text-white">{{ t('profileSettings') }}</h2>
          <button
            type="button"
            class="hoa-tab hoa-liquid-glass ml-auto px-3 py-1.5 text-xs"
            @click="settingsOpen = false"
          >{{ t('close') }}</button>
        </div>

        <!-- The account's privacy: the one setting here that leaves the browser. -->
        <section class="mt-5">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{{ t('profilePrivacy') }}</p>
          <p class="mt-1 text-xs text-gray-400">{{ t('profilePrivacyHint') }}</p>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs"
              :class="{ 'hoa-tab-active': isPublic }"
              @click="setPrivacy(true)"
            >{{ t('profilePublic') }}</button>
            <button
              type="button"
              class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs"
              :class="{ 'hoa-tab-active': !isPublic }"
              @click="setPrivacy(false)"
            >{{ t('profilePrivate') }}</button>
          </div>
        </section>
      </aside>
    </div>

    <footer class="relative z-20 container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>

    <BackToTop />
    <SupportButton />
  </div>
</template>
