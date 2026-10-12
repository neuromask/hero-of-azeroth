/**
 * The list a search field offers, which is two remembered things drawn as one.
 *
 * A character is remembered when it is looked up (`useSearchHistory`) and when it is saved for a quick compare
 * (`app/composables/versusFavorites.ts`) - the two are the same act of remembering for two reasons, and one
 * field offers both (`app/components/CharacterSearchForm.vue`). The merge is the only piece of that arrangement
 * that is pure, so it is the piece worth pinning: the saved characters come first, nothing is drawn twice, and
 * each list's order is otherwise left alone. Deduplication is by the key a character is unique on, which is
 * lowercased (`searchHistoryKey`), so one character spelled two ways in two stores is still one row.
 */
import { describe, expect, it } from 'vitest'
import {
  mergeSearchEntries,
  searchHistoryKey,
  toSearchHistoryEntry,
  type SearchHistoryEntry
} from '../../app/composables/searchHistory'

/** A remembered character, with only the parts a row is drawn from. */
function entry(name: string, realm = 'gordunni', region: 'eu' | 'us' = 'eu'): SearchHistoryEntry {
  return { name, realm, region, realmName: 'Gordunni' }
}

describe('the list under a search field', () => {
  it('offers what was saved before what was looked up', () => {
    const merged = mergeSearchEntries([entry('Rival')], [entry('Neromask'), entry('Finklestein')])
    expect(merged.map((row) => row.name)).toEqual(['Rival', 'Neromask', 'Finklestein'])
  })

  it('never draws one character twice, however the two stores spell its case', () => {
    const merged = mergeSearchEntries([entry('Rival')], [entry('rival'), entry('Neromask')])

    expect(merged.map((row) => row.name)).toEqual(['Rival', 'Neromask'])
    expect(new Set(merged.map(searchHistoryKey)).size).toBe(merged.length)
  })

  it('leaves a lone list as it was', () => {
    expect(mergeSearchEntries([], [entry('A'), entry('B')]).map((row) => row.name)).toEqual(['A', 'B'])
    expect(mergeSearchEntries([entry('A')], []).map((row) => row.name)).toEqual(['A'])
  })

  it('reads what storage holds into entries, and refuses what is not one', () => {
    // Exactly the shape an earlier visit writes, rather than a value a caller typed.
    expect(toSearchHistoryEntry({ name: 'Rival', realm: 'gordunni', region: 'eu', realmName: 'Gordunni' }))
      .toMatchObject({ name: 'Rival', realm: 'gordunni', region: 'eu' })
    expect(toSearchHistoryEntry({ name: 'Rival', realm: '', region: 'eu' })).toBeNull()
    expect(toSearchHistoryEntry({ name: 'Rival', realm: 'gordunni', region: 'asia' })).toBeNull()
  })
})
