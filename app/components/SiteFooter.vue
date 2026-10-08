<script setup lang="ts">
/**
 * The brand line every page carries: the address the site answers on, the repository it is built
 * in, the credit, and the year.
 *
 * It is one component rather than a copy per page, because it is the same line in both places the
 * site shows it - the foot of a character page and the foot of the box on the front page - and
 * every part of it is an address that should only ever change in one place. The year is read
 * rather than written, so the line does not go stale on the first of January.
 *
 * The links are the site's three faces: the address it is served on and the repository it is built
 * in open in the tab the reader is already in, and the credit opens the author's Telegram in a new
 * one, so a reader who follows it keeps the page they were reading. The external link carries the
 * pair of `rel` values the rest of the site's external links carry (`WowheadLink.vue`).
 */
const SITE = 'https://heroofazeroth.com'
const REPOSITORY = 'https://github.com/neuromask/hero-of-azeroth'
const TELEGRAM = 'https://t.me/neuromask'

/** The treatment every link on the line wears, so the three of them read as one row. */
const LINK = 'outline-none transition-colors hover:text-wow-goldLight focus-visible:text-wow-goldLight'
</script>

<template>
  <!-- `flex-wrap` because the line is longer than a phone is wide: the parts wrap and stay centred
       rather than pushing the page sideways. -->
  <span class="flex flex-wrap items-center justify-center gap-1.5">
    <a :href="SITE" :class="LINK">heroofazeroth.com</a>
    <span aria-hidden="true">&middot;</span>
    <a :href="REPOSITORY" :class="LINK">GitHub</a>
    <span aria-hidden="true">&middot;</span>
    <span>crafted by <a :href="TELEGRAM" target="_blank" rel="noopener noreferrer" title="Telegram" :class="LINK">neuromask</a></span>
    <span aria-hidden="true">&middot;</span>
    <span>&copy; {{ new Date().getFullYear() }}</span>
  </span>
</template>
