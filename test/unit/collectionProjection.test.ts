/**
 * The shelf a collections request is answered with: the whole one, or a slice of it.
 *
 * A shelf is every collectable in the game - fifteen hundred items for the mounts alone - and a page opens
 * on one section, so the endpoint trims the answer to what was asked for. The contract worth pinning is
 * what stays: ids, headings and every count are computed from the *whole* journal before the trim, so the
 * quick anchors, the bars and the counters in the first response are the ones the full shelf would have
 * printed - and the shelf the store holds is never written to, whatever slice a caller asked for.
 */
import { describe, expect, it } from 'vitest'
import { projectCollectionSections, selectCollectionView } from '../../server/utils/collections'
import type { CollectionItem, CollectionPage, CollectionSection } from '../../shared/data/collectionsSchema'

function item(id: number, collected = true): CollectionItem {
  return { id, name: `Item ${id}`, icon: '', fallback: '', collected, wow: null }
}

function section(id: string, ids: number[]): CollectionSection {
  return {
    id,
    label: id.toUpperCase(),
    collected: ids.length,
    total: ids.length,
    percent: ids.length ? 100 : 0,
    subgroups: [
      { id: `${id}-a`, label: 'Source A', collected: ids.length - 1, total: ids.length - 1, items: ids.slice(0, -1).map((n) => item(n)) },
      { id: `${id}-b`, label: 'Source B', collected: 1, total: 1, items: ids.slice(-1).map((n) => item(n)) }
    ]
  }
}

function page(): CollectionPage {
  return {
    kind: 'mounts',
    collected: 6,
    total: 6,
    percent: 100,
    sections: [section('general', [1, 2]), section('midnight', [3, 4]), section('the-war-within', [5, 6])],
    account: false,
    accountAvailable: true,
    generatedAt: 1
  }
}

const icons = (value: CollectionPage) =>
  value.sections.map((s) => s.subgroups.reduce((sum, sub) => sum + sub.items.length, 0))

describe('projectCollectionSections', () => {
  it('keeps the tiles of the sections it is asked for and empties the rest', () => {
    expect(icons(projectCollectionSections(page(), (id) => id === 'general'))).toEqual([2, 0, 0])
    expect(icons(projectCollectionSections(page(), (id) => id === 'midnight'))).toEqual([0, 2, 0])
  })

  it('keeps every heading, id and count, so the rail and the bars do not move', () => {
    const projected = projectCollectionSections(page(), () => false)

    expect(projected.sections.map((s) => s.id)).toEqual(['general', 'midnight', 'the-war-within'])
    expect(projected.sections.map((s) => s.label)).toEqual(['GENERAL', 'MIDNIGHT', 'THE-WAR-WITHIN'])
    expect(projected.sections.map((s) => s.total)).toEqual([2, 2, 2])
    expect(projected.sections.map((s) => s.collected)).toEqual([2, 2, 2])
    expect(projected.sections.map((s) => s.percent)).toEqual([100, 100, 100])
    // The subgroup headings and their own counters travel too - they are what the block is drawn from.
    expect(projected.sections[0]!.subgroups.map((sub) => sub.id)).toEqual(['general-a', 'general-b'])
    expect(projected.sections[0]!.subgroups.map((sub) => sub.label)).toEqual(['Source A', 'Source B'])
    expect(projected.sections[0]!.subgroups.map((sub) => sub.total)).toEqual([1, 1])
  })

  it('changes no summary figure', () => {
    const before = page()
    const projected = projectCollectionSections(before, (id) => id === 'general')

    expect(projected.collected).toBe(before.collected)
    expect(projected.total).toBe(before.total)
    expect(projected.percent).toBe(before.percent)
    expect(projected.kind).toBe(before.kind)
    expect(projected.account).toBe(before.account)
    expect(projected.accountAvailable).toBe(before.accountAvailable)
    expect(projected.generatedAt).toBe(before.generatedAt)
  })

  it('does not write into the page it was handed', () => {
    const original = page()
    projectCollectionSections(original, () => false)

    expect(icons(original)).toEqual([2, 2, 2])
    expect(original.sections[0]!.subgroups[0]!.items.length).toBe(1)
  })
})

describe('selectCollectionView', () => {
  it('answers a request that names nothing with the whole shelf, untouched', () => {
    const whole = page()
    expect(selectCollectionView(whole, {})).toBe(whole)
    expect(selectCollectionView(whole)).toBe(whole)
    expect(selectCollectionView(whole, { sections: 'nonsense', section: '' })).toBe(whole)
  })

  it('answers `sections=first` with the first section tiles and every heading', () => {
    const whole = page()
    const first = selectCollectionView(whole, { sections: 'first' })

    expect(icons(first)).toEqual([2, 0, 0])
    expect(first.sections.map((s) => s.id)).toEqual(['general', 'midnight', 'the-war-within'])
    expect(first.sections[1]!.total).toBe(2)
    // and it is a copy, not the shelf the store keeps
    expect(first).not.toBe(whole)
    expect(icons(whole)).toEqual([2, 2, 2])
  })

  it('answers `section=<id>` with exactly that section tiles', () => {
    const whole = page()
    const one = selectCollectionView(whole, { section: 'midnight' })

    expect(icons(one)).toEqual([0, 2, 0])
    expect(one.sections[1]!.subgroups[0]!.items.map((entry) => entry.id)).toEqual([3])
    expect(one.sections[1]!.subgroups[1]!.items.map((entry) => entry.id)).toEqual([4])
  })

  it('answers an unknown section with the whole shelf rather than an error', () => {
    const whole = page()
    expect(selectCollectionView(whole, { section: 'not-a-section' })).toBe(whole)
  })

  it('prefers a named section over the `first` shorthand', () => {
    const one = selectCollectionView(page(), { sections: 'first', section: 'the-war-within' })
    expect(icons(one)).toEqual([0, 0, 2])
  })
})
