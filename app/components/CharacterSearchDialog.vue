<script setup lang="ts">
/**
 * The way into the search from a page that is not the front door: a button in a page's row, and the
 * two fields it drops under it.
 *
 * The hall of fame is a table of the characters the site has already rendered, so the one thing a
 * reader can want from it that the page does not offer is a character that is not in it yet. This is
 * that button: it stands in the header where a page's own controls stand, and it drops the very form
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
 * The sheet slides out under the row the button is in rather than opening as a plate in the middle of
 * the window, which is where a control of the row is looked for - the collections menu beside it opens
 * the same way - and it leaves the page the search is about in sight: nothing is dimmed by a scrim,
 * nothing behind the sheet is held still, and the table stays where it was while a character is looked
 * up. The wrapper around the button is deliberately left unpositioned (`static`) so the sheet hangs
 * from the row rather than from the button: the row is what gives it a width to hang a form in and a
 * right edge to line up with, and a `relative` here would take both away.
 *
 * The sheet is the site's pane material with its frost on a layer of the sheet (`hoa-pop-layered`),
 * and that is the arrangement the form is here for: it brings two panes of its own - the realms, and
 * the characters this browser looked at before - and a `backdrop-filter` on the sheet would make the
 * sheet their backdrop, so the two lists could only sample the very glass they are opened onto the page
 * for. It is the same rearrangement `.hoa-panel-layered` makes of a block, and for the same reason: a
 * pane that drops a pane cannot wear the frost itself.
 *
 * Escape, a press anywhere but the button and its sheet, and the cross all shut it; the cursor is put
 * in the field the search can start from (the form decides which); and Escape hands it back to the
 * button it was opened from, because a reader who opened it with the keyboard should land where they
 * were. The press is read rather than the click, the way the form's own two panes are read, and the
 * lists inside the sheet are why: a row shuts the list it stands in as the press lands, the list is out
 * of the document before the click is dispatched, and the click is then reported against a row that is
 * no longer in the sheet - which is how picking a remembered character or a realm used to shut the whole
 * search instead of filling its fields.
 */
const { t } = useI18n()

/** Whether the sheet is out, and the button the cursor travels back to. */
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)

/** The button and the sheet under it, which is what a click has to land outside of to shut it. */
const root = ref<HTMLElement | null>(null)

/** Shuts the sheet and leaves the cursor where the reader put it. */
function hide() {
  open.value = false
}

/** The way out a reader takes from the keyboard, which hands the cursor back to the button. */
function dismiss() {
  if (!open.value) return
  hide()
  nextTick(() => trigger.value?.focus())
}

/**
 * A press anywhere but the button and its sheet is a reader who is done with the search. It is the
 * press that is read rather than the click (`mousedown` on `document`), which is what the form's own two
 * panes are watched with, and the lists inside the sheet are the reason: a row shuts the list it stands
 * in as the press is handled, the list leaves the document before the click is dispatched, and the click
 * is then reported against a row that is no longer inside this sheet - so the sheet shut itself every
 * time a remembered character or a realm was picked.
 */
function onDocumentClick(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) hide()
}

/**
 * The two jobs of one window-level listener: Escape shuts the sheet, and the search opens from
 * anywhere on the page with the shortcut a reader has been taught by every site that has one
 * (`Ctrl`/`⌘`+`K`). The shortcut stands down while a field holds the cursor, so a character's name
 * that happens to contain a `k` never opens a second search over the one being typed in.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    dismiss()
    return
  }

  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return

  const target = event.target as HTMLElement | null
  const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
  if (typing) return

  event.preventDefault()
  open.value = true
}

onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root">
    <button
      ref="trigger"
      type="button"
      class="hoa-tab hoa-liquid-glass"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :title="t('findCharacter')"
      @click="open = !open"
    >
      <!-- The magnifier, in `currentColor`, so it warms with the tab the way the chevron of the
           collections menu does. -->
      <svg class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.42 9.81l3.14 3.13a.75.75 0 1 0 1.06-1.06l-3.14-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clip-rule="evenodd" />
      </svg>
      {{ t('findCharacter') }}
    </button>

    <!-- The sheet the button drops: the pane every menu on the site is cut from (`.hoa-pop`), with its
         frost on a layer of the sheet (`hoa-pop-layered`) because the form inside it drops two panes of
         its own. It is `absolute` against the row rather than against this wrapper (which is left
         `static` on purpose), so it hangs under the end of the row instead of under a control's width,
         and it is only in the document while it is out (`v-if` rather than a hidden pane), so a shut
         search leaves no field for a keyboard to walk into. -->
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="-translate-y-3 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-3 opacity-0"
    >
      <div
        v-if="open"
        class="hoa-pop hoa-pop-layered absolute right-0 top-full mt-2 w-[min(92vw,26rem)] p-4 sm:p-5"
        role="dialog"
        :aria-label="t('findCharacter')"
      >
        <div class="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 class="text-base font-extrabold text-white">{{ t('findCharacter') }}</h2>
            <p class="mt-0.5 text-xs leading-relaxed text-gray-400">{{ t('findCharacterHint') }}</p>
          </div>

          <button
            type="button"
            class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            :aria-label="t('close')"
            :title="t('close')"
            @click="dismiss"
          >&#10005;</button>
        </div>

        <CharacterSearchForm autofocus />
      </div>
    </Transition>
  </div>
</template>

