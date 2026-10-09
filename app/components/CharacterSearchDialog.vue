<script setup lang="ts">
/**
 * The way into the search from a page that is not the front door: a button in a page's row, and the
 * two fields it opens.
 *
 * The hall of fame is a table of the characters the site has already rendered, so the one thing a
 * reader can want from it that the page does not offer is a character that is not in it yet. This is
 * that button: it stands in the header where a page's own controls stand, and it opens the very form
 * the front page's card carries (`CharacterSearchForm`) - the same realm list, the same remembered
 * characters, the same progress - so adding somebody is looking them up, which is the act that reads
 * their profile and writes their row.
 *
 * It is a button of a page's own row - the row the hall of fame keeps its tabs and its collections
 * menu in - rather than a control beside the identity chip on the right: a second bar-shaped button
 * next to that chip read as a second call to action, and the row is where a page's controls live. It
 * wears the same glass as the tabs it stands among and is told apart from them by its glyph alone,
 * which is the one part of a tab that says what it does rather than where it goes.
 *
 * It opens a plate in the middle of the window rather than a menu under the button. The form brings
 * two dropdowns of its own - realms, and the characters this browser looked at before - and a panel
 * hanging off a pinned bar would have to hold them inside itself: two scrollable lists inside a third
 * on the screen where room is scarcest. A plate has none of that, it is the same glass every panel of
 * the site is cut from, and it is shaped like the card the reader met these fields on.
 *
 * Escape, a click on the plate around it and the cross all shut it; the cursor is put in the field
 * the search can start from (the form decides which); the page behind it is held still; and the
 * cursor comes back to the button it was opened from, because a reader who opened it with the
 * keyboard should land where they were.
 */
const { t } = useI18n()

/** Whether the plate is up, and the button a reader's cursor travels back to. */
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)

function show() {
  open.value = true
}

/** Shuts the plate and hands the cursor back to the button, which is where it came from. */
function hide() {
  if (!open.value) return
  open.value = false
  nextTick(() => trigger.value?.focus())
}

/**
 * The two jobs of one window-level listener: Escape shuts the plate, and the search opens from
 * anywhere on the page with the shortcut a reader has been taught by every site that has one
 * (`Ctrl`/`⌘`+`K`). The shortcut stands down while a field holds the cursor, so a character's name
 * that happens to contain a `k` never opens a second plate over the one being typed in.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    hide()
    return
  }

  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return

  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (typing) return

  event.preventDefault()
  show()
}

/** The page behind a plate does not scroll while it is up, which keeps the reader's place in it. */
let overflow = ''

function lock() {
  overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}

function unlock() {
  document.body.style.overflow = overflow
}

watch(open, (value) => (value ? lock() : unlock()))

onMounted(() => document.addEventListener('keydown', onKeydown))

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  // A plate that is up while the page goes away must not leave the page behind it frozen.
  unlock()
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="hoa-tab hoa-liquid-glass"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :title="t('findCharacter')"
    @click="show"
  >
    <!-- The magnifier, in `currentColor`, so it warms with the tab the way the chevron of the
         collections menu does. -->
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.42 9.81l3.14 3.13a.75.75 0 1 0 1.06-1.06l-3.14-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
    </svg>
    {{ t('findCharacter') }}
  </button>

  <!-- The plate is drawn into the body rather than inside the header: the bar is pinned and a
       stacking context of its own, and a plate has to cover the window, not the band it was opened
       in. The scrim is the site's own dark glass at a third of its weight, so the page is still
       recognisable behind the search. -->
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      @click.self="hide"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hoa-find-character"
        class="relative my-auto w-full max-w-md rounded-2xl border border-white/10 bg-wow-dark/95 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl backdrop-saturate-150 sm:p-6"
      >
        <div class="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="hoa-find-character" class="text-lg font-extrabold text-white">{{ t('findCharacter') }}</h2>
            <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('findCharacterHint') }}</p>
          </div>

          <button
            type="button"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            :aria-label="t('close')"
            :title="t('close')"
            @click="hide"
          >&#10005;</button>
        </div>

        <CharacterSearchForm autofocus />
      </div>
    </div>
  </Teleport>
</template>

