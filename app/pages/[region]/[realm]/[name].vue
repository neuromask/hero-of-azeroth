<script setup lang="ts">
// The ladders the collection numbers and the Mythic+ rating are coloured by are shared with the
// card, which draws the same tiers into its own SVG: one table, so a page and its card can never
// disagree.
import { collectionPercent, mPlusQualityTextClass, wowQualityTextClass } from '#shared/utils/wow-quality'
// The class colour a name is printed in comes from the same table the card draws from, so the
// page and its card agree (see `#shared/utils/wow-class`).
import { resolveClass } from '#shared/utils/wow-class'
// The search history the front page offers: a character that rendered here is a search that
// worked, and that is what is worth keeping (see the composable for the shape and the limit).
import { useSearchHistory } from '~/composables/searchHistory'
// The Russian copy of this page is the same component under `/ru`; the middleware reads
// the language off whichever of the two addresses was asked for.
definePageMeta({ alias: '/ru/:region/:realm/:name' })

const route = useRoute()
const { locale, t } = useI18n()
const localeUrl = useLocaleUrl()
// The region is the second path segment (`/region-eu/gordunni/neromask`, or
// `/ru/region-eu/gordunni/neromask` in Russian), so it is part of the shared URL and
// no longer needs to be guessed from the character.
const region = regionFromPath(String(route.params.region || ''))
const realm = String(route.params.realm || '')
const name = String(route.params.name || '')

if (!region) {
  throw createError({ statusCode: 404, statusMessage: 'Unknown region' })
}

const apiLocale = computed(() => (locale.value === 'ru' ? 'ru_RU' : 'en_US'))

const { data: character, pending, error } = await useFetch(
  () => `/api/character/${region}/${realm}/${name}?locale=${apiLocale.value}`
)

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
    // The class rides along so the front page can tint the remembered name with it; the id is
    // the same in either language, which is what the row is coloured by.
    classId: loaded.classId,
    class: resolveClass(loaded)?.slug
  })
}, { immediate: true })

const descriptor = computed(() => {
  const c = character.value
  if (!c) return ''
  return `${t('itemLevel')}: ${c.ilvl} · ${t('mPlus')}: ${c.mPlusScore} · ${t('achievements')}: ${c.ap.toLocaleString('en-US')} · ${c.realm}`
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
  return [c.class, c.realm].filter(Boolean).join(', ')
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
 * same figures stand out as a row behind a glyph. Both are built from one set of numbers and
 * the same labels, so they can never disagree about a character.
 */
const seoTitle = computed(() => {
  const c = character.value
  if (!c) return name
  return seoName.value ? `${c.name} - ${seoName.value} (${regionCode.value})` : `${c.name} (${regionCode.value})`
})

const seoDescription = computed(() => {
  const c = character.value
  if (!c) return ''
  return [
    seoName.value ? `${c.name} (${seoName.value})` : c.name,
    `${t('achievements')}: ${c.ap}`,
    `${t('mounts')}: ${c.stats.mounts.count}`,
    `${t('seoPets')}: ${c.stats.pets.count}`,
    `${t('toys')}: ${c.stats.toys.count}`,
    `${t('seoItemLevel')}: ${c.ilvl}`,
    t('seoCharacterSuffix')
  ].join(' · ')
})

const seoOgDescription = computed(() => {
  const c = character.value
  if (!c) return ''
  return [
    `⚔️ ${seoOgWho.value || c.name}`,
    `🏆 ${c.ap}`,
    `🛡️ ilvl ${c.ilvl}`,
    `🔑 M+ ${c.mPlusScore}`,
    `🐎 ${t('mounts')} ${c.stats.mounts.count}`,
    `🐾 ${t('seoPets')} ${c.stats.pets.count}`,
    `🧸 ${t('toys')} ${c.stats.toys.count}`,
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

/** Class colours are shared with the card and the history (see `#shared/utils/wow-class`). */

/** Formats counts the same way on the server and in the browser. */
const formatCount = (value: number) => value.toLocaleString('en-US')

/**
 * The rating wears the tier it has reached, off the same Mythic+ bands the card colours the
 * figure with. The item level beside it stays plain white: it is a single number with no ladder
 * of its own to be read against, so it is left to read as a fact.
 */
const mPlusColor = computed(() => mPlusQualityTextClass(character.value?.mPlusScore ?? 0))

interface StatTile {
  key: string
  /** File name in `~/assets/icons`, which `<AppIcon>` draws. */
  icon: string
  label: string
  /** The scope in small print under the label: whose numbers this tile shows. */
  note: string
  /** The tier colour the count is set in, from the shared quality ladder. */
  color: string
  display: string
  percent: number
}

/**
 * The stat tiles with their progress bars, split into the two columns they are
 * laid out in around the character. Achievements lead the right column.
 *
 * Every tile names the scope of its number in small print, because the six do not come
 * from the same place: pets, toys and decor arrive account-wide from Blizzard - they are
 * identical for every character of an account - while mounts and the achievement points
 * are the character's own, and reputations are too - deliberately so, because a character
 * is only ever on one side of the faction war while the account's characters are not, so a
 * count across the account would mix the two sides and have no reachable total to sit
 * under. The tile counts the ladders this character has finished itself - the Exalted
 * factions, plus a renown faction at its last renown level and a delve companion at its
 * last level, which have no Exalted tier at all. Its
 * denominator is what a character of this faction can reach, not Blizzard's whole
 * faction index - see `reputationTotal`.
 *
 * The count carries the tier its collection has reached rather than a fixed colour, so the
 * number says how far along the tile is at a glance. The ladder is the shared one, off the
 * same thresholds the card colours its own numbers by (`shared/utils/wow-quality.ts`).
 */
const tileColumns = computed<StatTile[][]>(() => {
  const c = character.value
  if (!c) return []

  const accountWide = t('accountWide')
  const perCharacter = t('perCharacter')

  const tiles = [
    { key: 'mounts', icon: 'mounts', label: t('mounts'), note: perCharacter, count: c.stats.mounts.count, total: c.stats.mounts.total },
    { key: 'toys', icon: 'toys', label: t('toys'), note: accountWide, count: c.stats.toys.count, total: c.stats.toys.total },
    { key: 'reputations', icon: 'exalted-rep', label: t('reputations'), note: perCharacter, count: c.stats.reputations.count, total: c.stats.reputations.total },
    { key: 'achievements', icon: 'achievments', label: t('achievements'), note: perCharacter, count: c.stats.achievements.count, total: c.stats.achievements.total },
    { key: 'pets', icon: 'pets', label: t('pets'), note: accountWide, count: c.stats.pets.count, total: c.stats.pets.total },
    { key: 'decor', icon: 'decor', label: t('decor'), note: accountWide, count: c.stats.decor.count, total: c.stats.decor.total }
  ]

  const withBar = tiles.map((tile) => ({
    ...tile,
    // The count wears the tier its collection has reached, the way the card's numbers do.
    color: wowQualityTextClass(tile.count, tile.total),
    display: formatCount(tile.count),
    percent: collectionPercent(tile.count, tile.total)
  }))

  return [withBar.slice(0, 3), withBar.slice(3)]
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

  // Общий стиль для янтарных баблов
  const amberBadge = 'inline-flex items-center px-2.5 py-0.5 rounded-lg border border-amber-500/50 bg-amber-950/20 text-xs font-medium text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)] backdrop-blur-sm'

  return [
    // 1. Уровень
    { 
      text: String(c.level), 
      className: `${amberBadge} font-semibold` 
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

/** The rendered card, cached so the share sheet can open without waiting for it. */
async function loadCardBlob(): Promise<Blob | null> {
  if (cardBlob.value) return cardBlob.value
  if (cardBlobPending.value) return null
  cardBlobPending.value = true
  try {
    cardBlob.value = await $fetch<Blob>(cardUrl.value, { responseType: 'blob' })
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
})
</script>

<template>
  <div class="relative min-h-screen bg-wow-dark text-white overflow-hidden flex flex-col justify-between selection:bg-wow-gold selection:text-black">
    <div v-if="pending" class="flex-1 flex items-center justify-center">
      <div class="animate-spin rounded-full h-12 w-12 border-4 border-wow-gold border-t-transparent"></div>
    </div>

    <div v-else-if="error || !character" class="flex-1 flex flex-col items-center justify-center p-4">
      <p class="text-red-400 text-lg font-semibold mb-4">{{ $t('notFound') }}</p>
      <NuxtLink :to="localeUrl('/')" class="px-6 py-2 bg-wow-gold text-black font-bold rounded-lg hover:bg-wow-goldLight transition-colors">
        {{ $t('backToSearch') }}
      </NuxtLink>
    </div>

    <template v-else>
      <div class="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div class="absolute w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[120px]"></div>
        <!-- Armoury class artwork -->
        <img
          v-if="character.backgroundUrl"
          :src="character.backgroundUrl"
          alt=""
          aria-hidden="true"
          class="absolute inset-0 h-full w-full object-cover saturate-[1.5] brightness-[1.45]"
        />
        <!-- Blizzard's render is a 1600x1200 canvas with the model floating in
             the middle, so the image is blown up and shifted until the feet sit
             on the bottom edge of the window. -->
        <div class="relative z-10 h-[78vh] max-h-[820px] w-[62vh] overflow-hidden">
          <img
            v-if="character.renderUrl"
            :src="character.renderUrl"
            :alt="character.name"
            class="absolute left-1/2 top-0 h-[145%] max-w-none -translate-x-1/2 -translate-y-[13%] object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.9)]"
          />
        </div>
        <div class="absolute inset-0 bg-gradient-to-t from-wow-dark via-transparent to-wow-dark/40 z-10"></div>
      </div>

      <header class="relative z-30 container mx-auto px-4 pt-6">
        <div class="rounded-xl border border-white/10 bg-white/[0.06] p-4 sm:p-6 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_30px_rgba(0,0,0,0.35)] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div class="flex items-center gap-4 sm:gap-6">
            <!-- The brand mark is the artwork itself (`app/assets/icons/hoa-emblem.svg`): a
                 gold plate with the emblem cut from it, so it keeps its own frame and stays
                 sharp at any size. -->
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
                <span v-if="character.title" class="text-wow-goldLight text-sm sm:text-base font-medium italic">
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

          <!-- The download button has taken the place the summary figures held, and their amber
               frame with it - the one warm accent the header has - with a glow that answers the
               pointer. The share tray is the same control, so it travels with the button and
               opens downwards, the header standing at the top of the page. -->
          <div ref="actionsEl" class="relative w-full lg:w-auto">
            <div class="flex items-stretch overflow-hidden rounded-xl border border-amber-500/60 bg-amber-950/30 backdrop-blur-sm shadow-[0_0_15px_rgba(245,158,11,0.25)] transition-all duration-300 hover:border-amber-400/90 hover:bg-amber-900/40 hover:shadow-[0_0_28px_rgba(245,158,11,0.5)]">
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
              class="absolute top-full left-1/2 z-40 mt-3 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-white/15 bg-black/85 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 lg:left-auto lg:right-0 lg:translate-x-0"
              role="menu"
            >
              <p class="px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">{{ $t('shareCard') }}</p>

              <button
                type="button"
                role="menuitem"
                :disabled="sharing"
                class="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60"
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
                  class="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                  @click="closeMenu"
                >
                  <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border text-[10px] font-extrabold" :class="network.tint">{{ network.badge }}</span>
                  {{ network.label }}
                </a>
              </div>

              <p class="mt-1 border-t border-white/10 px-3 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-gray-500">{{ $t('sendLink') }}</p>

              <button
                type="button"
                role="menuitem"
                class="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                @click="copyLink()"
              >
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10 text-[11px]">🔗</span>
                {{ $t('copyLink') }}
              </button>

              <a
                :href="emailHref"
                role="menuitem"
                class="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white"
                @click="closeMenu"
              >
                <span class="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-white/15 bg-white/10 text-[11px]">✉️</span>
                {{ $t('email') }}
              </a>
            </div>
          </div>

        </div>
      </header>

      <main class="relative z-20 container mx-auto px-4 py-6 flex-1 flex flex-col justify-center">
        <!-- The tile columns carry a 20% wider box than the original (100% - 45vw) / 2
             rows, which is about 32% of the row here: a column of (100% - gap) / 2
             with a 36% gap works out at 32%, and that lands within a percent of the
             20%-wider width at every container size. The gap is a share of the
             padded row rather than of the viewport on purpose: `container` stops
             growing at a breakpoint while `vw` does not, so a viewport-based gap
             keeps widening and squeezes the boxes on large screens. -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-[36%] items-center">
          <div v-for="(column, columnIndex) in tileColumns" :key="columnIndex" class="space-y-4">
            <div
              v-for="tile in column"
              :key="tile.key"
              class="rounded-xl border border-white/10 bg-white/[0.06] p-3 sm:p-4 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_30px_rgba(0,0,0,0.35)] transition-colors hover:border-wow-gold/60 hover:bg-white/[0.09]"
            >
              <!-- Two columns of two rows. The first row carries the glyph, the label
                   and the big number, which share one line so their centres line up.
                   The second row carries the scope of the number and the `total / %`,
                   written in the same style so the two read as one line. The glyph is
                   1.5x the 1.15em it used to be (1.725em, so it scales with the label
                   at both breakpoints) and sits in a square box, which is the 1:1
                   `viewBox` every icon file is drawn on, so nothing is stretched. -->
              <div class="grid grid-cols-[1fr_auto] items-center gap-x-3 mb-2">
                <span class="flex min-w-0 items-center gap-2.5 text-base font-bold uppercase tracking-wider text-gray-200 sm:text-lg">
                  <AppIcon :name="tile.icon" class="h-[1.725em] w-[1.725em] shrink-0" />
                  <span class="truncate text-[22px]">{{ tile.label }}</span>
                </span>
                <span class="text-2xl sm:text-3xl font-extrabold whitespace-nowrap text-right" :class="tile.color">{{ tile.display }}</span>
                <!-- Under the first row: whose numbers the tile shows, and how much of
                     everything there is to collect they cover. -->
                <span class="truncate text-[12px] uppercase px-10 font-semibold text-gray-400">{{ tile.note }}</span>
                <span class="whitespace-nowrap text-right text-[12px] font-semibold text-gray-400 tabular-nums">{{ formatCount(tile.total) }} / {{ tile.percent }}%</span>
              </div>
              <div class="w-full bg-black/60 h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
                <div class="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full transition-all duration-1000" :style="{ width: tile.percent + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <!-- The summary figures sit centred under the tiles, where the download button used to
           stand. Only from `lg` up does the two-column grid leave the middle of the row free,
           so that is where the negative top margin may pull the block up towards the model;
           while the tiles are still stacked in one column (phones and tablets) it keeps an
           ordinary gap so it never rests on the last box. -->
      <div class="relative z-30 container mx-auto px-4 mt-6 sm:mt-8 lg:-mt-8 pb-6 flex flex-col items-center gap-2">
        <!-- The summary figures have taken the place the download button held, and with it the
             glass the tiles above are cut from: the same frame, the same blur and the same lift
             under the pointer, so the row reads as one more block of statistics. -->
        <div class="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_30px_rgba(0,0,0,0.35)] transition-colors hover:border-wow-gold/60 hover:bg-white/[0.09] sm:gap-6 sm:px-5 sm:py-3 lg:w-auto">
          <div class="text-center">
            <span class="text-xs text-gray-200 uppercase tracking-wider block font-bold">{{ $t('itemLevel') }}</span>
            <span class="text-2xl sm:text-3xl font-bold text-white inline-flex items-center justify-center gap-2">
              <AppIcon name="item-level" class="h-[0.85em] w-[0.85em]" />
              {{ character.ilvl }}
            </span>
          </div>
          <div class="h-8 w-[1px] bg-white/15"></div>
          <div class="text-center">
            <span class="text-xs text-gray-200 uppercase tracking-wider block font-bold">{{ $t('mPlus') }}</span>
            <span class="text-2xl sm:text-3xl font-bold inline-flex items-center justify-center gap-2" :class="mPlusColor">
              <AppIcon name="key" class="h-[0.85em] w-[0.85em]" />
              {{ character.mPlusScore }}
            </span>
          </div>
        </div>

        <p v-if="toast" class="text-xs font-medium text-wow-goldLight">{{ toast }}</p>
      </div>

      <footer class="relative z-20 container mx-auto px-4 pb-6 flex flex-col items-center gap-1.5 text-xs text-gray-500">
        <AppIcon name="hoa-logotype" alt="HeroOfAzeroth" class="h-7 w-auto" />
        <span class="flex items-center gap-1.5">
          <a href="https://heroofazeroth.com" class="transition-colors hover:text-wow-goldLight">heroofazeroth.com</a>
          <span aria-hidden="true">&middot;</span>
          <span>copyright &copy; {{ new Date().getFullYear() }}</span>
        </span>
      </footer>

      <SupportButton />
    </template>
  </div>
</template>