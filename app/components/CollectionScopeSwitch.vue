<script setup lang="ts">
/**
 * Whose collection the figures above this control belong to: this character's own journal, or the whole
 * Battle.net account's - the pair of chips every collections page carries above its numbers.
 *
 * A WoW collection is shared across every character of an account, so the account's own list is the truer
 * unit for a shelf, and it is the one the site's pool holds (`server/utils/accountPool`). Only the account's
 * own reader may ask for it - the ids were read with their token, and the roster behind them is private - so
 * the control exists only while the character being read is the reader's own (`useOwnCharacter`), and a guest
 * or a stranger's page simply reads a character's shelf with no control offering anything else.
 *
 * It is one component because the choice is one choice and it is drawn in two places: under a shelf's heading
 * (`CollectionShelf`) and in the head of the summary the root collections page opens on
 * (`CollectionSummaryGrid`). Both read `useCollectionView`, so a reader who picks the account on one page
 * finds it picked on the next, and the server's own answer is what the note below the chips speaks from -
 * never this switch, because a collection the site has never read for that account comes back as the
 * character's and says so (`CollectionPage.account`, `CollectionSummary.account`).
 */
const props = defineProps<{
  /**
   * Whether the answer standing above this control really was read from the account's own ids: the server
   * decides that, and the note under the chips is drawn from it rather than from the switch.
   */
  account?: boolean
}>()

const { t } = useI18n()
const view = useCollectionView()

/** Whether this character is the reader's own, which is the only case the account's shelf may be read in. */
const mine = useOwnCharacter()
</script>

<template>
  <template v-if="mine">
    <!-- The pair: the chosen half wears the brand gold, the way the account page draws its publish switch -
         so which collection the numbers above belong to is read at a glance rather than from the words. -->
    <span
      role="group"
      :aria-label="t('collectionsViewScope')"
      class="inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.04] p-0.5"
    >
      <button
        type="button"
        :aria-pressed="!view.byAccount"
        class="rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors"
        :class="
          !view.byAccount
            ? 'bg-wow-gold/15 text-wow-goldLight shadow-[0_0_0_1px_rgba(248,183,0,0.45)]'
            : 'text-gray-400 hover:text-white'
        "
        @click="view.byAccount = false"
      >
        {{ t('perCharacter') }}
      </button>
      <button
        type="button"
        :aria-pressed="Boolean(view.byAccount)"
        class="rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors"
        :class="
          view.byAccount
            ? 'bg-wow-gold/15 text-wow-goldLight shadow-[0_0_0_1px_rgba(248,183,0,0.45)]'
            : 'text-gray-400 hover:text-white'
        "
        @click="view.byAccount = true"
      >
        {{ t('accountWide') }}
      </button>
    </span>

    <!-- What a switch that could not be honoured says: the account's own shelf is only readable once the site
         has the account's list of that collection, and a reader whose decorations Blizzard refuses (the one
         call this build may not be allowed) is told so rather than shown nought collected. -->
    <p v-if="view.byAccount && !props.account" class="text-xs text-gray-400">
      {{ t('collectionsAccountUnavailable') }}
    </p>
  </template>
</template>
