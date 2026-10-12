<script setup lang="ts">
/**
 * The comparison on the address that carries no second character: `/vs`.
 *
 * The board itself is one component (`app/components/CharacterVersus.vue`), because the address below this
 * one (`./[vsRegion]/[vsRealm]/[vsName].vue`) draws the very same board with somebody picked, and what the
 * search on this address opens is that address. So what belongs here is only the reading of the address:
 * which character this board is about, and the language it is served in.
 */
import { useCharacterView } from '~/composables/characterView'

const { region, realm, name } = useCharacterView()
const localeUrl = useLocaleUrl()

/**
 * This character's own comparison address, in the language being read. It is handed to the board and to the
 * search form inside it, and it is the whole of what the form needs to know: a looked-up character's three
 * segments are appended to it (`/vs/eu/azuregos/name`), and every saved quick compare links to it the same
 * way.
 */
const vsBase = computed(() => localeUrl(`/${regionPath(region)}/${realm}/${name}/vs`))
</script>

<template>
  <CharacterVersus :vs-base="vsBase" />
</template>
