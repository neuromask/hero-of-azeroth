<script setup lang="ts">
/**
 * Whose collection the figures above this control belong to: this character's own journal, or the whole
 * Battle.net account's - the pair of chips every collections page carries above its numbers.
 *
 * A WoW collection is shared across every character of an account, so the account's own list is the truer
 * unit for a shelf, and it is the one the site's pool holds (`server/utils/accountPool`). That pool belongs to
 * the account that holds the character, not to whoever happens to be reading, so the control is drawn wherever
 * the site has the list at all - `CollectionPage.accountAvailable`, a fact the server reports beside its
 * answer. Anyone may look at any character's collections, and the account-wide figure is printed on that page
 * for everybody already (the tiles above a shelf are overlaid with the pool), so the switch offers the account
 * view to whoever asks for it; where the site has no such list, it is not drawn, because there is nothing the
 * switch could ask for.
 *
 * It is one component because the choice is one choice and it is drawn in two places: under a shelf's heading
 * (`CollectionShelf`) and in the head of the summary the root collections page opens on
 * (`CollectionSummaryGrid`). Both read `useCollectionView`, so a reader who picks the account on one page
 * finds it picked on the next, and the server's own answer is what the note below the chips speaks from -
 * never this switch, because a collection the site has never read for that account comes back as the
 * character's and says so (`CollectionPage.account`, `CollectionSummary.account`).
 */
import { ACCOUNT_SHELF_KINDS } from '#shared/data/collectionsSchema'
import type { CollectionKind } from '#shared/data/collectionsSchema'

const props = defineProps<{
  /**
   * Whether the answer standing above this control really was read from the account's own ids: the server
   * decides that, and the note under the chips is drawn from it rather than from the switch.
   */
  account?: boolean
  /**
   * Whether the site holds an account-wide list for the account that holds this character at all
   * (`CollectionPage.accountAvailable`). It is a fact about the data and not about the reader: where there is
   * such a list, the switch is drawn for whoever opens the page - the account-wide figure is already printed
   * on the page for everybody - and where there is none, no control is drawn, because a switch that can only
   * ever be turned back is worse than no switch at all.
   */
  available?: boolean
  /**
   * The shelf this control stands over, when it stands over one: a shelf whose account-wide list Blizzard
   * does not serve draws no control at all (`ACCOUNT_SHELF_KINDS`). The summary leaves it out, because it
   * speaks for four shelves at once - three of which can be read as the account's.
   */
  kind?: CollectionKind
}>()

const { t } = useI18n()
const view = useCollectionView()

/**
 * Whether there is a choice here at all: a shelf Blizzard serves no account-wide list for is never one
 * (decorations), and neither is a character whose account the site holds no list for - the switch would have
 * nothing to read.
 */
const offersScope = computed(
  () => Boolean(props.available) && (!props.kind || ACCOUNT_SHELF_KINDS.includes(props.kind))
)
</script>

<template>
  <template v-if="offersScope">
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
