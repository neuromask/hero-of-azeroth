<script setup lang="ts">
/**
 * The place the reader holds in the table, drawn as a plate of the page's own.
 *
 * The hall of fame ranks everybody, and a reader who has looked a character up from this browser is
 * one of its rows - that is what being signed in means on a site with no accounts (see
 * `useSearchHistory`). Their row can be anywhere: page 4 of 50, behind a realm chip, below another
 * character of the same name. So the page hands it to them rather than leaving them to page through
 * the table for it: the row's own facts - portrait, name in its class colour, side, realm, class and
 * level, read exactly as a table row reads them, so it is the row they are about to be shown - and the
 * two figures a place is made of, the place itself and the rating it was earned with.
 *
 * It stands under the five summary plates and above the filters, which is a decision rather than a
 * leftover. Those plates are the page's answer about the population - how many there are, who leads
 * them - and where the reader stands among them is the same kind of fact: it is read before the
 * filtering begins, and a filter changed below it does not move it. The header's signed-in chip is the
 * other place it could have gone, and deliberately does not carry it: that chip is drawn on every page
 * of the site, and only this page knows what the hall of fame makes of a character.
 *
 * The figures are fetched, never guessed. The browser knows who the reader is but not what they are
 * worth, so the plate asks the table itself for the row and its place
 * (`server/api/leaderboard/[region]/[realm]/[name].get.ts`) and prints dashes until the answer lands,
 * the way the plates above it do. A character the table does not know draws no plate at all, because
 * there is no place to print.
 */
import { searchHistoryKey } from '~/composables/searchHistory'
import type { SearchHistoryEntry } from '~/composables/searchHistory'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { formatNumber } from '#shared/utils/formatNumber'
import { factionById } from '#shared/utils/wow-faction'
import type { LeaderboardStanding } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The character this browser is signed in as: the row the plate stands for. */
  character: SearchHistoryEntry
}>()

const emit = defineEmits<{ (event: 'reveal', rank: number): void }>()

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name the plate
// prints comes from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** A dash, which is what a figure the table does not know is printed as. */
const DASH = '—'

/** The character's address under the table's, which is where their own place is asked for. */
const url = computed(
  () => `/api/leaderboard/${props.character.region}/${props.character.realm}/${props.character.name}`
)

/**
 * The place, asked for once and not awaited: what the browser already knows about the character is
 * worth a first frame - a name, a portrait, a class colour - and the figures fill in behind it, so a
 * plate that is waiting reads as one that is filling rather than as an empty one.
 *
 * No `default` is given, and that is deliberate. Nuxt reads a data value that is not `undefined` at
 * the moment a component first renders as one the server already sent, and answers the request from
 * that value instead of making it - and this plate only ever exists in the browser, because who the
 * reader is lives in the browser's own storage. A default here would therefore be the whole answer:
 * a plate of dashes that never asked the table anything. Left undefined, the data is genuinely
 * absent, and the request goes out.
 */
const { data: standing, status } = useFetch<LeaderboardStanding | null>(url, {
  key: `hoa-leaderboard-standing:${searchHistoryKey(props.character)}`
})

/** The row the table draws for the character, or `null` until the answer lands. */
const player = computed(() => standing.value?.player || null)

/** The place, the population it is a place in, and the rating that put them there. */
const rank = computed(() => standing.value?.rank || 0)
const total = computed(() => standing.value?.total || 0)
// Read off the row rather than off the answer, so that a figure is only ever taken from a record that
// is really there: an answer that is empty - a character the table refuses, a request that failed - is
// a plate with nothing in it, not a figure made of nothing.
const score = computed(() => player.value?.score || 0)

/** Whether there is a place to print, which is what the button at the end of the plate needs. */
const known = computed(() => rank.value > 0)

/**
 * Whether the plate is drawn at all.
 *
 * Until the answer lands it is: the browser's own half of the row is worth showing, and the dashes
 * say the rest is on its way. Once the answer has landed, a plate without a place in it is no plate:
 * a character the table does not know has nothing here to be told. A request that failed reads the
 * same way, and the page has an error line of its own for the table.
 */
const shows = computed(() => status.value === 'idle' || status.value === 'pending' || known.value)

/** The class the row is drawn by: the table's record once it is there, the entry before that. */
const classId = computed(() => player.value?.classId || props.character.classId || 0)
const classHex = computed(() => classById(classId.value)?.hex || DEFAULT_CLASS_HEX)
const className = computed(() => {
  const entry = classById(classId.value)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
})

/** The name as the game spells it, which an address cannot carry and the profile kept. */
const displayName = computed(() => player.value?.displayName || props.character.name)

/** The portrait, which either half of the answer may have and neither is guaranteed to. */
const avatar = computed(() => player.value?.avatar || props.character.avatar || '')

/** The side and the level, which only the table's own record carries. */
const faction = computed(() => factionById(player.value?.faction))
const level = computed(() => player.value?.level || 0)

/** The realm in the language being read, under either of the names it was stored with. */
const realmName = computed(() =>
  realmLabel(props.character.region, props.character.realm, player.value?.realmName || props.character.realmName)
)

/** The row's own page, which the name in the plate leads to, in the language being read. */
const profileUrl = computed(
  () => localeUrl(`/${regionPath(props.character.region)}/${props.character.realm}/${props.character.name}`)
)

/** The letter a portrait falls back to, when there is none or the one there is failed. */
const initial = computed(() => (displayName.value || props.character.name).charAt(0).toUpperCase())

/** A portrait that failed to load, which the monogram then stands in for. */
const broken = ref(false)
</script>

<template>
  <!-- The plate stands on the page's own glass, warmed with the brand gold: it is the one block on
       the page that is about the reader, and the gold is what the site says that with. Its frost is
       drawn by a layer of it (`hoa-panel-layered`, with a layer of its own for that `-z-10` to sit
       under), because the way to the reader's row is a button of the site's glass and a filter on the
       plate would leave that button sampling the plate - a control can only read a block it stands in
       as a washed copy of it. In a plain box the button keeps the page as its backdrop and reads as the
       tabs above the plate do. -->
  <div
    v-if="shows"
    class="hoa-panel hoa-panel-layered hoa-ring-gold relative z-0 flex flex-wrap items-center gap-x-6 gap-y-3 p-3 sm:p-3.5"
  >
    <!-- The reader's own row, drawn as the table draws one: the portrait in the class colour, the
         name in it, the side beside the name, and the realm, class and level under it. -->
    <div class="flex min-w-0 items-center gap-3">
      <span
        class="relative grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border"
        :style="{ borderColor: `${classHex}66`, backgroundColor: `${classHex}1f` }"
      >
        <span class="text-base font-extrabold" :style="{ color: classHex }">{{ initial }}</span>
        <img
          v-if="avatar && !broken"
          :src="avatar"
          :alt="displayName"
          loading="lazy"
          decoding="async"
          class="absolute inset-0 h-full w-full object-cover"
          @error="broken = true"
        />
      </span>

      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <NuxtLink
            :to="profileUrl"
            class="truncate font-bold hover:underline"
            :style="{ color: classHex }"
          >{{ displayName }}</NuxtLink>

          <!-- The same mark the table puts on this character's row, drawn the same way: the plate is
               about the character the browser opened, and it says so. -->
          <span
            class="inline-flex shrink-0 items-center rounded border border-wow-gold/60 bg-wow-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-wow-goldLight"
          >{{ t('lbSelectedBadge') }}</span>

          <span
            v-if="faction"
            class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none"
            :style="{ borderColor: `${faction?.hex}55`, color: faction?.hex }"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :style="{ backgroundColor: faction?.hex }"
              aria-hidden="true"
            ></span>
            {{ t(faction?.labelKey || '') }}
          </span>
        </div>

        <p class="truncate text-xs text-gray-500">
          {{ realmName }}
          <template v-if="className"> · {{ className }}</template>
          <template v-if="level"> · {{ t('lbLevel') }} {{ formatNumber(level) }}</template>
        </p>
      </div>
    </div>

    <!-- The two figures a place is made of, and the way to the row they belong to. The place leads
         the pair, because it is the figure the plate is about and the rating is what earned it. -->
    <div class="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{{ t('lbYouPlace') }}</p>
        <p class="text-2xl font-extrabold leading-tight tabular-nums whitespace-nowrap text-wow-goldLight">
          <span v-if="known">{{ formatNumber(rank) }}</span>
          <span v-else>{{ DASH }}</span>
          <span v-if="known" class="ml-1.5 text-sm font-normal text-gray-400">
            {{ t('lbYouOf', { total: formatNumber(total) }) }}
          </span>
        </p>
      </div>

      <div>
        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{{ t('lbColScore') }}</p>
        <p class="text-2xl font-extrabold leading-tight tabular-nums whitespace-nowrap text-wow-goldLight">
          {{ known ? formatNumber(score) : DASH }}
        </p>
      </div>

      <!-- The button is the point of the plate for a reader past the first page: the page turns the
           place into the page of the table that holds the row and brings the row into view. -->
      <button
        v-if="known"
        type="button"
        class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs"
        @click="emit('reveal', rank)"
      >{{ t('lbYouReveal') }}</button>
    </div>
  </div>
</template>
