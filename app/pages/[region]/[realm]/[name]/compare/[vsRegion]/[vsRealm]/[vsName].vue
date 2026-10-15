<script setup lang="ts">
/**
 * The comparison with a second character in it: `/compare/region/realm/name` - the comparison the search on
 * `/compare` opens, and the one a saved quick compare links to.
 *
 * The board is the same component the address above draws (`app/components/CharacterVersus.vue`); what this
 * page adds is one thing, which is who the second character is. The segments are the third, fourth and fifth
 * parts of the address, and the region is the bare one the comparison address spells (`eu`), which
 * `regionFromPath` reads as readily as the `region-eu` the character pages use.
 *
 * The parameter names are this page's own (`vsRegion`/`vsRealm`/`vsName`) rather than the `region`/`realm`/
 * `name` the shell above is built from, and that is on purpose: a nested route that reused those names would
 * shadow them, and the shell reads exactly those three to know which character the page is about.
 */
import { useCharacterView } from '~/composables/characterView'

const route = useRoute()
const { region, realm, name } = useCharacterView()
const localeUrl = useLocaleUrl()

/** The second character, or `null` for an address that does not spell all three of its segments. */
const target = computed(() => {
  const targetRegion = regionFromPath(String(route.params.vsRegion || ''))
  const targetRealm = String(route.params.vsRealm || '')
  const targetName = String(route.params.vsName || '')

  return targetRegion && targetRealm && targetName
    ? { region: targetRegion, realm: targetRealm, name: targetName }
    : null
})

/** This character's own comparison address, which the board offers as the way back to the search. */
const compareBase = computed(() => localeUrl(`/${regionPath(region)}/${realm}/${name}/compare`))
</script>

<template>
  <CharacterVersus :vs-base="compareBase" :target="target" />
</template>
