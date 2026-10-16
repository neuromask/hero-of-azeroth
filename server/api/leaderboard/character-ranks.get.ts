/**
 * Where one character stands in every ranking of the site, which is what a page of their figures links with.
 *
 * The sibling of `./metric-ranks.get`, which answers a figure's ranking for the names a caller has: this one
 * answers a name against every figure's ranking. It is the question a character's own page asks, because every
 * stat tile and every figure of the drawer under the summary is a door into the ranking of the figure it prints,
 * and a door that carried no place would open the table at its first page - the reader would be told "Mounts 1 266"
 * and land a thousand rows above themselves. The place travels in the address as `?rank=`
 * (`app/composables/metricLeaderboard`), and the twelve other places come back in the same answer rather than in
 * twelve more requests: they are the same read of the same table, one figure at a time.
 *
 * A caller asks with `?region=<region>&realm=<realm>&name=<character>`, which is the address a character's page
 * stands at rather than a key - the page has those three segments in hand and nothing else. Both spellings of the
 * region (`eu`, `region-eu`) are read the way `parseRegion` reads them everywhere; a region the build does not
 * serve and a question missing its realm or its character are refused rather than guessed at, because there is no
 * character to answer about.
 *
 * A character the table does not hold is answered rather than refused, with `null` for the rankings that do not
 * hold them - the same answer a figure the site has never read for them gets - which is what lets a door fall back
 * to the table's first page instead of leading nowhere.
 *
 * Cached under the question and the stamp of the data, exactly as the metric page's own answer is
 * (`./metric-ranks.get`), so a write that moves the population is a different key and nobody is sent to a row of a
 * table that has moved on.
 */
import { getCharacterRanks, leaderboardDataStamp } from '~~/server/utils/leaderboardStorage'
import { parseRegion } from '~~/server/utils/params'

/** One text parameter out of a query string, trimmed, or `undefined` for anything unusable. */
function parseText(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return undefined

  const text = raw.trim()
  return text || undefined
}

export default defineCachedEventHandler(
  async (event) => {
    const query = getQuery(event)

    const region = parseRegion(Array.isArray(query.region) ? query.region[0] : query.region)
    const realm = parseText(query.realm)
    const name = parseText(query.name)

    if (!realm || !name) throw createError({ statusCode: 400, statusMessage: 'A realm and a character are required' })

    return await getCharacterRanks({ region, realm, name })
  },
  {
    // The table's own terms, so a place can never be a place in a table nobody was shown.
    maxAge: 3600,
    swr: false,
    /** The question and the stamp of the data, exactly as the ranks endpoint beside this one files its answers. */
    getKey: (event) => {
      const query = getQuery(event)
      const text = (value: unknown) => (Array.isArray(value) ? value.join(',') : String(value ?? ''))
      const question = ['region', 'realm', 'name'].map((key) => `${key}=${text(query[key])}`).join('&')

      return `${getRequestURL(event).pathname}?${question}@${leaderboardDataStamp()}`
    }
  }
)
