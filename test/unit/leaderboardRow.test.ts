/**
 * The two halves of one question: *which row of the hall of fame did this link ask for?*
 *
 * A stat tile on a character page links into the table with the figure's chip lit and the character's row
 * named, and the page it lands on has to turn that name back into the very key the table drew the row under.
 * The pair below is where that agreement lives (`leaderboardRowQuery` writes it, `leaderboardRowFromQuery`
 * reads it), so a test of it is a test of the whole leap from a tile to a row: a name that comes back spelled
 * differently from the way the row is keyed finds nothing and scrolls nowhere, which is a failure a reader
 * sees as "the table opened at the top again".
 *
 * The keys are the ones the table itself builds a row's key with (`searchHistoryKey`): the region and the
 * realm as the site writes them, the name lowercased - and the name is the one segment that can be typed by
 * hand out of an address, in any case, which is why it is normalised on the way back in.
 */
import { describe, expect, it } from 'vitest'
import {
  leaderboardRowFromQuery,
  leaderboardRowQuery,
  LEADERBOARD_ROW_PARAM
} from '../../app/composables/leaderboardView'

/** A character as the table's own storage writes one: a region, a realm slug, and a name as Blizzard spells it. */
const row = { region: 'eu', realm: 'gordunni', name: 'нейромаск' }

describe('the row a link into the table names', () => {
  it('is written as the row itself is keyed', () => {
    expect(leaderboardRowQuery(row)).toEqual({ [LEADERBOARD_ROW_PARAM]: 'eu:gordunni:нейромаск' })
  })

  it('comes back as the same key the table drew the row under', () => {
    const written = leaderboardRowQuery({ region: 'eu', realm: 'gordunni', name: 'Нейромаск' })

    expect(leaderboardRowFromQuery(written[LEADERBOARD_ROW_PARAM])).toBe('eu:gordunni:нейромаск')
  })

  it('survives an address that was typed by hand out of case', () => {
    // The address bar takes whatever a reader types, while a row is keyed one way only.
    expect(leaderboardRowFromQuery('EU:Gordunni:Нейромаск')).toBe('eu:gordunni:нейромаск')
  })

  it('reads the first of a repeated parameter, which is what a query string may hold', () => {
    expect(leaderboardRowFromQuery(['eu:gordunni:нейромаск', 'eu:silvermoon:exent'])).toBe(
      'eu:gordunni:нейромаск'
    )
  })

  it('is nothing at all when the address names no row', () => {
    // Every one of these is an address a reader, a crawler or a stale bookmark can produce, and none of them
    // may turn into a scroll or a page change: the table is left exactly as the reader found it.
    expect(leaderboardRowFromQuery(undefined)).toBeNull()
    expect(leaderboardRowFromQuery('')).toBeNull()
    expect(leaderboardRowFromQuery('gordunni:нейромаск')).toBeNull()
    expect(leaderboardRowFromQuery('eu:gordunni')).toBeNull()
    expect(leaderboardRowFromQuery('eu::нейромаск')).toBeNull()
    expect(leaderboardRowFromQuery('asia:gordunni:нейромаск')).toBeNull()
    expect(leaderboardRowFromQuery(42)).toBeNull()
  })
})
