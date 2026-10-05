<script setup lang="ts">
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
  title: () => headline.value,
  description: () => descriptor.value,
  image: () => ogImage.value,
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

const getClassColor = (className: string) => {
  const colors: Record<string, string> = {
    'Rogue': '#FFF468', 'Разбойник': '#FFF468',
    'Mage': '#3FC7EB', 'Маг': '#3FC7EB',
    'Paladin': '#F48CBA', 'Паладин': '#F48CBA',
    'Warrior': '#C69B6D', 'Воин': '#C69B6D',
    'Warlock': '#8788EE', 'Чернокнижник': '#8788EE',
    'Priest': '#FFFFFF', 'Жрец': '#FFFFFF',
    'Hunter': '#AAD372', 'Охотник': '#AAD372',
    'Druid': '#FF7D0A', 'Друид': '#FF7D0A',
    'Shaman': '#0070DD', 'Шаман': '#0070DD',
    'Monk': '#00FF98', 'Монах': '#00FF98',
    'Demon Hunter': '#A330C9', 'Охотник на демонов': '#A330C9',
    'Death Knight': '#C41E3A', 'Рыцарь смерти': '#C41E3A',
    'Evoker': '#33937F', 'Пробудитель': '#33937F'
  }
  return colors[className] || '#f8b700'
}

const getPercent = (current: number, total: number) => {
  if (!total) return 0
  return Math.min(100, Math.round((current / total) * 100))
}

/** Formats counts the same way on the server and in the browser. */
const formatCount = (value: number) => value.toLocaleString('en-US')

interface StatTile {
  key: string
  /** File name in `~/assets/icons`, which `<AppIcon>` draws. */
  icon: string
  label: string
  /** The scope in small print under the label: whose numbers this tile shows. */
  note: string
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
 * are the character's own. Reputations are the account-wide Exalted Reputations counter
 * whenever Blizzard reports it, because achievements are account-wide and that is the
 * number the game itself shows; when the counter cannot be read the tile falls back to
 * the character's own Exalted factions, and the note follows the stat to say which one
 * arrived.
 */
const tileColumns = computed<StatTile[][]>(() => {
  const c = character.value
  if (!c) return []

  const accountWide = t('accountWide')
  const perCharacter = t('perCharacter')

  const tiles = [
    { key: 'mounts', icon: 'mounts', label: t('mounts'), note: perCharacter, count: c.stats.mounts.count, total: c.stats.mounts.total, color: 'text-amber-500' },
    { key: 'toys', icon: 'toys', label: t('toys'), note: accountWide, count: c.stats.toys.count, total: c.stats.toys.total, color: 'text-amber-500' },
    { key: 'reputations', icon: 'exalted-rep', label: t('reputations'), note: c.stats.reputations.accountWide ? accountWide : perCharacter, count: c.stats.reputations.count, total: c.stats.reputations.total, color: 'text-amber-500' },
    { key: 'achievements', icon: 'achievments', label: t('achievements'), note: perCharacter, count: c.stats.achievements.count, total: c.stats.achievements.total, color: 'text-wow-gold' },
    { key: 'pets', icon: 'pets', label: t('pets'), note: accountWide, count: c.stats.pets.count, total: c.stats.pets.total, color: 'text-purple-400' },
    { key: 'decor', icon: 'decor', label: t('decor'), note: accountWide, count: c.stats.decor.count, total: c.stats.decor.total, color: 'text-amber-500' }
  ]

  const withBar = tiles.map((tile) => ({
    ...tile,
    display: formatCount(tile.count),
    percent: getPercent(tile.count, tile.total)
  }))

  return [withBar.slice(0, 3), withBar.slice(3)]
})

/**
 * The level/race/spec/class/guild/realm line under the name, split into parts so
 * the template can put the `·` between them the way the card prints them.
 */
interface MetaPart {
  text: string
  /** Class colour, which also makes the part bold the way the game prints it. */
  color?: string
  className?: string
}

const metaParts = computed<MetaPart[]>(() => {
  const c = character.value
  if (!c) return []

  return [
    { text: String(c.level) },
    { text: c.race },
    { text: `${c.spec} ${c.class}`.trim(), color: getClassColor(c.class) },
    { text: c.guild ? `<${c.guild}>` : '' },
    { text: c.realm, className: 'text-gray-300 font-medium' }
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

/** The rendered PNG, cached so the share sheet can open without waiting for it. */
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

function saveBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${realm}-${name}-card.png`
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
 * Phones hand the PNG itself to the system share sheet, which is what puts the
 * picture into a chat. Desktops cannot do that, so there the image is downloaded
 * and the link copied, ready to be pasted next to it.
 */
async function shareCardImage() {
  if (sharing.value) return
  sharing.value = true
  closeMenu()

  try {
    const blob = cardBlob.value || (await loadCardBlob())
    const file = blob ? new File([blob], `${realm}-${name}-card.png`, { type: 'image/png' }) : null

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

/** The PNG is fetched while the tray opens so the share sheet reacts instantly. */
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

      <header class="relative z-20 container mx-auto px-4 pt-6">
        <div class="rounded-xl border border-white/10 bg-white/[0.06] p-4 sm:p-6 backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_30px_rgba(0,0,0,0.35)] flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div class="flex items-center gap-4 sm:gap-6">
            <!-- The brand mark is the artwork itself (`app/assets/img/emblem.png`).
                 It carries its own rounded-square frame, so the circular glass plate
                 that used to hold the flat white SVG has nothing left to frame. -->
            <NuxtLink
              :to="localeUrl('/')"
              aria-label="HeroOfAzeroth"
              class="block h-20 w-20 shrink-0 transition-transform hover:scale-105"
            >
              <img
                src="~/assets/img/emblem.png"
                alt=""
                aria-hidden="true"
                width="512"
                height="512"
                class="h-full w-full"
              />
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
              
              <p class="text-base sm:text-lg text-gray-400 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <template v-for="(part, index) in metaParts" :key="index">
                  <span v-if="index" class="text-gray-600">·</span>
                  <span
                    :class="[part.className, part.color ? 'font-semibold' : '']"
                    :style="part.color ? { color: part.color } : undefined"
                  >{{ part.text }}</span>
                </template>
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3 sm:gap-6 w-full lg:w-auto justify-between border-t lg:border-t-0 border-white/10 pt-3 lg:pt-0">
            <div class="text-center">
              <span class="text-xs text-gray-400 uppercase tracking-wider block">{{ $t('itemLevel') }}</span>
              <span class="text-2xl sm:text-3xl font-bold text-purple-400 inline-flex items-center justify-center gap-2">
                <AppIcon name="item-level" class="h-[0.85em] w-[0.85em]" />
                {{ character.ilvl }}
              </span>
            </div>
            <div class="h-8 w-[1px] bg-white/10"></div>
            <div class="text-center">
              <span class="text-xs text-gray-400 uppercase tracking-wider block">{{ $t('mPlus') }}</span>
              <span class="text-2xl sm:text-3xl font-bold text-amber-400 inline-flex items-center justify-center gap-2">
                <AppIcon name="key" class="h-[0.85em] w-[0.85em]" />
                {{ character.mPlusScore }}
              </span>
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
                  <span class="truncate">{{ tile.label }}</span>
                </span>
                <span class="text-2xl sm:text-3xl font-extrabold whitespace-nowrap text-right" :class="tile.color">{{ tile.display }}</span>
                <!-- Under the first row: whose numbers the tile shows, and how much of
                     everything there is to collect they cover. -->
                <span class="truncate text-[11px] font-semibold text-gray-400">{{ tile.note }}</span>
                <span class="whitespace-nowrap text-right text-[11px] font-semibold text-gray-400 tabular-nums">{{ formatCount(tile.total) }} / {{ tile.percent }}%</span>
              </div>
              <div class="w-full bg-black/60 h-2.5 rounded-full overflow-hidden p-0.5 border border-white/5">
                <div class="bg-gradient-to-r from-emerald-600 to-emerald-400 h-full rounded-full transition-all duration-1000" :style="{ width: tile.percent + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <!-- Card actions: the download and the share tray sit centred under the character.
           Only from `lg` up does the two-column grid leave the middle of the row free,
           so that is where the negative top margin may pull them up towards the model;
           while the tiles are still stacked in one column (phones and tablets) the
           button keeps an ordinary gap so it never rests on the last box. -->
      <div class="relative z-30 container mx-auto px-4 mt-6 sm:mt-8 lg:-mt-8 pb-6 flex flex-col items-center gap-2">
        <div ref="actionsEl" class="relative">
          <div class="flex items-stretch overflow-hidden rounded-2xl border border-white/15 bg-white/[0.08] backdrop-blur-xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_34px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              :disabled="downloading"
              class="flex items-center gap-3 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-60 sm:px-12 sm:py-5 sm:text-xl"
              @click="downloadCard"
            >
              <AppIcon name="download-button" class="h-[1.2em] w-[1.2em]" />
              {{ downloading ? $t('loading') : $t('downloadCard') }}
            </button>

            <span class="w-px bg-white/15"></span>

            <button
              type="button"
              class="px-3.5 transition-colors hover:bg-white/10 sm:px-4"
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
            class="absolute bottom-full left-1/2 z-40 mb-3 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border border-white/15 bg-black/85 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150"
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
    </template>
  </div>
</template>