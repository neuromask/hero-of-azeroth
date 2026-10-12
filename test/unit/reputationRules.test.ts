/**
 * The reputation journal's rules: what "finished" means, what an account's reading marks, and the
 * denominator the account's reading is measured against.
 *
 * A reputation is "finished" when it sits at the top of its own ladder - an Exalted faction, the last
 * renown level, the last companion rank - and a faction the atlas has no ladder for falls back to the
 * Exalted reading. The account's journal marks the rows only an alt finished, without ever counting a
 * row twice: those marks are the difference between the character's number and the account's.
 */
import { describe, expect, it } from 'vitest'
import {
  buildReputationJournal,
  isExalted,
  isReputationMaxed,
  reputationReachableTotal
} from '../../server/utils/reputations'
import type { ReputationRow } from '../../shared/data/reputationsSchema'

function allRows(journal: ReturnType<typeof buildReputationJournal>): ReputationRow[] {
  return journal.groups.flatMap((group) => group.sections.flatMap((section) => section.rows))
}

describe('what a finished reputation is', () => {
  it('reads Exalted as tier seven, and its name as a fallback', () => {
    expect(isExalted({ tier: 7 })).toBe(true)
    expect(isExalted({ name: 'Exalted' })).toBe(true)
    expect(isExalted({ tier: 3 })).toBe(false)
    expect(isExalted(undefined)).toBe(false)
  })

  it('falls back to the Exalted reading for a faction the atlas does not know', () => {
    expect(isReputationMaxed(undefined, { tier: 7 })).toBe(true)
    expect(isReputationMaxed(undefined, { tier: 3 })).toBe(false)
  })
})

describe('the account\'s denominator', () => {
  it('is every ladder of the atlas, once - and stable across calls', () => {
    const total = reputationReachableTotal()
    expect(total).toBeGreaterThan(0)
    expect(Number.isInteger(total)).toBe(true)
    expect(reputationReachableTotal()).toBe(total)
  })
})

describe('buildReputationJournal', () => {
  it('counts a journal with nothing started as nought finished', () => {
    const journal = buildReputationJournal('en_US', new Map(), null)
    const rows = allRows(journal)

    expect(rows.length).toBeGreaterThan(0)
    expect(journal.total).toBe(rows.length)
    expect(journal.finished).toBe(0)
    expect(journal.started).toBe(0)
    expect(journal.percent).toBe(0)
  })

  it('marks the account\'s finished factions, without counting a row twice', () => {
    const plain = buildReputationJournal('en_US', new Map(), null)
    const ids = allRows(plain).map((row) => row.id)
    const finishedByAccount = new Set(ids.slice(0, 2))

    const journal = buildReputationJournal('en_US', new Map(), null, finishedByAccount)
    const rows = allRows(journal)

    expect(journal.accountFinished).toBe(2)
    expect(journal.finished).toBe(2)
    expect(rows.filter((row) => row.account).length).toBe(2)
    expect(journal.finished).toBeLessThanOrEqual(journal.total)
    expect(journal.percent).toBeLessThanOrEqual(100)
  })
})
