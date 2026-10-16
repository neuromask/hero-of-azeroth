<script setup lang="ts">
/**
 * The character this browser has selected, as one control of a header's corner: who it is, and the press that finds
 * their row of the table the page is drawing.
 *
 * It is the plate the front door and every ranking page used to wear for the same character, cut down to what a
 * reader actually did with it. That plate printed a figure, three places and three links across three columns, and
 * the two things a reader came to it for were these: go to their character, or be shown their row. So they are the
 * two sections of one control, the way the hall of fame's own entry is a tab and a caret - the first who is selected
 * (a portrait in the class colour, the name, the realm, and the word the table below prints for the same row,
 * `lbSelectedBadge`), and the second the press that reads the place this character holds in the ranking being drawn
 * and opens that ranking turned to it.
 *
 * It stands beside the reader's own group in a header's corner - `app/components/HeaderTools.vue`, which holds the
 * language and the account - rather than inside it: a plate of the site's glass of its own, drawn by the header of a
 * page that has a table to be found in (`app/components/SiteHeader.vue`), with the hairline between the two plates
 * saying that they are two. It is the height of that group, and of every other control this row of the site carries,
 * so the corner reads as one row of buttons whether or not this one is there; and its two sections answer the pointer
 * with a flat tint, because the glass they stand on is the plate's and never theirs.
 *
 * It is handed its ranking rather than reading one, and that is also what decides whether it is drawn at all: the
 * pages that draw a table say so (`SiteHeader`'s own `ranking`, which is the hall of fame about the overall rating
 * and every page under `/leaderboards/*` about its own figure and scope), and a page that draws none is a page with
 * no row to offer - so there is no chip in that header, and no hairline standing in front of nothing.
 *
 * The character is the one this browser opened last (`useSearchHistory`, the list the front page's own row reads as
 * well). Everything the first section prints comes from the browser's own record - a name, a realm, a class colour, a
 * portrait - and nothing is asked of the server until the press.
 *
 * The press is the one thing that cannot be written before it is pressed. A place in a ranking is a fact about the
 * table, and the table is the server's: the ranking this page draws is asked about this character
 * (`/api/leaderboard/metric-ranks`, the request the comparison board makes about its two sides), and the answer is
 * the place the address then carries (`?rank=N`, `app/composables/metricLeaderboard`). The scope is the page's own -
 * the world's where the address names no region, the region's where it names no realm, the realm's where it names
 * both - so the press lands on the row of the table the reader is looking at, and not on a place in a narrower or a
 * wider one. A character that table does not hold is left with the ranking itself, because a row that is not there
 * cannot be turned to and the door is still a door.
 */
import { classColorHex } from '#shared/utils/wow-class'
import { searchHistoryKey } from '#shared/utils/savedCharacters'
import type { SearchHistoryEntry } from '#shared/utils/savedCharacters'
import { metricLeaderboardPath, metricLeaderboardRankQuery } from '~/composables/metricLeaderboard'
import { metricLeaderboardOf } from '#shared/data/leaderboardSchema'
import type { MetricLeaderboardRank, MetricLeaderboardTarget } from '#shared/data/leaderboardSchema'

const props = defineProps<{
  /** The character this browser selected, which the corner read out of its own record (`useSearchHistory`). */
  character: SearchHistoryEntry
  /** The ranking the page is drawing, which is the table the press finds this character in. */
  ranking: MetricLeaderboardTarget
}>()

const { t } = useI18n()
const localeUrl = useLocaleUrl()

/** The name as the record spells it, and the realm beside it for the reader who has looked up more than one. */
const displayName = computed(() => props.character.name || '')
const realmName = computed(() => props.character.realmName || props.character.realm || '')

/** The class colour the name is drawn in, off the one table the card, the page and the history share. */
const hex = computed(() => classColorHex({ classId: props.character.classId }))

/** The letter a portrait falls back to, when there is none or the one there is failed. */
const initial = computed(() => displayName.value.charAt(0).toUpperCase())

/** A portrait that failed to load, which the monogram then stands in for. */
const broken = ref(false)

watch(
  () => props.character.name,
  () => {
    broken.value = false
  }
)

/** Their own page, which the first section is: the pair the site addresses a character by, in this language. */
const profileUrl = computed(() =>
  localeUrl(`/${regionPath(props.character.region)}/${props.character.realm}/${props.character.name}`)
)

/** The table the press opens: the page's own ranking, at the page's own scope. */
const path = computed(() =>
  localeUrl(
    metricLeaderboardPath(props.ranking.metric, { region: props.ranking.region, realm: props.ranking.realm })
  )
)

/** The figure's own name, which the press is titled with: what the table it opens ranks. */
const metricLabel = computed(() => {
  const metric = metricLeaderboardOf(props.ranking.metric)
  return metric ? t(metric.labelKey) : ''
})

/** True while the place is being read, which the press says rather than pretending to have moved. */
const finding = ref(false)

/**
 * Finds this character in the table the page is drawing: their place in it is read, and that table opens at it.
 *
 * A failed read is not a dead end. The place is a nicety the address carries and the ranking is what the press
 * promises, so a request that fails - or an answer with no place in it - still opens the table, at the top of it,
 * which is where a reader who pressed "find in the table" about a character that table does not hold belongs.
 */
async function findInTable(): Promise<void> {
  if (finding.value) return

  finding.value = true

  try {
    const answer = await $fetch<{ players: MetricLeaderboardRank[] }>('/api/leaderboard/metric-ranks', {
      query: { metric: props.ranking.metric, players: searchHistoryKey(props.character) },
      // Asked afresh: the endpoint's own cache lets a browser keep a reading for an hour, and a place in a ranking
      // moves the moment anybody's page is rendered.
      headers: { 'cache-control': 'no-cache' }
    })

    const row = answer?.players?.[0] || null
    const place = !props.ranking.region
      ? row?.worldRank
      : !props.ranking.realm
        ? row?.regionRank
        : row?.realmRank

    await navigateTo(place ? { path: path.value, query: metricLeaderboardRankQuery(place) } : path.value)
  } catch {
    await navigateTo(path.value)
  } finally {
    finding.value = false
  }
}
</script>

<template>
  <!-- The plate of the site's own glass, holding two sections: who is selected, and the way into their row of the
       table the page under this header draws. They are two things and the hairline between them is what says so -
       neither draws a rim or a glass of its own, because the plate is what holds them both - and each answers the
       pointer with a flat tint. Its height and its corner are the reader's group's, which it stands beside. -->
  <div class="hoa-plate hidden !h-11 !gap-0 !px-1 lg:inline-flex">
    <!-- The first section: who is selected. Their portrait in the class colour, their name, the realm beside it, and
         the word the table below prints for the same row - this is the character this browser is reading. The whole
         section is their own page, which is what a reader who recognises themselves here wants next. -->
    <NuxtLink
      :to="profileUrl"
      class="flex h-9 min-w-0 items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-white/10"
      :title="`${displayName} — ${t('profileOpen')}`"
    >
      <span
        class="relative grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border"
        :style="{ borderColor: `${hex}66`, backgroundColor: `${hex}1f` }"
        aria-hidden="true"
      >
        <span class="text-[11px] font-extrabold" :style="{ color: hex }">{{ initial }}</span>
        <img
          v-if="character.avatar && !broken"
          :src="character.avatar"
          alt=""
          loading="lazy"
          decoding="async"
          class="absolute inset-0 h-full w-full object-cover"
          @error="broken = true"
        />
      </span>

      <span class="flex min-w-0 flex-col leading-tight">
        <span class="max-w-[9rem] truncate text-xs font-bold" :style="{ color: hex }">{{ displayName }}</span>
        <span class="truncate text-[9px] font-semibold uppercase tracking-wider text-wow-goldLight">
          {{ t('lbSelectedBadge') }}
          <template v-if="realmName"><span class="text-gray-500"> · {{ realmName }}</span></template>
        </span>
      </span>
    </NuxtLink>

    <span class="h-5 w-px shrink-0 self-center bg-white/10" aria-hidden="true" />

    <!-- The second section: the way into their row of the table. It is a press rather than an address, because the
         place the address would carry is the server's to know: it is read on the press and written into the address
         the ranking is opened at (`findInTable`). -->
    <button
      type="button"
      class="h-9 shrink-0 rounded-lg px-2.5 text-xs font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-60 disabled:hover:bg-transparent"
      :disabled="finding"
      :aria-busy="finding"
      :title="`${metricLabel} — ${t('rankOpenTitle')}`"
      @click="findInTable"
    >
      {{ t('lbYouReveal') }}
    </button>
  </div>
</template>
