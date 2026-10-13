<script setup lang="ts">
/**
 * Two characters, their figures side by side.
 *
 * The board is the whole of the comparison page (`app/pages/[region]/[realm]/[name]/vs/`): the character
 * being read stands in the left column and the one it is read against in the right, each under their own
 * card, with the same fifteen figures in the same order below them - so a reader's eye can go down either
 * column and find the same row in the other. It is the figures of the site's other pages read a second way,
 * and nothing here is computed: the score, the collections and the six things a character *does* all arrive
 * on the profile the shell already fetched (`app/composables/characterView.ts`), and the board prints them.
 *
 * The second character is one Blizzard lookup of its own, and it is fetched here - on the server while the
 * address is being rendered, so a shared comparison link opens whole, and again in the browser when another
 * character is picked, because the address changes while this page stays. It is the same endpoint behind a
 * character page and it wears the same account rule (`server/api/character`): a reader who came with an
 * OAuth account is shown the account's own figures and a stranger the character's, which is why every row
 * says which of the two it is printed from.
 *
 * One figure of the fifteen is not on that profile: the appearance sources, the document behind which is
 * 2.5 MB (`server/api/transmog`). It is asked for separately, for both characters at once, and a row that has
 * not been answered yet prints a dash rather than a zero - a wardrobe nobody has read and an empty one are
 * different answers (the rule `app/components/StatDrawer.vue` states for the same reason).
 *
 * Whichever side holds the higher figure is the one the row lights: the winning number wears the green of a
 * gain and the difference it won by rides beside it, so a glance down the board is enough to see who leads
 * and by how much. A row where either side has nothing to print is left alone - a dash is not a loss.
 */
import { formatNumber } from '#shared/utils/formatNumber'
import { classById, DEFAULT_CLASS_HEX } from '#shared/utils/wow-class'
import { useCharacterView } from '~/composables/characterView'
import { searchHistoryKey, type SearchHistoryEntry } from '#shared/utils/savedCharacters'
import { useSearchHistory } from '~/composables/searchHistory'
import { useVersusFavorites } from '~/composables/versusFavorites'
import type { CharacterData } from '~~/server/utils/blizzard'

/** The second character of a comparison: the three segments of its own address, as the address spells them. */
interface VersusTarget {
  region: string
  realm: string
  name: string
}

const props = defineProps<{
  /** This character's own `/vs` address, in the language being read: where a second character is appended. */
  vsBase: string
  /** The character to read this one against, or `null` while none has been picked. */
  target?: VersusTarget | null
}>()

const { t } = useI18n()
const localeUrl = useLocaleUrl()
const {
  character,
  region,
  realm,
  name,
  apiLocale,
  refreshProfile,
  refreshing: profileRefreshing,
  cooldown: profileCooldown,
  canRefresh: canRefreshProfile
} = useCharacterView()

/**
 * The second character's profile, read from the endpoint behind a character page.
 *
 * The key names the character and the language, so picking another one is another read rather than the same
 * one re-served - and it is a `computed`, which is what makes Nuxt refetch on its own when the address
 * changes under a page that is not rebuilt (`useAsyncData` watches a reactive key). With nobody picked yet
 * the handler answers `null` without asking anybody.
 */
const targetKey = computed(() =>
  props.target
    ? `versus:${props.target.region}:${props.target.realm}:${props.target.name.toLowerCase()}:${apiLocale.value}`
    : 'versus:none'
)

const targetUrl = computed(() =>
  props.target
    ? `/api/character/${props.target.region}/${props.target.realm}/${encodeURIComponent(props.target.name)}?locale=${apiLocale.value}`
    : null
)

const {
  data: targetCharacter,
  pending: targetPending,
  error: targetError,
  refresh: reloadTarget
} = await useAsyncData(
  targetKey,
  () => (targetUrl.value ? $fetch<CharacterData>(targetUrl.value) : Promise.resolve(null)),
  { default: () => null }
)

// The read of the second character is a wait of the site's, the way the shell's own read of the first is:
// the address has changed and this page is on screen, so the wheel says the site is still working on it.
const loading = usePageLoading()
loading.follow('character:versus', targetPending)

/**
 * The appearance sources, which no profile carries: `undefined` while the reading is on its way, `null` when
 * it failed, a number once it lands - the three states `StatDrawer.vue` keeps for the same figure. They are
 * held per character, keyed the way the browser keys a character (`searchHistoryKey`), so the two columns
 * can each ask for their own and neither can be answered with the other's number.
 */
const wardrobes = ref<Record<string, number | null | undefined>>({})

const currentWardrobeKey = computed(() => searchHistoryKey({ region, realm, name }))
const targetWardrobeKey = computed(() => (props.target ? searchHistoryKey(props.target) : ''))

const currentWardrobe = computed(() => wardrobes.value[currentWardrobeKey.value])
const targetWardrobe = computed(() => (props.target ? wardrobes.value[targetWardrobeKey.value] : undefined))

/** Reads one character's wardrobe once, from the endpoint that keeps the 2.5 MB document off the profile. */
async function askWardrobe(key: string, forRegion: string, forRealm: string, forName: string) {
  if (!key || wardrobes.value[key] !== undefined) return

  try {
    const answer = await $fetch<{ count: number | null }>(
      `/api/transmog/${forRegion}/${forRealm}/${encodeURIComponent(forName)}`
    )
    wardrobes.value = { ...wardrobes.value, [key]: answer?.count ?? null }
  } catch {
    wardrobes.value = { ...wardrobes.value, [key]: null }
  }
}

/**
 * Asks for both sides' wardrobes: a character's own, and the one they are read against. It runs in the
 * browser rather than while the page is being rendered, which is the rule `StatDrawer.vue` keeps the same
 * document behind: 2.5 MB a character is not something the first frame of a page pays for, so a deep link
 * opens with the two rows beating a dash and they fill in a moment later. Another character picked later is
 * another reading; one already taken is left alone.
 */
function askWardrobes() {
  void askWardrobe(currentWardrobeKey.value, region, realm, name)
  if (props.target) void askWardrobe(targetWardrobeKey.value, props.target.region, props.target.realm, props.target.name)
}

onMounted(askWardrobes)
watch([currentWardrobeKey, targetWardrobeKey], askWardrobes)
/** One figure of a column, as it is printed: the number, and whose number it is. */
interface VersusFigure {
  /** The message key of its name - the very labels the tiles of a character page print. */
  label: string
  /** The glyph the set draws for it, by file name (`app/assets/icons`, read by `AppIcon`). */
  icon: string
  /** The figure, or `null` for one that is not there to print (which is drawn as a dash, never a zero). */
  value: number | null
  /** Whether the figure is the account's own, which the row says under its label. */
  accountWide: boolean
}

/** One row of the board: a figure, and the same figure read for the other character. */
interface VersusRow extends VersusFigure {
  key: string
  target: VersusFigure
}

/**
 * The fifteen figures of one character, in the order the board reads them - the site's score first, then the
 * collections a player looks at, then the things a character has *done*.
 *
 * Whose figure each one is follows the two rules the site already prints its tiles by
 * (`app/pages/[region]/[realm]/[name]/index.vue` and `app/components/StatDrawer.vue`), and it is read off the
 * profile rather than decided here: the collections Blizzard keeps for an account - toys, pets, decor and the
 * achievement points - are the account's even for a stranger, mounts and reputations are the account's only
 * where the pool answered them (`pooled`), and the figures a character earns - titles, quests, recipes, kills -
 * say so themselves through their own `accountWide`. A wardrobe and an honor level belong to the account by
 * the game's own design, so both always say the account's.
 */
function metricsFor(character: CharacterData | null, wardrobe: number | null | undefined): VersusFigure[] {
  const stats = character?.stats
  const count = (value?: { count?: number } | null) => (typeof value?.count === 'number' ? value.count : null)
  const figure = (value?: number | null) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

  return [
    { label: 'lbColScore', icon: 'trophy', value: character ? figure(character.score) : null, accountWide: !!character?.pooled },
    { label: 'achievements', icon: 'achievments', value: count(stats?.achievements), accountWide: true },
    { label: 'mounts', icon: 'mounts', value: count(stats?.mounts), accountWide: !!character?.pooled },
    { label: 'toys', icon: 'toys', value: count(stats?.toys), accountWide: true },
    { label: 'pets', icon: 'pets', value: count(stats?.pets), accountWide: true },
    { label: 'decor', icon: 'decor', value: count(stats?.decor), accountWide: true },
    { label: 'titles', icon: 'titles', value: count(stats?.titles), accountWide: !!stats?.titles?.accountWide },
    { label: 'itemLevel', icon: 'item-level', value: character ? figure(character.ilvl) : null, accountWide: false },
    { label: 'mPlus', icon: 'key', value: character ? figure(character.mPlusScore) : null, accountWide: false },
    { label: 'reputations', icon: 'exalted-rep', value: count(stats?.reputations), accountWide: !!character?.pooled },
    // The one figure that arrives from an endpoint of its own: `undefined` while it is being read.
    { label: 'transmogs', icon: 'transmogs', value: typeof wardrobe === 'number' ? wardrobe : null, accountWide: true },
    { label: 'quests', icon: 'quests', value: count(stats?.quests), accountWide: !!stats?.quests?.accountWide },
    { label: 'recipes', icon: 'recipes', value: count(stats?.recipes), accountWide: !!stats?.recipes?.accountWide },
    { label: 'honorableKills', icon: 'kills', value: count(stats?.honorableKills), accountWide: !!stats?.honorableKills?.accountWide },
    { label: 'honorLevel', icon: 'honorLevel', value: count(stats?.honorLevel), accountWide: true }
  ]
}

/**
 * The board itself: each of the first character's figures with the second character's figure put beside it -
 * one list walked twice, so the two columns can never fall out of step.
 */
const comparison = computed<VersusRow[]>(() => {
  const left = metricsFor(character.value, currentWardrobe.value)
  const right = metricsFor(targetCharacter.value, targetWardrobe.value)

  return left.map((figure, index) => ({ key: figure.label, ...figure, target: right[index]! }))
})

/** Whether the row has two figures to compare at all: a dash beside a number is not a comparison. */
function isComparable(row: VersusRow): boolean {
  return typeof row.value === 'number' && typeof row.target.value === 'number' && row.value !== row.target.value
}

/** Which side leads the row, or `null` when there is nothing to lead with. */
function winnerOf(row: VersusRow): 'current' | 'target' | null {
  if (!isComparable(row)) return null
  return (row.value as number) > (row.target.value as number) ? 'current' : 'target'
}

/** What the leading side won by, which is the `+X` the row prints beside the winning figure. */
function marginOf(row: VersusRow): number | null {
  if (!isComparable(row)) return null
  return Math.abs((row.value as number) - (row.target.value as number))
}

/** A figure as the site prints one: the grouped number, and a dash where nothing has been read. */
function print(value: number | null): string {
  return typeof value === 'number' ? formatNumber(value) : '—'
}

/** The colour the winning figure wears: the green of a gain, with a breath of glow around it. */
const WINNER_TEXT = 'text-emerald-300 [text-shadow:0_0_14px_rgba(52,211,153,0.55)]'

/**
 * The characters this browser has saved for a quick comparison, offered under the search as one press each.
 * The list is filled in the browser (`localStorage`), so it is drawn only once it is there.
 */
const { favorites, load: loadFavorites, has: isFavorite, toggle: toggleFavorite } = useVersusFavorites()

onMounted(() => loadFavorites())

/** Where a saved character's chip leads: straight to this board with that character in it. */
function favoriteUrl(favorite: SearchHistoryEntry): string {
  return `${props.vsBase}/${favorite.region}/${favorite.realm}/${favorite.name}`
}

/** A portrait that failed to load, so a card draws the monogram instead of a broken picture. */
const brokenPortraits = ref<Record<string, boolean>>({})

/** The colour a name is drawn in: its class's own, the way every name on the site is tinted. */
function hexOf(character: CharacterData | null): string {
  return classById(character?.classId ?? 0)?.hex || DEFAULT_CLASS_HEX
}

/** One pill of an identity row: a scrap of what a character is, and the plate it is read in. */
interface MetaPill {
  text: string
  /** The plate the pill wears - the header's amber, or the slate the class part stands on. */
  badge: string
  /** The spec-and-class part, printed in the class's own colour (see `<CharacterName>`). */
  isClass?: boolean
}

/**
 * The plate of the pills that stand beside a portrait: the amber the meta line of a character's own header
 * is read in (`app/pages/[region]/[realm]/[name].vue`), a step smaller - a column of the board is narrower
 * than a bar across a page, and these stand beside a fifty-six pixel portrait rather than in a bar of their
 * own. They carry no blur of their own: both cards are read on the site's glass, where a `backdrop-filter`
 * could only sample that glass (`app/assets/css/main.css`).
 */
const META_BADGE = 'inline-flex max-w-full items-center rounded-md border border-amber-500/50 bg-amber-950/20 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.2)]'

/** The same plate for the class part, which stands on slate and is written in the colour of the class. */
const META_CLASS_BADGE = 'inline-flex max-w-full items-center rounded-md border border-amber-500/50 bg-slate-950/40 px-2 py-0.5 text-[11px] font-semibold leading-none'

/**
 * What a character is, as the pills a card reads beside their portrait: the level, the race and the
 * spec-and-class over the guild and the realm. It is the meta line of the character's own page (`metaParts`,
 * `app/pages/[region]/[realm]/[name].vue`) kept as two rows rather than as one wrapping line, because five
 * pills in a row do not fit a column of the board while the pair of rows does - and two rows of them stay
 * inside the height of the portrait they stand beside, which is what keeps the two cards' rows level. A part
 * with nothing to print is left out rather than drawn empty.
 */
function metaRowsOf(character: CharacterData | null): MetaPill[][] {
  if (!character) return []

  return [
    [
      { text: character.level ? String(character.level) : '', badge: META_BADGE },
      { text: character.race, badge: META_BADGE },
      // The spec and the class, printed in the class's signature colour (see <CharacterName>).
      { text: `${character.spec} ${character.class}`.trim(), badge: META_CLASS_BADGE, isClass: true }
    ],
    [
      { text: character.guild ? `<${character.guild}>` : '', badge: META_BADGE },
      { text: character.realm, badge: META_BADGE }
    ]
  ].map((row) => row.filter((part) => part.text))
}

/** The pills of each card's portrait, in their two rows. */
const currentMeta = computed(() => metaRowsOf(character.value))
const targetMeta = computed(() => metaRowsOf(targetCharacter.value))

/** Where a card's name leads: the character's own page, in the language being read. */
function characterUrl(forRegion: string, forRealm: string, forName: string): string {
  return localeUrl(`/${regionPath(forRegion)}/${forRealm}/${forName}`)
}

/** Whether one side's wardrobe is still on its way, which is what the row beats a dash for. */
function isReadingWardrobe(side: 'current' | 'target'): boolean {
  return side === 'current' ? currentWardrobe.value === undefined : targetWardrobe.value === undefined
}

/**
 * The second character as the browser remembers a character, which is the shape the star saves: the address
 * it was reached by, the realm and the name the profile spells, and the face a chip draws.
 */
const targetEntry = computed<SearchHistoryEntry | null>(() => {
  const target = props.target
  const value = targetCharacter.value
  if (!target || !value) return null

  return {
    name: value.name || target.name,
    realm: target.realm,
    region: target.region === 'us' ? 'us' : 'eu',
    realmName: value.realm || target.realm,
    classId: value.classId,
    class: value.class,
    avatar: value.avatarUrl
  }
})

/**
 * A comparison that found its second character is a success, and the successes are what the list under a search
 * field is made of (`app/composables/searchHistory.ts`). A character's own page records its own read
 * (`app/pages/[region]/[realm]/[name].vue`), but the second character of a comparison is read here and is never
 * opened as a page of its own - so without this line the list would never hold them, and a character found by
 * the very field that offers the list would be missing from it. What is written is the entry the star saves
 * (`targetEntry`), which is the shape the list is kept in. A read that found nobody leaves the list alone, so a
 * mistyped name never reaches it, and a character read again by the Refresh button is simply put back at the
 * front of it.
 */
const { remember: rememberCharacter } = useSearchHistory()

watch(targetEntry, (entry) => {
  // `localStorage` exists in the browser alone, and the server has no history to write to.
  if (!import.meta.client || !entry) return
  rememberCharacter(entry)
}, { immediate: true })

/** Where the second card's name leads: their own page, or this board while nobody has been picked. */
const targetAddress = computed(() => {
  const target = props.target
  return target ? characterUrl(target.region, target.realm, target.name) : props.vsBase
})

/** Whether the second character is already saved for a quick compare. */
const targetSaved = computed(() => (targetEntry.value ? isFavorite(targetEntry.value) : false))

/** What the star does: saves the second character, or drops the one already saved. */
function toggleTargetFavorite() {
  if (targetEntry.value) toggleFavorite(targetEntry.value)
}

/** The `+X` the leading side won by, or nothing at all when the row has no winner to announce. */
function marginLabel(row: VersusRow): string {
  const margin = marginOf(row)
  return margin === null ? '' : `+${formatNumber(margin)}`
}

/**
 * The first character as the browser remembers a character, which is the shape their star saves: the three
 * segments of the address this page stands at, and the face and the class a chip draws them with. The second
 * character's entry is built the same way beside it (`targetEntry`), so the two stars save the same thing.
 */
const currentEntry = computed<SearchHistoryEntry | null>(() => {
  const value = character.value
  if (!value) return null

  return {
    name: value.name || name,
    realm,
    region: region === 'us' ? 'us' : 'eu',
    realmName: value.realm || realm,
    classId: value.classId,
    class: value.class,
    avatar: value.avatarUrl
  }
})

/** Whether the first character is already saved for a quick compare. */
const currentSaved = computed(() => (currentEntry.value ? isFavorite(currentEntry.value) : false))

/** What the first card's star does: saves this character, or drops the one already saved. */
function toggleCurrentFavorite() {
  if (currentEntry.value) toggleFavorite(currentEntry.value)
}

/** The second character's own refresh state: the shell's cooldown knows only the first character. */
const targetRefreshing = ref(false)
const targetCooldown = ref(0)
let targetCooldownTimer: ReturnType<typeof setInterval> | undefined

/** Whether the second character's figures may be read again right now. */
const canRefreshTarget = computed(() => !targetRefreshing.value && targetCooldown.value === 0)

/**
 * What a refresh button says while it is not simply an invitation: the wait, or the seconds left of the
 * minute. Both cards say it the way the header's own button does, because it is the same act on two
 * characters - one through the shell (`refreshProfile`), one through this board (`refreshTarget`).
 */
const currentRefreshHint = computed(() => {
  if (profileRefreshing.value) return t('refreshingProfile')
  if (profileCooldown.value > 0) return `${profileCooldown.value}s`
  return t('refreshProfile')
})

const targetRefreshHint = computed(() => {
  if (targetRefreshing.value) return t('refreshingProfile')
  if (targetCooldown.value > 0) return `${targetCooldown.value}s`
  return t('refreshProfile')
})

/**
 * Starts the minute the header's own refresh also starts (`app/pages/[region]/[realm]/[name].vue`): the budget
 * is spent per character (`server/utils/refreshBudget`), so the two buttons cool down together rather than one
 * being pressable a moment after the other.
 */
function startTargetCooldown() {
  targetCooldown.value = 60
  if (targetCooldownTimer) clearInterval(targetCooldownTimer)
  targetCooldownTimer = setInterval(() => {
    targetCooldown.value -= 1
    if (targetCooldown.value <= 0) {
      if (targetCooldownTimer) clearInterval(targetCooldownTimer)
      targetCooldownTimer = undefined
      targetCooldown.value = 0
    }
  }, 1000)
}

/**
 * Re-reads the second character from Blizzard - the `?force=true` the header's button sends for the first.
 * A refusal (the refresh budget, a Blizzard failure) leaves the figures on screen as they are: there is
 * nothing newer to draw, and the cooldown is started anyway, so the next press does not spend it again on
 * the same answer.
 */
async function refreshTarget() {
  const target = props.target
  if (!target || !canRefreshTarget.value) return

  targetRefreshing.value = true
  try {
    const fresh = await $fetch<CharacterData>(
      `/api/character/${target.region}/${target.realm}/${encodeURIComponent(target.name)}?locale=${apiLocale.value}&force=true`
    )
    targetCharacter.value = fresh
  } catch {
    // Nothing newer to show: the figures stand.
  } finally {
    targetRefreshing.value = false
    startTargetCooldown()
  }
}

onBeforeUnmount(() => {
  if (targetCooldownTimer) clearInterval(targetCooldownTimer)
})
</script>

<template>
  <!-- The board: two columns of glass, the character being read on the left and the one it is read against on
       the right, each under its own card with the same fifteen figures below it. On a phone the two stack -
       the figures of the first character, then the second's - because a row of two half-width columns cannot
       hold a label, a badge and a number. -->
  <main class="relative z-20 container mx-auto flex-1 px-4 py-6">
    <div class="grid items-start gap-4 lg:grid-cols-2">
      <!-- The character the page is about. The shell has already fetched them, so this column is whole on the
           first frame and never waits for anything. -->
      <section class="hoa-panel rounded-2xl p-4 sm:p-5">
        <p class="mb-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {{ $t('navCharacterGroup') }}
        </p>

        <div v-if="character">
          <!-- The identity of the card, read the way the header of a character's own page reads it
               (`app/pages/[region]/[realm]/[name].vue`): the name, and the title they carry beside it in the
               brand gold and in italics, because that is what a title is. The hairline under the pair is the
               brand colour running out into the page - the same line the activity feed draws down its own
               timeline (`app/components/ActivityFeed.vue`) - which is what parts the name from what the card
               goes on to say about them. -->
          <div class="flex items-center gap-2">
            <NuxtLink
              :to="characterUrl(region, realm, name)"
              class="min-w-0 truncate text-lg font-extrabold transition-opacity hover:opacity-80"
              :style="{ color: hexOf(character) }"
            >{{ character.name }}</NuxtLink>
            <span
              v-if="character.title"
              class="min-w-0 truncate text-sm font-normal italic text-wow-goldLight"
            >{{ character.title }}</span>
          </div>

          <div class="mt-2.5 h-px bg-gradient-to-r from-wow-gold/50 via-white/15 to-transparent" aria-hidden="true" />

          <div class="mt-3 flex items-center gap-3">
            <span
              class="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border"
              :style="{ borderColor: `${hexOf(character)}66`, backgroundColor: `${hexOf(character)}1f` }"
            >
              <span class="text-lg font-extrabold" :style="{ color: hexOf(character) }">
                {{ character.name.charAt(0).toUpperCase() }}
              </span>
              <img
                v-if="character.avatarUrl && !brokenPortraits[name]"
                :src="character.avatarUrl"
                :alt="character.name"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 h-full w-full object-cover"
                @error="brokenPortraits = { ...brokenPortraits, [name]: true }"
              />
            </span>

            <!-- What the character is, beside their face: the pills the character's own header reads its meta
                 line in (`metaRowsOf` above), in the two rows that fit a column of the board. The class's plate
                 is the site's own - `<CharacterName>` is what holds the colour a class is drawn in - and only
                 its frame is the smaller one a card wears. -->
            <div v-if="currentMeta.length" class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                v-for="(row, rowIndex) in currentMeta"
                :key="rowIndex"
                class="flex min-w-0 flex-wrap items-center gap-1.5"
              >
                <template v-for="part in row" :key="part.text">
                  <span v-if="!part.isClass" :class="part.badge">{{ part.text }}</span>
                  <span v-else :class="part.badge">
                    <CharacterName :class-id="character.classId" :class-name="character.class">{{ part.text }}</CharacterName>
                  </span>
                </template>
              </div>
            </div>

            <!-- The same pair of buttons the second card carries, on the character being read: either side of a
                 comparison can be saved for the next one, and either side can be read again from Blizzard. -->
            <CharacterCardActions
              :saved="currentSaved"
              :refreshable="canRefreshProfile"
              :refreshing="profileRefreshing"
              :refresh-hint="currentRefreshHint"
              :updated-at="character.fetchedAt"
              @toggle="toggleCurrentFavorite()"
              @refresh="refreshProfile()"
            />
          </div>
        </div>

        <!-- The shell's read has not landed yet - a shared link still being answered. The room is kept so the
             column does not jump when the card arrives. -->
        <div v-else class="h-14 animate-pulse rounded-xl bg-white/[0.04]" />

        <ul class="mt-4 space-y-1.5">
          <li
            v-for="row in comparison"
            :key="row.key"
            class="flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors"
            :class="winnerOf(row) === 'current' ? 'border-emerald-400/30 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.03]'"
          >
            <AppIcon :name="row.icon" class="h-6 w-6 shrink-0 text-gray-400" />

            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs font-semibold uppercase tracking-wider text-gray-300">
                {{ $t(row.label) }}
              </span>
              <span
                class="block text-[10px] font-semibold uppercase tracking-wider"
                :class="row.accountWide ? 'text-wow-goldLight/80' : 'text-gray-500'"
              >{{ row.accountWide ? $t('accountWide') : $t('perCharacter') }}</span>
            </span>

            <span class="shrink-0 whitespace-nowrap text-right">
              <span
                class="text-lg font-extrabold leading-none tabular-nums"
                :class="[
                  winnerOf(row) === 'current' ? WINNER_TEXT : 'text-white',
                  row.label === 'transmogs' && isReadingWardrobe('current') ? 'animate-pulse text-gray-500' : ''
                ]"
              >{{ print(row.value) }}</span>
              <span
                v-if="winnerOf(row) === 'current' && marginLabel(row)"
                class="ml-1 align-middle text-[11px] font-bold text-emerald-400"
              >{{ marginLabel(row) }}</span>
            </span>
          </li>
        </ul>
      </section>

      <!-- The character to read this one against. Until one is picked, this column *is* the search that finds
           one - the same two fields the front door and a page's own row carry, asked to open a comparison
           rather than a character's own page (`target="versus"`), followed by the characters this browser has
           saved for a quick compare. -->
      <section class="hoa-panel rounded-2xl p-4 sm:p-5">
        <!-- The heading of the column, with the way off the comparison in its corner. The cross is taken out
             of the flow (`absolute`): a control of thirty-six pixels would otherwise stand taller than the
             11px label beside it and push the whole column down, and the two cards of the board have to begin
             their rows at the same height. Its corner is `top-0 right-0` of this heading, which is the inner
             edge the card's own padding draws (`p-4 sm:p-5`), so the square stands as far from the top of the
             card as it does from its side - the same measure on both, at every width - and it reads as set
             into the corner rather than dropped onto the label. It is the board with nobody in this column -
             the address the search below picks another character on - and its square and its glass are the
             pair of buttons each character's card carries (`app/components/CharacterCardActions.vue`). It is
             here in every state the column has, so a read still on its way or one that failed can be left by
             the same corner as a finished one. -->
        <div class="relative mb-3">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {{ $t('vsSecondTitle') }}
          </p>

          <NuxtLink
            v-if="target"
            :to="vsBase"
            class="absolute right-0 top-0 grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/10 text-gray-300 transition-colors hover:border-white/30 hover:bg-white/15 hover:text-white"
            :aria-label="$t('vsRemove')"
            :title="$t('vsRemove')"
          >
            <svg
              class="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </NuxtLink>
        </div>

        <!-- Nobody picked yet: the search, and the saved characters as one press each. -->
        <template v-if="!target">
          <h2 class="text-base font-bold text-white">{{ $t('vsPickTitle') }}</h2>
          <p class="mt-0.5 text-xs leading-relaxed text-gray-400">{{ $t('vsPickHint') }}</p>

          <CharacterSearchForm class="mt-4" target="versus" :vs-base="vsBase" autofocus />

          <!-- The favorites: the shape the search field's own list offers them in, under the heading the site
               now calls them by ("Favorites", `i18n/locales`). They are in `localStorage`, so they are drawn
               only once the browser has read them - a page rendered on the server shows none and gains them a
               moment later. -->
          <div v-if="favorites.length" class="mt-5 border-t border-white/10 pt-4">
            <p class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{{ $t('vsFavorites') }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <NuxtLink
                v-for="favorite in favorites"
                :key="searchHistoryKey(favorite)"
                :to="favoriteUrl(favorite)"
                class="hoa-tag transition-colors hover:bg-white/15"
              >
                <CharacterName :class-id="favorite.classId" :class-name="favorite.class">{{ favorite.name }}</CharacterName>
                <span class="text-gray-400">· {{ favorite.realmName }}</span>
              </NuxtLink>
            </div>
          </div>
        </template>

        <!-- Picked, and the read is still on its way. -->
        <template v-else-if="targetPending && !targetCharacter">
          <div class="h-14 animate-pulse rounded-xl bg-white/[0.04]" />
          <p class="mt-3 text-center text-xs text-gray-400">{{ $t('loading') }}</p>
        </template>

        <!-- Picked, and the read answered with nothing: a character Blizzard does not know, an API failure. The
             search stays where it is, so another name can be tried without leaving the board. -->
        <template v-else-if="!targetCharacter">
          <p class="text-sm font-semibold text-red-400">{{ $t('vsError') }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" class="hoa-tab hoa-tab-active" @click="reloadTarget()">{{ $t('vsRetry') }}</button>
          </div>
          <CharacterSearchForm class="mt-5" target="versus" :vs-base="vsBase" />
        </template>

        <!-- Both characters on screen: the second card, the star that saves them, and their figures. -->
        <template v-else>
          <!-- The identity line the first card carries, read the same way here: the name of the character
               compared, and the title they carry beside it in the brand gold and in italics. -->
          <div class="flex items-center gap-2">
            <NuxtLink
              :to="targetAddress"
              class="min-w-0 truncate text-lg font-extrabold transition-opacity hover:opacity-80"
              :style="{ color: hexOf(targetCharacter) }"
            >{{ targetCharacter.name }}</NuxtLink>
            <span
              v-if="targetCharacter.title"
              class="min-w-0 truncate text-sm font-normal italic text-wow-goldLight"
            >{{ targetCharacter.title }}</span>
          </div>

          <div class="mt-2.5 h-px bg-gradient-to-r from-wow-gold/50 via-white/15 to-transparent" aria-hidden="true" />

          <div class="mt-3 flex items-center gap-3">
            <span
              class="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border"
              :style="{ borderColor: `${hexOf(targetCharacter)}66`, backgroundColor: `${hexOf(targetCharacter)}1f` }"
            >
              <span class="text-lg font-extrabold" :style="{ color: hexOf(targetCharacter) }">
                {{ targetCharacter.name.charAt(0).toUpperCase() }}
              </span>
              <img
                v-if="targetCharacter.avatarUrl && !brokenPortraits[targetWardrobeKey]"
                :src="targetCharacter.avatarUrl"
                :alt="targetCharacter.name"
                loading="lazy"
                decoding="async"
                class="absolute inset-0 h-full w-full object-cover"
                @error="brokenPortraits = { ...brokenPortraits, [targetWardrobeKey]: true }"
              />
            </span>

            <!-- The same pills the first card carries, read the same way: what the character compared is over
                 who they run with and where they play. -->
            <div v-if="targetMeta.length" class="flex min-w-0 flex-1 flex-col gap-1.5">
              <div
                v-for="(row, rowIndex) in targetMeta"
                :key="rowIndex"
                class="flex min-w-0 flex-wrap items-center gap-1.5"
              >
                <template v-for="part in row" :key="part.text">
                  <span v-if="!part.isClass" :class="part.badge">{{ part.text }}</span>
                  <span v-else :class="part.badge">
                    <CharacterName :class-id="targetCharacter.classId" :class-name="targetCharacter.class">{{ part.text }}</CharacterName>
                  </span>
                </template>
              </div>
            </div>

            <!-- The same pair of buttons the first card carries: the star that saves this character for a
                 quick compare, and the refresh that reads them from Blizzard again. -->
            <CharacterCardActions
              :saved="targetSaved"
              :refreshable="canRefreshTarget"
              :refreshing="targetRefreshing"
              :refresh-hint="targetRefreshHint"
              :updated-at="targetCharacter.fetchedAt"
              @toggle="toggleTargetFavorite()"
              @refresh="refreshTarget()"
            />
          </div>

          <ul class="mt-4 space-y-1.5">
            <li
              v-for="row in comparison"
              :key="row.key"
              class="flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors"
              :class="winnerOf(row) === 'target' ? 'border-emerald-400/30 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.03]'"
            >
              <AppIcon :name="row.icon" class="h-6 w-6 shrink-0 text-gray-400" />

              <span class="min-w-0 flex-1">
                <span class="block truncate text-xs font-semibold uppercase tracking-wider text-gray-300">
                  {{ $t(row.label) }}
                </span>
                <span
                  class="block text-[10px] font-semibold uppercase tracking-wider"
                  :class="row.target.accountWide ? 'text-wow-goldLight/80' : 'text-gray-500'"
                >{{ row.target.accountWide ? $t('accountWide') : $t('perCharacter') }}</span>
              </span>

              <span class="shrink-0 whitespace-nowrap text-right">
                <span
                  class="text-lg font-extrabold leading-none tabular-nums"
                  :class="[
                    winnerOf(row) === 'target' ? WINNER_TEXT : 'text-white',
                    row.label === 'transmogs' && isReadingWardrobe('target') ? 'animate-pulse text-gray-500' : ''
                  ]"
                >{{ print(row.target.value) }}</span>
                <span
                  v-if="winnerOf(row) === 'target' && marginLabel(row)"
                  class="ml-1 align-middle text-[11px] font-bold text-emerald-400"
                >{{ marginLabel(row) }}</span>
              </span>
            </li>
          </ul>
        </template>
      </section>
    </div>
  </main>
</template>

