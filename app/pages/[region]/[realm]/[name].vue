<script setup lang="ts">
// The class colour a name is printed in comes from the shared table the card draws from, so the
// page and its card agree (see `#shared/utils/wow-class`). A class shows up in the header, and the
// header is the shell's - the views below it never print one.
import { resolveClass } from '#shared/utils/wow-class'
// The profile the whole subtree is a view of. The shell fetches it once and hands it to whichever
// view the address names, so a switch between the views is a swap rather than a second read of
// Blizzard - and the endpoint keeps it for two hours in any case (see `server/api/character`).
import type { CharacterData } from '~~/server/utils/blizzard'
// The feed's shape, shared with the endpoint that builds it (see `#shared/utils/activity`).
import type { ActivityFeed } from '#shared/utils/activity'
// The search history the front page offers: a character that rendered here is a search that
// worked, and that is what is worth keeping (see the composable for the shape and the limit).
import { useSearchHistory } from '~/composables/searchHistory'
// What the shell hands to the views it renders (see the composable for the shape).
import { provideCharacterView } from '~/composables/characterView'
// The Russian copy of this subtree is the same component under `/ru`; the middleware reads the
// language off whichever of the two addresses was asked for. The alias names the whole subtree, so
// `/ru/.../activity` is served as readily as its English address.
definePageMeta({ alias: '/ru/:region/:realm/:name' })

const route = useRoute()
const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()
// The region is the second path segment (`/region-eu/gordunni/neromask`, or
// `/ru/region-eu/gordunni/neromask` in Russian).
const region = regionFromPath(String(route.params.region || ''))
const realm = String(route.params.realm || '')
const name = String(route.params.name || '')

if (!region) {
  throw createError({ statusCode: 404, statusMessage: 'Unknown region' })
}

const apiLocale = computed(() => (locale.value === 'ru' ? 'ru_RU' : 'en_US'))

/**
 * The three views of the character, as addresses: the profile the page opens on, the feed of what
 * the character has done lately, and the collections it has gathered. A tab is a link rather than a
 * button, so the browser keeps every view in its history, a shared link can point at one, and a
 * crawler reaches each on its own.
 */
const overviewPath = computed(() => `/${regionPath(region)}/${realm}/${name}`)
const activityPath = computed(() => `${overviewPath.value}/activity`)
/** The collections subtree, which opens on the mounts shelf (see the `collections/` folder). */
const collectionsPath = computed(() => `${overviewPath.value}/collections`)
/** The view the address names, which is what the tabs are lit by. */
const onActivityTab = computed(() => /\/activity\/?$/.test(route.path))
const onCollectionsTab = computed(() => /\/collections(?:\/|$)/.test(route.path))
/** Whether `kind` is the shelf being read, which is the entry the collections menu lights. */
const onShelf = (kind: string) => new RegExp(`/collections/${kind}/?$`).test(route.path)

const { data: character, pending, error } = await useFetch<CharacterData>(
  () => `/api/character/${region}/${realm}/${name}?locale=${apiLocale.value}`
)

// The read of a profile is a wait of the site's, so it is registered rather than drawn: the shell is
// read again whenever the address names another character, and a shell that is *reused* for that
// keeps this flag - the navigation that brought the reader here is long over by then, which is
// exactly the case a wheel bound to the navigation alone would miss (see `usePageLoading`).
usePageLoading().follow('character:profile', pending)

/**
 * A page that rendered a character is the proof a search was successful, and that is the moment
 * worth keeping: the name, the realm and the region go into the search history the front page
 * offers under its name field. A miss leaves `character` empty and remembers nothing, so a
 * mistyped name never reaches the list, and a shared link that lands on a real character counts
 * as the success it is.
 */
const { remember: rememberCharacter } = useSearchHistory()

watch(character, (loaded) => {
  // `localStorage` exists in the browser alone, and the server has no history to write to.
  if (!import.meta.client || !loaded) return
  rememberCharacter({
    name: loaded.name,
    realm,
    region,
    realmName: loaded.realm,
    // The class rides along so the front page can tint the remembered name with it; the id is the
    // same in either language, which is what the row is coloured by.
    classId: loaded.classId,
    class: resolveClass(loaded)?.slug,
    // And the portrait, so the chip in a header can show who this browser is signed in as without
    // asking Blizzard for the character a second time (`app/components/MyProfile.vue`).
    avatar: loaded.avatarUrl
  })
}, { immediate: true })

const descriptor = computed(() => {
  const c = character.value
  if (!c) return ''
  return `${t('itemLevel')}: ${c.ilvl} · ${t('mPlus')}: ${c.mPlusScore} · ${t('achievements')}: ${c.ap} · ${c.realm}`
})

/**
 * A shared link previews as "Name - Class": the class reads instantly and is the
 * same in both languages, unlike the earned title, which the Armoury returns in
 * the requested language and can be long or obscure.
 */
const headline = computed(() => {
  const c = character.value
  if (!c) return name
  return c.class ? `${c.name} - ${c.class}` : c.name
})

/** The region as the title spells it: the bare code, uppercased. */
const regionCode = computed(() => region.toUpperCase())

/** How the character is named inside a sentence: its class and its realm, in the page's language. */
const seoName = computed(() => {
  const c = character.value
  if (!c) return ''
  return [c.realm].filter(Boolean).join(', ')
})

/** The class and the realm as a link preview names them: `Рыцарь смерти (Tarren Mill)`. */
const seoOgWho = computed(() => {
  const c = character.value
  if (!c) return ''
  return c.class && c.realm ? `${c.class} (${c.realm})` : c.class || c.realm
})

/**
 * The character's own sentence, in the two forms the page is described with.
 *
 * A search result wants the plain facts spelled out - the name, the class, the realm, then the
 * collections a player reads first - while a link preview is read in a chat window, where the
 * same figures stand out as a row behind a glyph. Both are built from one set of numbers and the
 * same labels, so they can never disagree about a character.
 *
 * The title names the view as well, so the profile and the feed are two documents a crawler can
 * tell apart rather than one title on two addresses.
 */
const seoTitle = computed(() => {
  const c = character.value
  const base = !c
    ? name
    : (seoName.value ? `${c.name} - ${seoName.value} (${regionCode.value})` : `${c.name} (${regionCode.value})`)
  if (onActivityTab.value) return `${base} - ${t('tabActivity')}`
  if (onCollectionsTab.value) return `${base} - ${t('tabCollections')}`
  return base
})

const seoDescription = computed(() => {
  const c = character.value
  if (!c) return ''
  const facts = [
    seoName.value ? `${c.name} (${seoName.value})` : c.name,
    `${t('achievements')}: ${c.ap}`,
    `${t('mounts')}: ${c.stats.mounts.count}`,
    `${t('seoPets')}: ${c.stats.pets.count}`,
    `${t('toys')}: ${c.stats.toys.count}`,
    `${t('seoItemLevel')}: ${c.ilvl}`,
    t('seoCharacterSuffix')
  ]
  return [onActivityTab.value ? t('recentAchievements') : '', ...facts].filter(Boolean).join(' · ')
})

const seoOgDescription = computed(() => {
  const c = character.value
  if (!c) return ''
  return [
    `${seoOgWho.value || c.name}`,
    `🏆 ${c.ap}`,
    `ilvl ${c.ilvl}`,
    `M+ ${c.mPlusScore}`,
    `${t('mounts')} ${c.stats.mounts.count}`,
    `${t('seoPets')} ${c.stats.pets.count}`,
    `${t('toys')} ${c.stats.toys.count}`,
    t('seoCharacterSuffix')
  ].join(' · ')
})

const requestURL = useRequestURL()
const shareUrl = computed(() => new URL(route.fullPath, requestURL.origin).href)

/**
 * A network caches a preview image by its URL, so the card carries the build id:
 * every deployment changes the URL and the crawlers read the artwork again
 * instead of showing whatever they stored for the previous build.
 */
const { app: appConfig, public: publicConfig } = useRuntimeConfig()
const cardUrl = computed(() => {
  const build = String(appConfig?.buildId || '')
  return `/api/card/${region}/${realm}/${name}?locale=${apiLocale.value}${build ? `&v=${build}` : ''}`
})

/** The card as a crawler has to reach it: absolute, on the public host. */
const ogImage = computed(() => new URL(cardUrl.value, publicConfig.siteUrl).href)

/**
 * Nothing to index: the Armoury does not know this name, or the call behind the page
 * failed. `pending` is only true while a navigation is still in flight, where the
 * answer is not known yet.
 */
const missing = computed(() => !pending.value && (Boolean(error.value) || !character.value))

// A character that does not exist has to answer 404 rather than 200, otherwise a
// crawler keeps a URL whose only content is a "not found" note.
if (error.value) {
  const event = useRequestEvent()
  if (event) setResponseStatus(event, 404)
}

/**
 * The character page is a profile: the card is its preview image, the class and the
 * statistics describe the character to a search engine, and a page with nothing to
 * show turns itself into a `noindex` response. The shared half of the head – the
 * canonical URL, the hreflang links, the brand – lives in `usePageSeo`.
 */
usePageSeo({
  title: () => seoTitle.value,
  // The title already ends in the brand, so it is written whole rather than templated again.
  titleTemplate: (title) => `${title} - Hero of Azeroth`,
  description: () => seoDescription.value,
  // A chat window shows the figures; a search result shows the plain facts.
  ogDescription: () => seoOgDescription.value,
  image: () => ogImage.value,
  // The card is served as a JPEG (it carries the artwork's photographs), so the head has to
  // say so: the tag describes the file the crawler is about to fetch.
  imageType: 'image/jpeg',
  ogType: 'profile',
  noindex: () => missing.value,
  jsonLd: (canonical) => {
    const c = character.value
    if (!c) return null

    return {
      '@context': 'https://schema.org',
      '@type': 'ProfilePage',
      url: canonical,
      name: headline.value,
      description: descriptor.value,
      inLanguage: locale.value,
      // The page is about one character, and a `Person` is the closest thing
      // schema.org has for one of the game's avatars.
      mainEntity: {
        '@type': 'Person',
        name: c.name,
        url: canonical,
        image: ogImage.value,
        description: `${c.race} ${c.class} · ${t('itemLevel')} ${c.ilvl} · ${c.realm}`
      }
    }
  }
})

/**
 * The level/race/spec/class/guild/realm line under the name, split into parts so
 * the template can put the `·` between them the way the card prints them.
 */
interface MetaPart {
  text: string
  /** The plate the part wears: the amber of the meta line, or the class plate. */
  className?: string
  /** The spec-and-class part, which prints in the class's own colour (see `<CharacterName>`). */
  isClass?: boolean
}

const metaParts = computed<MetaPart[]>(() => {
  const c = character.value
  if (!c) return []

  // Общий стиль для янтарных баблов. Блюра своего у них нет: они надеты на стекло самой шапки
  // (`app/assets/css/main.css` объясняет, почему внутри панели его быть не должно).
  const amberBadge = 'inline-flex items-center px-2.5 py-0.5 rounded-lg border border-amber-500/50 bg-amber-950/20 text-xs font-semibold text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)]'

  return [
    // 1. Уровень
    {
      text: String(c.level),
      className: amberBadge
    },
    // 2. Раса
    {
      text: c.race,
      className: amberBadge
    },
    // 3. Spec and class, printed in its signature colour (see <CharacterName>).
    {
      text: `${c.spec} ${c.class}`.trim(),
      // Colour and plate come from <CharacterName>, shared with the rest of the app.
      isClass: true
    },
    // 4. Гильдия (отдельный бабл)
    {
      text: c.guild ? `<${c.guild}>` : '',
      className: amberBadge
    },
    // 5. Реалм (отдельный бабл)
    {
      text: c.realm,
      className: amberBadge
    }
  ].filter((part) => part.text)
})

const shareTitle = computed(() => (character.value?.title ? `${character.value.name} ${character.value.title}` : (character.value?.name || name)))
const shareText = computed(() => `${shareTitle.value} — ${descriptor.value}`)

/** Networks that turn the shared link into a preview of the card image. */
const socials = computed(() => {
  const url = encodeURIComponent(shareUrl.value)
  const text = encodeURIComponent(shareText.value)
  const image = encodeURIComponent(ogImage.value)

  return [
    { key: 'x', badge: 'X', label: 'X', tint: 'border-sky-400/30 bg-sky-400/10 text-sky-300', href: `https://twitter.com/intent/tweet?url=${url}&text=${text}` },
    { key: 'telegram', badge: 'TG', label: 'Telegram', tint: 'border-sky-400/30 bg-sky-400/10 text-sky-300', href: `https://t.me/share/url?url=${url}&text=${text}` },
    { key: 'vk', badge: 'VK', label: 'VK', tint: 'border-blue-400/30 bg-blue-400/10 text-blue-300', href: `https://vk.com/share.php?url=${url}&title=${text}&image=${image}` },
    { key: 'whatsapp', badge: 'WA', label: 'WhatsApp', tint: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', href: `https://wa.me/?text=${text}%20${url}` },
    { key: 'facebook', badge: 'FB', label: 'Facebook', tint: 'border-indigo-400/30 bg-indigo-400/10 text-indigo-300', href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
    { key: 'reddit', badge: 'RD', label: 'Reddit', tint: 'border-orange-400/30 bg-orange-400/10 text-orange-300', href: `https://www.reddit.com/submit?url=${url}&title=${text}` }
  ]
})

const emailHref = computed(
  () => `mailto:?subject=${encodeURIComponent(shareTitle.value)}&body=${encodeURIComponent(`${shareText.value}\n${shareUrl.value}`)}`
)

const menuOpen = ref(false)
const actionsEl = ref<HTMLElement | null>(null)
const toast = ref('')
const cardBlob = ref<Blob | null>(null)
const cardBlobPending = ref(false)

function showToast(message: string) {
  toast.value = message
  window.setTimeout(() => {
    if (toast.value === message) toast.value = ''
  }, 2600)
}

function closeMenu() {
  menuOpen.value = false
}

const downloading = ref(false)
const sharing = ref(false)
/**
 * The Refresh button. Its one job is to make the page read Blizzard again, so the profile and
 * the card drawn from it are fetched with `?force=true` - the request the endpoints answer from
 * a fresh lookup instead of from their two hours of cache (see `server/api`). Blizzard answers a
 * person slowly and a burst of presses is a burst of calls, so once the fresh copy has landed the
 * button rests for a minute and counts the seconds down where its label stood.
 */
const refreshing = ref(false)
const cooldown = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | undefined

const canRefresh = computed(() => !refreshing.value && cooldown.value === 0)

const refreshLabel = computed(() => {
  if (refreshing.value) return t('refreshingProfile')
  if (cooldown.value > 0) return `${cooldown.value}s`
  return t('refreshProfile')
})

function startCooldown(seconds: number) {
  cooldown.value = seconds
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) {
      if (cooldownTimer) clearInterval(cooldownTimer)
      cooldownTimer = undefined
      cooldown.value = 0
    }
  }, 1000)
}

/**
 * The feed the Activity view shows: the achievements the character earned most recently.
 *
 * It is read through `useAsyncData` so the answer the server fetched travels to the browser with
 * the page - a deep link to `/activity` then paints its timeline on the first frame rather than
 * after a second round trip - and so the shell can ask for it again when the Refresh button is
 * pressed. It is fetched on demand (`immediate: false`): a visitor who never opens the feed pays
 * for none of the lookups behind it, and `force` is the request that makes the endpoint read
 * Blizzard again instead of answering from its two hours of cache (see `server/api/activity`).
 */
const activityForce = ref(false)

const {
  data: activity,
  pending: activityPending,
  error: activityError,
  refresh: reloadActivity
} = await useAsyncData<ActivityFeed | null>(
  () => `activity:${region}:${realm}:${name}:${apiLocale.value}`,
  () => $fetch<ActivityFeed>(
    `/api/activity/${region}/${realm}/${name}?locale=${apiLocale.value}${activityForce.value ? '&force=true' : ''}`
  ),
  { immediate: false, default: () => null }
)

/** Reads the feed, leaving it alone when it is already on hand. `force` makes it re-read Blizzard. */
async function loadActivity(force = false) {
  if (!force && activity.value) return
  activityForce.value = force
  try {
    await reloadActivity()
  } finally {
    activityForce.value = false
  }
}

// Opened directly, the feed address carries its timeline in the first response, which is the half
// of SEO that a feed of its own address exists for. A tab switch does not come through here - the
// shell is reused - so the feed view asks for it itself when it mounts (see `.../activity.vue`).
if (onActivityTab.value && character.value) {
  await loadActivity()
}

async function refreshProfile() {
  if (!canRefresh.value) return
  refreshing.value = true
  try {
    const fresh = await $fetch<CharacterData>(
      `/api/character/${region}/${realm}/${name}?locale=${apiLocale.value}&force=true`
    )
    character.value = fresh
    // The card is a picture of this profile, so the copy on hand is of an older one now.
    cardBlob.value = null
    await loadCardBlob(true)
    // A feed the shell is holding is a reading of the same character, so the refresh reaches it
    // too: `?force=true` is what makes the endpoint read Blizzard again (see `server/api/activity`).
    if (activity.value) void loadActivity(true)
    showToast(t('profileRefreshed'))
  } catch {
    showToast(t('refreshFailed'))
  } finally {
    refreshing.value = false
    startCooldown(60)
  }
}

/**
 * What the shell hands to the views (see `app/composables/characterView.ts`). Provided here, where
 * the character, the feed and the toast are owned, and injected by whichever view the address
 * names - so neither view reads Blizzard for what the shell already holds.
 */
provideCharacterView({
  region,
  realm,
  name,
  apiLocale,
  character,
  activity,
  activityPending,
  activityError,
  loadActivity,
  toast
})
/** The rendered card, cached so the share sheet can open without waiting for it. */
async function loadCardBlob(force = false): Promise<Blob | null> {
  if (!force && cardBlob.value) return cardBlob.value
  if (cardBlobPending.value) return null
  cardBlobPending.value = true
  try {
    // A refresh redraws the card: `?force=true` is the request the endpoint answers by drawing
    // again rather than from the picture it already has (see `server/api/card`).
    const url = force ? `${cardUrl.value}&force=true` : cardUrl.value
    cardBlob.value = await $fetch<Blob>(url, { responseType: 'blob' })
    return cardBlob.value
  } catch {
    return null
  } finally {
    cardBlobPending.value = false
  }
}

/**
 * What the downloaded card is called: `нейромаск-gordunni-card-2026-09-30.jpg`.
 *
 * The character leads and the realm follows, because a folder of these is read by the name
 * first; the day it was saved trails, so a card pulled on two days of farming keeps both
 * instead of the second overwriting the first.
 */
function cardFileName(): string {
  const today = new Date()
  const date = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-')

  return `${name}-${realm}-card-${date}.jpg`
}

function saveBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = cardFileName()
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function downloadCard() {
  if (downloading.value) return
  downloading.value = true
  try {
    const blob = await loadCardBlob()
    if (blob) saveBlob(blob)
  } finally {
    downloading.value = false
  }
}

/** Copies the character link, falling back to a selection where the clipboard API is missing. */
async function copyLink(announce = true) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareUrl.value)
    } else {
      const area = document.createElement('textarea')
      area.value = shareUrl.value
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.top = '-1000px'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    if (announce) showToast(t('linkCopied'))
  } catch {
    if (announce) showToast(t('linkCopyFailed'))
  }
  closeMenu()
}

/**
 * Phones hand the picture itself to the system share sheet, which is what puts the
 * picture into a chat. Desktops cannot do that, so there the image is downloaded
 * and the link copied, ready to be pasted next to it.
 */
async function shareCardImage() {
  if (sharing.value) return
  sharing.value = true
  closeMenu()

  try {
    const blob = cardBlob.value || (await loadCardBlob())
    const file = blob ? new File([blob], cardFileName(), { type: 'image/jpeg' }) : null

    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: shareTitle.value, text: shareText.value })
    } else if (file) {
      saveBlob(file)
      await copyLink(false)
      showToast(t('shareSaved'))
    } else {
      await copyLink(false)
      showToast(t('linkCopyFailed'))
    }
  } catch (err) {
    // Closing the share sheet without picking a target is not an error.
    if ((err as Error)?.name !== 'AbortError') console.error(err)
  } finally {
    sharing.value = false
  }
}

/** The card is fetched while the tray opens so the share sheet reacts instantly. */
function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) void loadCardBlob()
}

function onDocumentClick(event: MouseEvent) {
  if (menuOpen.value && actionsEl.value && !actionsEl.value.contains(event.target as Node)) {
    closeMenu()
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
  if (cooldownTimer) clearInterval(cooldownTimer)
})
</script>

<template>
  <div class="relative min-h-screen bg-wow-dark text-white flex flex-col justify-between selection:bg-wow-gold selection:text-black">
    <!-- The wait for the profile is the site-wide preloader's to draw (see `PagePreloader.vue`): the
         page keeps the room the profile will take, and the wheel over it is the root's own, so this
         read looks like every other wait on the site. -->
    <div v-if="pending" class="flex-1" />

    <div v-else-if="error || !character" class="flex-1 flex flex-col items-center justify-center p-4">
      <p class="text-red-400 text-lg font-semibold mb-4">{{ $t('notFound') }}</p>
      <NuxtLink :to="localeUrl('/')" class="px-6 py-2 bg-wow-gold text-black font-semibold rounded-lg hover:bg-wow-goldLight transition-colors">
        {{ $t('backToSearch') }}
      </NuxtLink>
    </div>

    <template v-else>
      <!-- The background: the class artwork, fixed so it holds still while the page moves over it,
           darkened the way the rest of the site darkens its own - a flat scrim and a vignette - so
           the pages read as one site. The layers themselves are shared with the hall of fame
           (`app/components/SiteBackdrop.vue`), and `armoury` is what lifts Blizzard's dark class art
           to match the site's own pictures. -->
      <SiteBackdrop :image="character.backgroundUrl" treatment="armoury" />

      <!-- The bar at the top of the page: the character's header and the page's own navigation
           (below), pinned together to the top of the window, so a visitor who has scrolled into the
           feed still has the character, the tabs and the Refresh button in view. The bar sits above
           the views (`z-40`) so they pass behind it, and the panel keeps only its bottom corners
           rounded because the bar stands flush against the top edge. It wears `hoa-bar`, which marks
           the glass inside it as pinned - the panel and the tabs are where Chromium can leave a
           stale, unblurred strip of the page showing - and the hint that answers it lives in
           `app/assets/css/main.css`. -->
      <header class="hoa-bar sticky top-0 z-40 container mx-auto px-4">
        <!-- The panel is a layer of its own above the navigation row below it (`z-30` against the
             row's `auto`), because the share tray opens downwards out of this panel and into that
             row: the tray lives inside the panel's own stacking context, so a layer here is what keeps
             the tray over the fade the navigation lays down, rather than under it. The panel's frost is
             drawn by a layer of the panel instead of by the panel itself (`hoa-panel-layered`), so the
             tray is not cut off from the page behind the bar: a `backdrop-filter` on the panel would
             leave the tray blurring nothing but the bar it hangs in. -->
        <div class="hoa-panel hoa-panel-layered relative z-30 rounded-t-none border-t-0 shadow-none px-4 py-1.5 sm:px-6 sm:py-3.5 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div class="flex items-center gap-4 sm:gap-6">
            <!-- The brand mark is the artwork itself (`app/assets/icons/hoa-emblem.svg`): a gold
                 plate with the emblem cut from it, so it keeps its own frame and stays sharp at any
                 size. -->
            <NuxtLink
              :to="localeUrl('/')"
              aria-label="HeroOfAzeroth"
              class="block h-20 w-20 shrink-0 transition-transform hover:scale-105"
            >
              <AppIcon name="hoa-emblem" class="h-full w-full" />
            </NuxtLink>

            <div>
              <div class="flex items-baseline gap-2 flex-wrap">
                <h1 class="text-2xl sm:text-4xl font-extrabold tracking-wide text-white drop-shadow">
                  {{ character.name }}
                </h1>
                <span v-if="character.title" class="text-wow-goldLight text-sm sm:text-base font-normal italic">
                  {{ character.title }}
                </span>
              </div>

              <p class="text-base sm:text-lg text-gray-400 mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <template v-for="(part, index) in metaParts" :key="index">
                  <CharacterName
                    v-if="part.isClass"
                    variant="badge"
                    :class-id="character.classId"
                    :class-name="character.class"
                  >{{ part.text }}</CharacterName>
                  <span v-else :class="part.className">{{ part.text }}</span>
                </template>
              </p>
            </div>
          </div>

          <!-- The Refresh button reads Blizzard again, and the card it redraws is the one the
               download hands out - the profile, the card and the feed all at once. The download
               button has taken the place the summary figures held, and their amber frame with it -
               the one warm accent the header has - with a glow that answers the pointer. The share
               tray is the same control, so it travels with the button and opens downwards, the
               header standing at the top of the page, and it is the site's menu pane (`.hoa-pop`),
               like the collections menu in the row below it. It is the same pane there as everywhere
               else: the panel it opens out of wears no filter of its own (`hoa-panel-layered`), so the
               tray blurs the page it hangs over instead of sampling the bar, which is also the
               arrangement Chromium smears over the bottom edge of a frosted bar. The pane and the
               reason it can be one pane everywhere are written in `app/assets/css/main.css`, beside
               the class. -->
          <div class="flex w-full items-stretch gap-3 lg:w-auto">
            <button
              type="button"
              :disabled="!canRefresh"
              class="flex shrink-0 items-center justify-center gap-2.5 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-all duration-300 hover:border-white/30 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 sm:py-3.5 sm:text-lg"
              :title="$t('refreshProfile')"
              :aria-label="$t('refreshProfile')"
              @click="refreshProfile"
            >
              <AppIcon name="refresh" class="h-[1.2em] w-[1.2em]" :class="refreshing ? 'animate-spin' : ''" />
              <span class="tabular-nums">{{ refreshLabel }}</span>
            </button>

            <div ref="actionsEl" class="relative flex-1 lg:flex-none">
              <div class="flex w-full items-stretch overflow-hidden rounded-xl border border-amber-500/60 bg-amber-950/30 shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all duration-300 hover:border-amber-400/90 hover:bg-amber-900/40 hover:shadow-[0_0_28px_rgba(245,158,11,0.5)]">
              <button
                type="button"
                :disabled="downloading"
                class="flex flex-1 items-center justify-center gap-2.5 px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 sm:px-7 sm:py-3.5 sm:text-lg"
                @click="downloadCard"
              >
                <AppIcon name="download-button" class="h-[1.2em] w-[1.2em]" />
                {{ downloading ? $t('loading') : $t('downloadCard') }}
              </button>

              <span class="w-px bg-amber-500/40"></span>

              <button
                type="button"
                class="px-3 transition-colors hover:bg-white/10 sm:px-3.5"
                :class="menuOpen ? 'bg-white/10' : ''"
                aria-haspopup="menu"
                :aria-expanded="menuOpen"
                :aria-label="$t('share')"
                @click="toggleMenu"
              >
                <svg
                  class="h-5 w-5 text-gray-200 transition-transform duration-200"
                  :class="menuOpen ? 'rotate-180' : ''"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>

            <div
              v-if="menuOpen"
              class="hoa-pop absolute top-full left-1/2 mt-3 w-[min(92vw,24rem)] -translate-x-1/2 lg:left-auto lg:right-0 lg:translate-x-0"
              role="menu"
            >
              <p class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{{ $t('shareCard') }}</p>

              <button
                type="button"
                role="menuitem"
                :disabled="sharing"
                class="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-normal text-gray-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
                @click="shareCardImage"
              >
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-wow-gold/30 bg-wow-gold/10 text-[11px]">📤</span>
                {{ $t('shareImage') }}
              </button>
              <div class="grid grid-cols-2 gap-1">
                <a
                  v-for="network in socials"
                  :key="network.key"
                  :href="network.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  class="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-normal text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                  @click="closeMenu"
                >
                  <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10px] font-semibold" :class="network.tint">{{ network.badge }}</span>
                  {{ network.label }}
                </a>
              </div>

              <p class="mt-1 border-t border-white/10 px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{{ $t('sendLink') }}</p>

              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-normal text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                @click="copyLink()"
              >
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10 text-[11px]">🔗</span>
                {{ $t('copyLink') }}
              </button>

              <a
                :href="emailHref"
                role="menuitem"
                class="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-normal text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                @click="closeMenu"
              >
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10 text-[11px]">✉️</span>
                {{ $t('email') }}
              </a>
            </div>
          </div>
          </div>
        </div>
      <!-- The page's own navigation: the profile it opens on, the feed of what the character has
             done lately, and the collections it has gathered. A tab is a link, so the browser keeps
             every view in its history, a shared link can point at one, and a crawler reaches each on
             its own address. It travels with the header above it - the two are pinned to the top of
             the window together - and the fade behind the row lets the cards below dissolve into the
             bar rather than poke at its edge. -->
        <nav class="relative pt-3" :aria-label="character.name">
          <!-- The fade the row of tabs sits on. It is kept under everything the navigation opens -
               the collections menu, the share tray - which is what `z-0` says: `pointer-events-none`
               already keeps it out of the way of a click, and the layer is what keeps it from
               darkening a menu that opens over it. It reaches only just past the row it stands behind
               (`h-12`, against a row of `pt-3` and tabs about forty pixels tall), and its stops are
               light enough that the content underneath is dimmed rather than blacked out: the bar has
               to be readable, not to cast a shadow halfway down the page. -->
          <div
            class="pointer-events-none absolute inset-x-0 top-0 z-0 h-12 bg-gradient-to-b from-wow-dark/90 via-wow-dark/55 to-transparent"
            aria-hidden="true"
          />
          <!-- The row of tabs: the profile, the shelves, the feed - and then the hall of fame, the
               site's other public page, one click away from the character a reader has just looked
               up. It is deliberately one row and one look: stepping from a character into the table
               of everybody keeps the bar, the tabs and the language pair exactly where they are, so
               the two pages read as one site rather than two. The fade behind the row lets the cards
               below dissolve into the bar rather than poke at its edge. -->
          <div class="relative flex flex-wrap gap-2">
            <NuxtLink
              :to="localeUrl(overviewPath)"
              class="hoa-tab hoa-liquid-glass"
              :class="{ 'hoa-tab-active': !onActivityTab && !onCollectionsTab }"
              :aria-current="!onActivityTab && !onCollectionsTab ? 'page' : undefined"
            >
              {{ $t('tabOverview') }}
            </NuxtLink>
            <!-- The collections are three shelves - mounts, pets, toys - and the menu that chooses
                 between them is part of this navigation rather than a row of tabs on the page
                 (`app/components/CollectionMenu.vue`). It stands where a reader looks for it: right
                 after the profile. -->
            <CollectionMenu :path="collectionsPath" :active="onCollectionsTab" />
            <NuxtLink
              :to="localeUrl(activityPath)"
              class="hoa-tab hoa-liquid-glass"
              :class="{ 'hoa-tab-active': onActivityTab }"
              :aria-current="onActivityTab ? 'page' : undefined"
            >
              {{ $t('tabActivity') }}
            </NuxtLink>
            <!-- The hall of fame, in the same row and wearing the same tab as the views beside it:
                 it is not a view of this character, but it is where a reader who has just looked
                 somebody up wants to go next, and it stands at the end of the row for that. -->
            <NuxtLink
              :to="localeUrl('/leaderboard')"
              class="hoa-tab hoa-liquid-glass"
            >
              {{ $t('lbNav') }}
            </NuxtLink>
            <!-- The languages sit at the far end of the row the tabs are on: a reader looks for the
                 switch where the navigation is, and the pair travels with the header as it is pinned
                 to the top of the window. -->
            <LocaleSwitch class="ml-auto" />
          </div>
        </nav>
      </header>

      <!-- One toast for the shell, because the Refresh button that raises it lives here and both
           views offer a moment to read it. -->
      <p v-if="toast" class="relative z-30 container mx-auto px-4 pt-3 text-xs font-normal text-wow-goldLight">{{ toast }}</p>

      <!-- The view the address names. It is rendered inside the shell, so the header, the tabs and
           the Refresh button above it are never rebuilt by a switch between the two. -->
      <NuxtPage />

      <footer class="relative z-20 container mx-auto px-4 pb-2 text-xs">
        <SiteFooter />
      </footer>

      <SupportButton />
    </template>

    <!-- Back to the top of a long page: it stands outside the three states above, so a reader who
         has scrolled far down a shelf or a feed has it whether the profile loaded, is loading or came
         back as a miss. -->
    <BackToTop />
  </div>
</template>