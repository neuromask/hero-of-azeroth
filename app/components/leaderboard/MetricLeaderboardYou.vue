<script setup lang="ts">
/**
 * The character this browser has selected, drawn above a metric leaderboard: who they are, what they hold for the
 * figure the table ranks, and where they stand among the world, their region and their realm.
 *
 * TEMP-OFF (2026-10-16): this plate is not mounted anywhere at the moment - it was taken off the front door and
 * off every ranking page at the site owner's request, and the two places that drew it say so where they stood
 * (`app/pages/index.vue`, `app/components/leaderboard/MetricLeaderboard.vue`, both marked with the same
 * `TEMP-OFF`). Nothing here is dead code and nothing was removed: the component is kept whole, with its props,
 * its request and its press, so that bringing it back is deleting two comment markers rather than rebuilding a
 * plate. It is left here - documented, tested by the build - precisely because "for now" is the whole reason.
 *
 * It is the plate the whole site wears - the hall of fame's own front door draws it too, about the overall rating -
 * wearing this ranking's question. The front door's plate
 * answers "where do I stand by score"; the ranking of one figure has to answer the same thing *for that figure* -
 * and that is not one number but three, because a mount count among everybody, among the region and among a single
 * realm are three different things to be told. So the plate prints the three of them as the links the comparison
 * board prints (`MetricRankLinks.vue`), each opening the ranking it names already turned to this character's row,
 * and it offers the fourth thing a reader came for: a press that walks *this* table to their row.
 *
 * The character is the one this browser selected - the last one it opened, or the main of the account it is signed
 * in with (`useSearchHistory`; `app/pages/index.vue` reads the same list) - and everything the plate draws before
 * the answer lands comes from the browser's own record: a name, a realm, a class colour, a portrait. The figures
 * come from the table's own API (`/api/leaderboard/metric-ranks`), asked for once per character and figure, and
 * the press that walks the table is the very `?rank=` mechanism a link uses - so the place the plate prints and
 * the row the table turns to are one number.
 *
 * It is laid out in three columns, which is the order a reader reads it in: who they are on the left (portrait,
 * name, the two badges, the realm, class and level), where they stand in the middle - the three places are one
 * reading at three scopes, so they stand together, centred, parted from the halves beside them by a hairline of the
 * panel's own - and what they hold for this figure on the right, with the press that walks the table to their row.
 * A phone stacks the three, because three columns of this in 360 px is a column of one word each.
 */
import { formatNumber } from '#shared/utils/formatNumber'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { factionById } from '#shared/utils/wow-faction'
import { searchHistoryKey, type SearchHistoryEntry } from '#shared/utils/savedCharacters'
import type {
  MetricLeaderboard,
  MetricLeaderboardRank,
  MetricLeaderboardScope
} from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The ranking being drawn, which is the figure the plate prints a value for. */
  metric: MetricLeaderboard
  /** The character this browser selected, in the shape both remembered lists keep. */
  character: SearchHistoryEntry
  /** Where the table is scoped, which is the place the reveal walks to: the world's, the region's or the realm's. */
  scope: MetricLeaderboardScope
  /**
   * Whether the plate carries the legend of the overall score, which is what the value it prints is.
   *
   * True where the plate stands for the score itself - the front door, whose plate is about the overall rating - and
   * false on a ranking of any other figure, where a `?` about the score would be a question about a number the table
   * beside it does not show. A ranking of the score gets it from the bar above the table instead, beside the field.
   */
  legend?: boolean
}>()

const emit = defineEmits<{ (event: 'reveal', rank: number): void }>()

const { t, locale } = useI18n()
const localeUrl = useLocaleUrl()
// A record stores the realm's name in the language its profile was read in, so the name the plate prints comes
// from the site's own realm list instead (`app/composables/realmNames.ts`).
const { realmLabel } = useRealmNames()

/** A dash, which is what a figure the table does not know is printed as. */
const DASH = '—'

/** The character keyed the way the ranking keys a row, which is the key the endpoint answers under. */
const key = computed(() => searchHistoryKey(props.character))

/**
 * The places, asked for once per character and figure and not awaited: the browser's own half of the plate - a
 * name, a portrait, a class - is worth a first frame, and the figures fill in behind it. No `default` is given,
 * for the reason the front door's plate gives none: the plate exists only in the browser (who the reader selected
 * lives in its own storage), and a default would be the whole answer - a plate of dashes that never asked.
 */
const { data, status } = useFetch<{ players: MetricLeaderboardRank[] } | null>(
  () => `/api/leaderboard/metric-ranks?metric=${props.metric.slug}&players=${encodeURIComponent(key.value)}`,
  {
    key: () => `hoa-metric-standing:${props.metric.slug}:${key.value}`,
    // The answer is asked for afresh: the endpoint's own cache lets a browser keep a reading for an hour, while a
    // place in a ranking moves the moment anybody's page is rendered.
    headers: { 'cache-control': 'no-cache' }
  }
)

/** This character's line of the answer, or `null` until it lands. */
const rank = computed<MetricLeaderboardRank | null>(() => data.value?.players?.[0] || null)

/** The figure they hold for this ranking, or `null` where the site has never read one. */
const value = computed(() => rank.value?.value ?? null)

/**
 * Their place in the ranking this table is drawing, which is the number the plate's press walks to.
 *
 * The page's scope decides which of the three places that is: a world page reveals the world's place, a region
 * page the region's, a realm page the realm's. A character who holds no place in *this* one - ranked in the world
 * but not in a realm they have just moved to - is a plate with the links but no press, because there is no row
 * here for them to be shown.
 */
const place = computed<number | null>(() => {
  const answer = rank.value
  if (!answer) return null
  if (!props.scope.region) return answer.worldRank
  if (!props.scope.realm) return answer.regionRank
  return answer.realmRank
})

/** Whether the plate is drawn: always, once this browser knows a character, and never before it does. */
const shows = computed(() => status.value === 'idle' || status.value === 'pending' || rank.value !== null)

/**
 * The row the ranking holds for this character, or `null` before the answer lands.
 *
 * Everything the plate prints about *who* the character is comes from here when it is there and from the browser's
 * own record until then - the same pair every plate of the site reads, and for the same
 * reason: a plate that waited for the answer before printing a name would be a plate that shows nothing, and one
 * that only ever trusted the browser's copy could print a portrait or a class the table has since changed.
 */
const row = computed(() => rank.value?.player || null)

/** The class the name is drawn in: the ranking's record of it, or the browser's. */
const classId = computed(() => row.value?.classId ?? props.character.classId ?? 0)
const classHex = computed(() => classById(classId.value)?.hex || DEFAULT_CLASS_HEX)

/** The class's name in the language being read. */
const className = computed(() => {
  const entry = classById(classId.value)
  if (!entry) return ''
  return locale.value === 'ru' ? entry.nameRu : entry.name
})

/** The name as the game spells it, which an address cannot carry. */
const displayName = computed(() => row.value?.displayName || props.character.name)

/** The portrait, which either half of the answer may have and neither is guaranteed to. */
const avatar = computed(() => row.value?.avatar || props.character.avatar || '')

/** The realm, named in the language being read rather than in the language it was stored with. */
const realmName = computed(() =>
  realmLabel(props.character.region, props.character.realm, row.value?.realmName || props.character.realmName)
)

/** The side and the level, which only the ranking's own record carries. */
const faction = computed(() => factionById(row.value?.faction))
const level = computed(() => row.value?.level || 0)

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
  <!-- The plate stands on the page's own glass, warmed with the brand gold: it is the one block on the table's
       page that is about the reader, and the gold is what the site says that with. Its frost is drawn by a layer of
       it (`hoa-panel-layered`), because the way to the reader's row
       is a button of the site's glass and a filter on the plate would leave that button sampling the plate.

       `relative z-10` is the plate's place in the page's own ladder, and it is what keeps the legend it carries open
       over the plates *under* it: a surface of the site's glass is a stacking context of its own (`isolation` in
       `app/assets/css/main.css`), so the pane's own `z-50` says nothing against a panel that stands later in the
       document - the panel holding the pane has to be lifted. The ladder reads the way the page is read: the filter
       bar above the plate at `z-20` (its menus open downwards over the plate), the plate at `z-10` (its legend opens
       downwards over the plates below), and every plate of the population at nothing at all. The plate is drawn
       above the table as well, which costs nothing: the two never share a pixel. -->
  <div
    v-if="shows"
    class="hoa-panel hoa-panel-layered hoa-ring-gold relative z-10 grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-6"
  >
    <!-- The first column: who the character is. The portrait in the class colour, the name in it, the two badges that
         say which row of the table below is theirs and which side they play for, and the realm, the class and the
         level under them. -->
    <div class="flex min-w-0 items-center gap-3">
      <span
        class="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full border"
        :style="{ borderColor: `${classHex}66`, backgroundColor: `${classHex}1f` }"
      >
        <span class="text-lg font-extrabold" :style="{ color: classHex }">{{ initial }}</span>
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
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <NuxtLink :to="profileUrl" class="truncate font-bold hover:underline" :style="{ color: classHex }">
            {{ displayName }}
          </NuxtLink>

          <!-- The same mark the table puts on the row this plate stands for: the plate is about the character the
               browser selected, and it says so. -->
          <span
            class="inline-flex shrink-0 items-center rounded border border-wow-gold/60 bg-wow-gold/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-wow-goldLight"
          >{{ t('lbSelectedBadge') }}</span>

          <span
            v-if="faction"
            class="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none"
            :style="{ borderColor: `${faction?.hex}55`, color: faction?.hex }"
          >
            <span class="h-1.5 w-1.5 rounded-full" :style="{ backgroundColor: faction?.hex }" aria-hidden="true"></span>
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

    <!-- The second column, in the middle of the plate and parted from the two halves beside it by a hairline: where
         this character stands. The three places are one reading at three scopes, so they belong together in the
         centre - the one thing a reader who is looking for their own row reads first, and the one thing the table
         below cannot say about itself. -->
    <MetricRankLinks
      class="min-w-0 lg:border-x lg:border-white/10 lg:px-6"
      variant="plate"
      :slug="metric.slug"
      :label="t(metric.labelKey)"
      :region="character.region"
      :realm="character.realm"
      :name="character.name"
      :rank="rank"
      :pending="status === 'pending'"
    />

    <!-- The third column: what they hold for this figure, and the press that walks the table to their row. -->
    <div class="flex items-end justify-between gap-4 lg:justify-end">
      <div class="text-left lg:text-right">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{{ t(metric.labelKey) }}</p>
        <p class="text-3xl font-extrabold leading-tight tabular-nums whitespace-nowrap text-wow-goldLight">
          {{ typeof value === 'number' ? formatNumber(value) : DASH }}
        </p>
      </div>

      <!-- The legend of the overall score, where the figure it explains is the one this plate just printed: the
           front door's own plate is about the rating, so the question belongs beside it. A ranking of the score gets
           the same control from the bar above the table, and no other ranking gets it at all. -->
      <ScoreLegend v-if="legend" />

      <!-- The button is the point of the plate for a reader whose row is far down the ranking: the page turns the
           place into the page of the table that holds it and brings the row into view - the same mechanism a
           `?rank=` link uses (`app/composables/metricLeaderboard.ts`). -->
      <button
        v-if="place"
        type="button"
        class="hoa-tab hoa-liquid-glass px-3 py-1.5 text-xs"
        @click="emit('reveal', place)"
      >{{ t('lbYouReveal') }}</button>
    </div>
  </div>
</template>
