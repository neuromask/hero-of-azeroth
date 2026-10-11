<script setup lang="ts">
/**
 * The note under the main's figures: what each of them is, where it comes from, and what the site does with it.
 *
 * The page prints nine numbers and explains none of them. A reader who has just signed in meets a rating in gold
 * and eight figures beside it, and the questions that follow are the same for everybody: is this the character or
 * the account, is it the game's number or the site's, why does a shelf hold fewer mounts than the journal, and
 * who else can see any of it. Every one of those questions has an answer written down somewhere on the site - the
 * note under a collection shelf, the legend beside the hall of fame's filters, the account settings - and none of
 * it is anywhere near the numbers a reader is standing in front of.
 *
 * So this is that answer, in one block, under the figures it is about: six cells, each a glyph, a claim and a
 * paragraph - read from Blizzard, counted against the whole game, the account's or the character's, the site's own
 * score, how the reading is kept and how quickly a page opens, and what others see. Written as prose rather than
 * as a table of labels, because these are the questions a reader arrives with rather than a reference to skim.
 *
 * It stands folded away behind its own title, which is a button: the figures are what a reader came for, and this
 * is a page of reading behind them. The collections pages fold their legend away the same way, with the same
 * arrow and the same gold question mark (`CollectionShelf.vue`), so the two notes read as one habit of the site -
 * and a reader who never opens either loses nothing but the reading.
 *
 * Nothing here is computed and no figure is repeated, because a second place that says what a number is is a
 * second place that can disagree with it: the numbers live in one page (`app/pages/profile.vue`) and are built by
 * one endpoint (`server/api/profile/index.get.ts`). The note explains them, and the words it uses are keys like
 * every other label of the site, so the whole block reads in the language of the page.
 */
const { t } = useI18n()

/** Whether the reading behind the title is open, which is a reader's own choice every time they land here. */
const open = ref(false)

/**
 * The six things a reader is owed, as one list so the template stays a `v-for`, and with the i18n keys written out
 * rather than assembled from the keys above them: a key spelled in full is a key a search finds and a reviewer
 * can read, and a missing one is visible here rather than in a browser.
 */
const notes = computed(() => [
  {
    key: 'blizzard',
    icon: 'battlenet',
    title: t('profileStatsNoteBlizzardTitle'),
    body: t('profileStatsNoteBlizzardBody')
  },
  {
    key: 'catalogue',
    icon: 'mounts',
    title: t('profileStatsNoteCatalogueTitle'),
    body: t('profileStatsNoteCatalogueBody')
  },
  {
    key: 'scope',
    icon: 'user',
    title: t('profileStatsNoteScopeTitle'),
    body: t('profileStatsNoteScopeBody')
  },
  {
    key: 'score',
    icon: 'trophy',
    title: t('profileStatsNoteScoreTitle'),
    body: t('profileStatsNoteScoreBody')
  },
  {
    key: 'fresh',
    icon: 'refresh',
    title: t('profileStatsNoteFreshTitle'),
    body: t('profileStatsNoteFreshBody')
  },
  {
    key: 'public',
    icon: 'hoa-emblem',
    title: t('profileStatsNotePublicTitle'),
    body: t('profileStatsNotePublicBody')
  }
])
</script>

<template>
  <!-- A hairline separates the note from the figures it belongs to, the way the stat line is separated from the head
       above it - so the block reads as the footnote of this card rather than as another panel on the page. -->
  <div class="border-t border-white/[0.06] pt-4">
    <!-- The title as the button that opens the reading: WoW's own question mark, the claim beside it, and the
         arrow every fold-out on the site wears - the collections legend's own control, drawn in the same words
         (`CollectionShelf.vue`). The whole row answers the pointer and the keyboard. -->
    <button
      type="button"
      class="flex w-full items-center gap-2.5 text-left outline-none transition-colors hover:text-wow-goldLight focus-visible:text-wow-goldLight"
      aria-controls="profile-stats-note"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        class="h-4 w-4 shrink-0 text-wow-gold"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
      </svg>

      <span class="min-w-0 text-sm font-bold text-white sm:text-base">{{ t('profileStatsNoteTitle') }}</span>

      <svg
        class="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200"
        :class="{ 'rotate-180': open }"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <div v-if="open" id="profile-stats-note">
      <p class="mt-2 text-xs leading-relaxed text-gray-400 sm:text-[13px]">{{ t('profileStatsNoteLead') }}</p>

      <!-- The cells: the same hairline-and-wash block the figures above are drawn in, three to a row where the
           window is wide enough - so the note reads as the panel's own footnote and not as a second panel. -->
      <dl class="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="note in notes"
          :key="note.key"
          class="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3.5 transition-colors hover:border-white/10 hover:bg-white/[0.05]"
        >
          <dt class="flex items-start gap-2 text-[13px] font-bold uppercase tracking-wide text-gray-300">
            <AppIcon :name="note.icon" class="mt-px h-4 w-4 shrink-0 opacity-80" />
            <span>{{ note.title }}</span>
          </dt>
          <dd class="mt-1.5 text-[13px] leading-relaxed text-gray-400">{{ note.body }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>
