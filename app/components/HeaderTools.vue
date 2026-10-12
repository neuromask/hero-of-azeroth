<script setup lang="ts">
/**
 * The service corner of a header: the language the site is being read in and the account it is read with, as
 * one group.
 *
 * The two belong together and neither belongs to a page. A language and an account are properties of the
 * reader rather than of what stands under the bar, so they are drawn by the header of every page of the site
 * alike - the hall of fame, an account, a document and a character's own page - and the row of navigation
 * below them carries nothing but entries into sections. That is the whole of what this component decides:
 * where the pair stands, and what holds it.
 *
 * The group is one surface of the site's glass - the bar's own control, written once in
 * `app/assets/css/main.css` (`hoa-plate`) - rather than two plates standing beside each other, and the two
 * controls inside it draw no glass of their own. Glass inside glass is the one arrangement the site's
 * material must not have: a `backdrop-filter` on an inner control would make the plate its backdrop, and the
 * control could then only read the plate - a washed copy of it - instead of the page behind the header. So
 * the glass is the group's, the hairline between the two controls is what says that they are two, and each
 * control answers the pointer with a flat tint of its own.
 *
 * Below `lg` a phone has no room in the bar for the group, and the pair travels into the sheet the
 * navigation opens (`app/components/SiteNav.vue`, which hands that sheet in through `variant="panel"`).
 * There they are rows of the sheet rather than a plate in a bar, because a list inside a panel is read at a
 * glance where a second pane hanging off a pane would not be. Both shapes are drawn by the same two
 * components (`app/components/LocaleSwitch.vue`, `app/components/AuthMenu.vue`), so a page can no more wear
 * the pair twice than it can wear two bars.
 */
withDefaults(
  defineProps<{
    /** Where the group is drawn: the corner of a header, or the sheet a phone opens the navigation in. */
    variant?: 'bar' | 'panel'
  }>(),
  { variant: 'bar' }
)
</script>

<template>
  <!-- The corner of a header: one plate of the site's own glass holding the language and the account, with the
       hairline that says they are two. It is drawn from `lg` up only, and that is where the two controls leave
       the bar - below it the header of a phone carries the brand and the way into the navigation panel alone,
       and the pair is inside that panel (`app/components/SiteNav.vue`). -->
  <div v-if="variant === 'bar'" class="hoa-plate hidden !h-11 !gap-0 !px-1 lg:inline-flex">
    <LocaleSwitch />
    <span class="h-5 w-px shrink-0 self-center bg-white/10" aria-hidden="true" />
    <AuthMenu />
  </div>

  <!-- The sheet a phone opens the navigation in: the same pair as rows of it, under their own headings. It is
       drawn only below `lg`, which is the width at which the row above stops being a row. -->
  <div v-else class="lg:hidden">
    <LocaleSwitch variant="panel" />
    <AuthMenu variant="panel" />
  </div>
</template>
