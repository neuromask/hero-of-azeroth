/**
 * The shared contracts both ends of the wire read: how a figure is written, how a class is coloured,
 * how an event is filed, and how the table's columns travel in an address.
 *
 * These are pure functions used by the pages, the card and the endpoint alike, which is exactly why
 * they are worth pinning: a change here is a change on every screen and on the pictures drawn from
 * them, and several of them exist to stop two ends from disagreeing (`formatNumber` was written
 * because `4,589` once stood beside `4 589`).
 */
import { describe, expect, it } from 'vitest'
import { formatNumber } from '../../shared/utils/formatNumber'
import { DEFAULT_CLASS_HEX, classColorHex, resolveClass } from '../../shared/utils/wow-class'
import {
  activityAccent,
  activityCategoryCounts,
  activityInCategory,
  activityType
} from '../../shared/utils/activity'
import { CURRENT_MAX_LEVEL, LEADERBOARD_SORTS, isAtItemLevelCap } from '../../shared/data/leaderboardSchema'
import { leaderboardColumnsFromQuery, leaderboardColumnsQuery } from '../../app/composables/leaderboardView'

describe('formatNumber', () => {
  it('groups thousands with a plain space, in both languages', () => {
    expect(formatNumber(1_234_567)).toBe('1 234 567')
    expect(formatNumber(1200)).toBe('1 200')
    expect(formatNumber(-4200)).toBe('-4 200')
    expect(formatNumber(0)).toBe('0')
  })

  it('reads a missing or fractional figure honestly', () => {
    expect(formatNumber(null)).toBe('')
    expect(formatNumber(undefined)).toBe('')
    expect(formatNumber(Number.NaN)).toBe('')
    expect(formatNumber(1200.4)).toBe('1 200')
  })
})

describe('class lookups', () => {
  it('resolves by id, by name, and by the Armoury slug', () => {
    expect(resolveClass({ classId: 6 })?.slug).toBe('death_knight')
    expect(resolveClass({ class: 'Druid' })?.id).toBe(11)
    expect(resolveClass({ class: 'друид' })?.id).toBe(11)
    expect(resolveClass({ class: 'druid' })?.id).toBe(11)
  })

  it('falls back to the brand gold for a class it cannot place', () => {
    expect(classColorHex({ classId: 11 })).toBe('#FF7D0A')
    expect(classColorHex({ classId: 999 })).toBe(DEFAULT_CLASS_HEX)
    expect(classColorHex({})).toBe(DEFAULT_CLASS_HEX)
  })
})

describe('the activity feed', () => {
  it('files an event under its filter, with `all` keeping everything', () => {
    expect(activityInCategory({ type: 'mount' }, 'collections')).toBe(true)
    expect(activityInCategory({ type: 'raid' }, 'pve')).toBe(true)
    expect(activityInCategory({ type: 'mythic' }, 'pve')).toBe(true)
    expect(activityInCategory({ type: 'achievement' }, 'pvp')).toBe(false)
    expect(activityInCategory({ type: 'achievement' }, 'all')).toBe(true)
  })

  it('counts each filter over the whole list', () => {
    const counts = activityCategoryCounts([
      { type: 'mount' },
      { type: 'achievement' },
      { type: 'raid' },
      { type: 'mythic' },
      { type: 'pvp' }
    ])

    expect(counts).toEqual({ all: 5, achievements: 1, pve: 2, collections: 1, pvp: 1 })
  })

  it('reads an event type and an accent from the wording, in both languages', () => {
    expect(activityType('Dungeons & Raids', 'Collect 300 mounts')).toBe('raid')
    expect(activityType('Pets', '')).toBe('pet')
    expect(activityType('', 'Полеты на маунтах')).toBe('mount')
    expect(activityAccent(81, '')).toBe('feat')
    expect(activityAccent(0, 'Великие подвиги')).toBe('feat')
    expect(activityAccent(0, 'Professions')).toBeNull()
  })
})

describe('the leaderboard contract', () => {
  it('knows an overall order and the item-level cap', () => {
    expect(LEADERBOARD_SORTS).toContain('total')
    // The honorable kills stand in the table's own column after the rating, so they are a figure a reader can
    // order by as well - and the endpoint checks a query string against this very list.
    expect(LEADERBOARD_SORTS).toContain('kills')
    expect(isAtItemLevelCap(CURRENT_MAX_LEVEL)).toBe(true)
    expect(isAtItemLevelCap(CURRENT_MAX_LEVEL - 1)).toBe(false)
    expect(isAtItemLevelCap(undefined)).toBe(false)
  })

  it('round-trips the columns a link carries', () => {
    expect(leaderboardColumnsQuery(['total'])).toEqual({})
    expect(leaderboardColumnsQuery(['mounts', 'total'])).toEqual({ columns: 'mounts' })
    expect(leaderboardColumnsFromQuery('mounts,toys')).toEqual(['mounts', 'toys'])
    expect(leaderboardColumnsFromQuery('toys,mounts')).toEqual(['mounts', 'toys'])
    expect(leaderboardColumnsFromQuery('nonsense')).toBeNull()
    expect(leaderboardColumnsFromQuery('')).toBeNull()
    expect(leaderboardColumnsFromQuery(undefined)).toBeNull()
  })

  it('carries the honorable kills column in an address, like every other figure', () => {
    // An address naming several figures spells them in the order the table draws its columns in
    // (`LEADERBOARD_SORTS`), which is why the kills come back before the rating however the address wrote them.
    expect(leaderboardColumnsFromQuery('mplus,kills')).toEqual(['kills', 'mplus'])
    expect(leaderboardColumnsQuery(['kills'])).toEqual({ columns: 'kills' })
  })
})
