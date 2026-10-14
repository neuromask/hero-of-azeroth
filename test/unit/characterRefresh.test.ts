/**
 * The manual refresh: the one request that does not take the cache's word for it.
 *
 * The Refresh button sends `?force=true` to the profile, the card and the feed, and the endpoints below it
 * answer a forced request by reading again rather than out of their two hours of cache. What the button could
 * not reach was the layer under them: a character is cached for ten minutes as a *reading*
 * (`server/utils/blizzard`), so a refresh inside that window re-stored the very copy it was asked to replace
 * and reported success without Blizzard being called at all. These tests pin what a refresh owes now - a real
 * read, a cache left holding it, one read for a burst of presses, the last known figures kept through a
 * failure, and no collection figure zeroed by a document that did not arrive.
 *
 * Every test runs against its own copy of the module (`vi.resetModules`), because the caches under test are
 * module state, and against a stub `$fetch` that counts what the site asked Blizzard for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { overlayPool } from '../../server/utils/accountPool'
import { calculatePlayerScore } from '../../server/utils/playerScore'
import { createMemoryDb, installUseDb } from '../helpers/memoryDb'

/** The character's own lists, as Blizzard returns them; a test moves one to stand for a new reading. */
const documents = {
  mounts: 1200,
  pets: 1400,
  toys: 900,
  decor: 90,
  ap: 11000,
  journal: 1387
}

/** What the static indexes hold, which is what the tiles are measured against. */
const INDEX = { mounts: 1676, pets: 2179, toys: 1135, decor: 2131, reputations: 284 }

/** Every URL the modules asked Blizzard for, in order. */
let asked: string[] = []
/** A gate a test can hold the profile documents behind, to make a read overlap another. */
let gate: Promise<void> | null = null
/** A document a test can make fail, by URL fragment, to stand for a call Blizzard refused. */
let failing = ''
/** A gate the Armoury page is held behind, to show what a forced read waits for and a page does not. */
let armouryGate: Promise<void> | null = null

const many = (count: number, wrap: (id: number) => unknown) =>
  Array.from({ length: count }, (_, index) => wrap(index + 1))

function summary(name: string) {
  return {
    name,
    level: 90,
    achievement_points: documents.ap,
    average_item_level: 317,
    equipped_item_level: 317,
    active_title: { display_string: '{name} the Tested' },
    character_class: { id: 8, name: 'Mage' },
    race: { id: 7, name: 'Night Elf' },
    gender: { type: 'FEMALE' },
    active_spec: { name: 'Frost' },
    guild: { name: 'Guild' },
    faction: { type: 'HORDE' },
    realm: { name: 'Gordunni' }
  }
}

function journalPage(): string {
  const list = many(documents.journal, (id) => ({ id, collected: id <= documents.mounts }))
  return `<html><script>{"mountsCollected":${documents.mounts},"mounts":[${list
    .map((entry) => JSON.stringify(entry))
    .join(',')}]}</script></html>`
}

function answerFor(url: string): unknown | null {
  const parsed = new URL(url)
  const path = decodeURIComponent(parsed.pathname)

  if (parsed.hostname.endsWith('.battle.net') && path === '/oauth/token') {
    return { access_token: 'isolated-token', expires_in: 86400 }
  }

  if (parsed.hostname === 'worldofwarcraft.blizzard.com' && path.endsWith('/collections/mounts')) {
    return journalPage()
  }

  if (!parsed.hostname.endsWith('.api.blizzard.com')) return null

  const index = {
    '/data/wow/mount/index': ['mounts', INDEX.mounts],
    '/data/wow/pet/index': ['pets', INDEX.pets],
    '/data/wow/toy/index': ['toys', INDEX.toys],
    '/data/wow/decor/index': ['decor_items', INDEX.decor],
    '/data/wow/reputation-faction/index': ['factions', INDEX.reputations]
  }[path]

  if (index) return { [index[0] as string]: many(index[1] as number, (id) => ({ id })) }

  const character = path.match(/^\/profile\/wow\/character\/([^/]+)\/([^/]+)(\/.*)?$/)
  if (!character) return null

  const [, , name, rest = ''] = character

  if (rest === '') return summary(name)
  if (rest === '/character-media') return { assets: [] }
  if (rest === '/collections/mounts') return { mounts: many(documents.mounts, (id) => ({ mount: { id } })) }
  if (rest === '/collections/pets') return { pets: many(documents.pets, (id) => ({ species: { id } })) }
  if (rest === '/collections/toys') return { toys: many(documents.toys, (id) => ({ toy: { id } })) }
  if (rest === '/collections/decor') return { decor_collected: many(documents.decor, (id) => ({ decor_item: { id } })) }
  if (rest === '/reputations') return { reputations: [] }
  if (rest === '/mythic-keystone-profile') return { current_mythic_rating: { rating: 2500.4 } }

  return null
}

/** How many times the site read a character's own documents - one per full read of a profile. */
const reads = () => asked.filter((url) => /\/profile\/wow\/character\/[^/]+\/[^/?]+\?namespace/.test(url)).length

/** A promise a test can settle from the outside. */
function deferred(): { promise: Promise<void>; settle: () => void } {
  let settle: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/** A fresh copy of the module under test, so each test starts with empty caches. */
async function load() {
  vi.resetModules()
  return await import('../../server/utils/blizzard')
}

beforeEach(() => {
  // The clock is the test's: the cooldown a press spends is fifteen seconds of it, and the ten-minute cache
  // is measured in the same seconds.
  vi.useFakeTimers()
  asked = []
  gate = null
  armouryGate = null
  failing = ''
  documents.mounts = 1200
  documents.pets = 1400
  documents.ap = 11000

  installUseDb(createMemoryDb().db)
  ;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
    blizzardClientId: 'isolated-client',
    blizzardClientSecret: 'isolated-secret'
  })
  ;(globalThis as Record<string, unknown>).createError = (input: { statusCode?: number; statusMessage?: string }) =>
    Object.assign(new Error(input?.statusMessage || 'error'), input)

  ;(globalThis as Record<string, unknown>).$fetch = async (url: string) => {
    asked.push(url)

    const answer = answerFor(url)
    if (!answer) throw new Error(`isolated run: no fixture for ${url}`)
    if (failing && url.includes(failing)) throw new Error(`isolated run: ${failing} refused`)

    // The Armoury page is the slow one, and a test can hold it open to show who waits for it.
    if (url.includes('worldofwarcraft.blizzard.com')) {
      if (armouryGate) await armouryGate
      return answer
    }
    // The profile documents, held open to make one read overlap the next.
    if (gate && /\/profile\/wow\/character\/[^/]+\/[^/?]+\?namespace/.test(url)) await gate

    return answer
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a manual refresh of a character', () => {
  it('reads Blizzard again while the ten-minute cache is still fresh', async () => {
    const { getCharacter } = await load()

    const first = await getCharacter('gordunni', 'neuromask', 'eu', 'en_US')
    expect(first.stats.mounts.count).toBe(1200)

    // The character collected something, and the reader presses Refresh: the copy on file is minutes old,
    // and it is exactly that copy the request used to be answered with.
    documents.mounts = 1234
    // Past the cooldown a press spends, so this is a press that really asks Blizzard again.
    vi.advanceTimersByTime(20_000)
    const refreshed = await getCharacter('gordunni', 'neuromask', 'eu', 'en_US', true)

    expect(refreshed.stats.mounts.count).toBe(1234)
    expect(reads()).toBe(2)
  })

  it('is not only a bypass of the outer cache: the plain request never read at all', async () => {
    const { getCharacter } = await load()

    await getCharacter('gordunni', 'cached', 'eu', 'en_US')
    documents.mounts = 1234

    // The very request a refresh makes without `force` - which is what the button used to be answered with.
    const again = await getCharacter('gordunni', 'cached', 'eu', 'en_US')

    expect(again.stats.mounts.count).toBe(1200)
    expect(reads()).toBe(1)
  })

  it('leaves the reading behind it for the plain requests that follow', async () => {
    const { getCharacter } = await load()

    await getCharacter('gordunni', 'followed', 'eu', 'en_US')
    documents.mounts = 1234
    vi.advanceTimersByTime(20_000)
    await getCharacter('gordunni', 'followed', 'eu', 'en_US', true)

    const plain = await getCharacter('gordunni', 'followed', 'eu', 'en_US')

    expect(plain.stats.mounts.count).toBe(1234)
    expect(reads()).toBe(2)
  })

  it('is one Blizzard read for a burst of presses, and for the page opening beside them', async () => {
    const { getCharacter } = await load()
    const open = deferred()
    gate = open.promise

    const burst = Promise.all([
      getCharacter('gordunni', 'burst', 'eu', 'en_US', true),
      getCharacter('gordunni', 'burst', 'eu', 'en_US', true),
      getCharacter('gordunni', 'burst', 'eu', 'en_US', true),
      getCharacter('gordunni', 'burst', 'eu', 'en_US')
    ])

    expect(reads()).toBe(0)
    open.settle()
    const answers = await burst

    expect(reads()).toBe(1)
    expect(answers.every((profile) => profile.stats.mounts.count === 1200)).toBe(true)
  })

  it('does not read again inside the cooldown a press has just spent', async () => {
    const { getCharacter } = await load()

    const first = await getCharacter('gordunni', 'twice', 'eu', 'en_US', true)
    documents.mounts = 1234
    const second = await getCharacter('gordunni', 'twice', 'eu', 'en_US', true)

    // The second press is answered from the copy taken moments ago - not from a ten-minute-old one.
    expect(second.stats.mounts.count).toBe(first.stats.mounts.count)
    expect(reads()).toBe(1)
  })
})

describe('a refresh that did not happen', () => {
  it('keeps the reading on file and fails the request rather than reporting a stale success', async () => {
    const { getCharacter } = await load()

    const before = await getCharacter('gordunni', 'refused', 'eu', 'en_US')
    expect(before.stats.mounts.count).toBe(1200)

    failing = '/profile/wow/character/'
    vi.advanceTimersByTime(20_000)
    const readsBeforeFailure = reads()

    await expect(getCharacter('gordunni', 'refused', 'eu', 'en_US', true)).rejects.toThrow()

    // One request, one read: a region is named, so there is no second one to try after a 404.
    expect(reads() - readsBeforeFailure).toBe(1)

    // Nothing was destroyed: the plain request is answered exactly as it was before the press.
    failing = ''
    const after = await getCharacter('gordunni', 'refused', 'eu', 'en_US')
    expect(after.stats.mounts.count).toBe(1200)

    // And the failure left nothing behind that would hide the next successful read.
    documents.mounts = 1234
    vi.advanceTimersByTime(20_000)
    const recovered = await getCharacter('gordunni', 'refused', 'eu', 'en_US', true)

    expect(recovered.stats.mounts.count).toBe(1234)
  })

  it('does not zero a figure whose document this read could not get', async () => {
    const { getCharacter } = await load()

    const before = await getCharacter('gordunni', 'partial', 'eu', 'en_US')
    expect(before.stats.mounts.count).toBe(1200)

    // The mounts document is refused while the pets one answers with a new number: a partial read, which the
    // tiles must not print as an empty collection.
    failing = 'api.blizzard.com/profile/wow/character/gordunni/partial/collections/mounts'
    documents.pets = 1450
    vi.advanceTimersByTime(20_000)

    const refreshed = await getCharacter('gordunni', 'partial', 'eu', 'en_US', true)

    expect(refreshed.stats.mounts.count).toBe(1200)
    expect(refreshed.stats.mounts.count).toBeGreaterThan(0)
    expect(refreshed.stats.pets.count).toBe(1450)
  })
})

describe('the mount journal behind a refresh', () => {
  it('is waited for by a refresh, and never by a page', async () => {
    const { getCharacter } = await load()
    const open = deferred()
    armouryGate = open.promise

    // A page: answered at once, on the snapshot the site stands in with while the Armoury is read behind it.
    const page = await getCharacter('gordunni', 'patient', 'eu', 'en_US')
    expect(page.stats.mounts.total).toBe(1291)

    // A refresh: the reader asked for everything about this character, so it waits for the one read the site
    // has not got - and the answer carries it rather than the snapshot.
    const refreshing = getCharacter('gordunni', 'waiting', 'eu', 'en_US', true)
    open.settle()
    const refreshed = await refreshing

    expect(refreshed.stats.mounts.total).toBe(1387)
  })
})

describe('what a refresh leaves the rest of the site', () => {
  it('answers a character of no account, and one of an account, with the refreshed figures', async () => {
    const memory = createMemoryDb()
    memory.addUser(42)
    memory.addCharacter({ userId: 42, region: 'eu', realm: 'gordunni', name: 'Owned' })
    memory.addPoolItems(42, 'mounts', [1, 2, 3])
    installUseDb(memory.db)

    const { getCharacter } = await load()
    documents.mounts = 1300

    const guest = await getCharacter('gordunni', 'stranger', 'eu', 'en_US', true)
    const served = overlayPool(guest, 'eu', 'gordunni', 'stranger')
    expect(served.pooled).toBe(false)
    expect(served.stats.mounts.count).toBe(1300)

    vi.advanceTimersByTime(20_000)
    const owned = await getCharacter('gordunni', 'owned', 'eu', 'en_US', true)
    const pooled = overlayPool(owned, 'eu', 'gordunni', 'owned')

    // The account's own figures are still laid over the fresh reading, and the journal is the denominator.
    expect(pooled.pooled).toBe(true)
    expect(pooled.stats.mounts.count).toBe(1300)
    expect(pooled.stats.mounts.total).toBe(1387)
    expect(pooled.score).toBe(
      calculatePlayerScore({ achievements: 11000, mounts: 1300, pets: 1400, toys: 900, decor: 90, reputations: 0 })
    )
  })
})

describe('the documents a profile read leaves for the shelves', () => {
  it('are reused by a collections shelf instead of read again', async () => {
    const { getCharacter } = await load()
    const collections = await import('../../server/utils/collections')

    await getCharacter('gordunni', 'neuromask', 'eu', 'en_US')
    const readsBefore = asked.filter((url) => url.includes('/collections/mounts')).length

    const ids = await collections.getCollectedIds('eu', 'gordunni', 'neuromask', 'mounts', 'en_US')

    expect(ids.size).toBe(documents.mounts)
    expect(asked.filter((url) => url.includes('/collections/mounts')).length).toBe(readsBefore)
  })

  it('are reused by the reputation journal instead of read again', async () => {
    const { getCharacter } = await load()
    const reputations = await import('../../server/utils/reputations')

    await getCharacter('gordunni', 'neuromask', 'eu', 'en_US')
    const readsBefore = asked.filter((url) => url.includes('/reputations?')).length

    await reputations.getReputationStandings('eu', 'gordunni', 'neuromask', 'en_US')

    expect(asked.filter((url) => url.includes('/reputations?')).length).toBe(readsBefore)
  })
})

describe('the lifecycle of the shared documents', () => {
  it('are replaced when a refresh reads the character again', async () => {
    const { getCharacter } = await load()
    const collections = await import('../../server/utils/collections')

    await getCharacter('gordunni', 'neuromask', 'eu', 'en_US')
    documents.mounts = 1234
    vi.advanceTimersByTime(20_000)
    await getCharacter('gordunni', 'neuromask', 'eu', 'en_US', true)

    const ids = await collections.getCollectedIds('eu', 'gordunni', 'neuromask', 'mounts', 'en_US')
    expect(ids.size).toBe(1234)
  })

  it('expire with the profile they were read for', async () => {
    const { getCharacter } = await load()
    const collections = await import('../../server/utils/collections')

    await getCharacter('gordunni', 'neuromask', 'eu', 'en_US')
    const readsBefore = asked.filter((url) => url.includes('/collections/mounts')).length

    vi.advanceTimersByTime(11 * 60 * 1000)
    await collections.getCollectedIds('eu', 'gordunni', 'neuromask', 'mounts', 'en_US')

    expect(asked.filter((url) => url.includes('/collections/mounts')).length).toBe(readsBefore + 1)
  })

  it('stay with the character they were read for', async () => {
    const { getCharacter } = await load()
    const collections = await import('../../server/utils/collections')

    await getCharacter('gordunni', 'alpha', 'eu', 'en_US')
    documents.mounts = 5

    const other = await collections.getCollectedIds('eu', 'gordunni', 'beta', 'mounts', 'en_US')
    expect(other.size).toBe(5)

    const own = await collections.getCollectedIds('eu', 'gordunni', 'alpha', 'mounts', 'en_US')
    expect(own.size).toBe(1200)
  })

  it('do not file a document the first read could not get', async () => {
    const { getCharacter } = await load()
    const collections = await import('../../server/utils/collections')

    failing = 'api.blizzard.com/profile/wow/character/gordunni/fresh/collections/mounts'
    await getCharacter('gordunni', 'fresh', 'eu', 'en_US')
    const readsBefore = asked.filter((url) => url.includes('/collections/mounts')).length

    failing = ''
    await collections.getCollectedIds('eu', 'gordunni', 'fresh', 'mounts', 'en_US')

    expect(asked.filter((url) => url.includes('/collections/mounts')).length).toBe(readsBefore + 1)
  })
})
