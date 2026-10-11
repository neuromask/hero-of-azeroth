/**
 * The reputation factions a character can work on, the journal one character's own payload is folded
 * into, and the head of the counters the tiles read.
 *
 * The atlas beside this file - `reputations-data.json`, built offline by
 * `scripts/refresh-reputations.mjs` - holds every entry of Blizzard's reputation pane the way the pane is
 * organized: the expansions and the standalone groups at the top, the headings under them (a side, a
 * garrison, a cluster of city factions), and the factions in those, each with the side that may raise it,
 * the top of its ladder and the span and name of every step of that ladder. It is read here and never at
 * request time: a request pays for one thing only, the character's own reputation document, a single call
 * to Blizzard's profile endpoint.
 *
 * The journal a request assembles is the character's *own*. It is folded against the payload of the
 * character whose page is open, and the account's union across the roster (`server/utils/accountPool`,
 * `bestFigures`) is deliberately not applied to it: a visitor standing in the game on one character reads
 * what *that* character can raise and has raised, so the shelf may count fewer factions than the
 * reputations tile above it, which answers the account's question. The shelf carries a legend saying as
 * much in the reader's own words (see `app/components/ReputationShelf.vue`).
 *
 * The three figures the tile and the hall of fame read live here as well - `reputationTotal`,
 * `isExalted`, `isReputationMaxed` - so that "a finished reputation" has one reading across the site:
 * an Exalted faction, a renown ladder at its last level and a delve companion at its hundredth rank all
 * count the same, which is what the game's own counter does.
 */
import { getBlizzardToken } from './blizzard'
import {
  REPUTATION_MAX_STEPS,
  REPUTATION_STANDING_KEYS,
  type ReputationGroup,
  type ReputationGroupId,
  type ReputationJournal,
  type ReputationRow,
  type ReputationSection,
  type ReputationStanding,
  type ReputationStep
} from '#shared/data/reputationsSchema'
import atlas from './reputations-data.json'

/** One faction as the atlas stores it: what a heading or a row is drawn with, and its ladder. */
interface AtlasFaction {
  en: string
  ru: string
  /** The side that may raise it - `ALLIANCE`, `HORDE`, or empty, which both may. */
  side: string
  /** The last renown level of a renown ladder, or nought for every other kind. */
  renown: number
  /** The top of the ladder: the last step's tier, or a renown ladder's last level. Nought for a heading. */
  top: number
  /** The tier table the ladder's steps come from, or null where there is none (a renown ladder). */
  ladder: number | null
}

/** One ladder as the atlas stores it: its last step, the span of every step and every step's name. */
interface AtlasLadder {
  top: number | null
  spans: [number, number][]
  names: { en: string; ru: string }[]
}

/** One node of the tree the pane is organized by: a heading, or a faction standing on its own. */
interface AtlasNode {
  id: number | 'other'
  children: AtlasNode[]
}

/** Cast because the atlas is data: TypeScript cannot know which ids it holds. */
const FACTIONS = atlas.factions as unknown as Record<string, AtlasFaction>
const LADDERS = atlas.ladders as unknown as Record<string, AtlasLadder>
const TREE = atlas.tree as unknown as AtlasNode[]
const tops = atlas.tops as Record<string, number>
const reachable = atlas.reachable as Record<string, number>

/** The side a character is on, read off the faction Blizzard names them with. */
const FACTION_SIDE: Record<string, string> = { ALLIANCE: 'ALLIANCE', HORDE: 'HORDE' }

/**
 * How many reputations a character of this faction can reach at all: the factions of their own side plus
 * the neutral ones, as the atlas counted them when it was built.
 *
 * `listed` is what Blizzard's index holds right now and `recorded` the number of reputations the
 * character payload carries. A patch that adds factions after the atlas was built moves the total by
 * however many ids the index has grown by, and a character who carries more reputations than the atlas
 * knows about keeps the tile from reading over 100%.
 */
export function reputationTotal(side: string, listed: number, recorded: number): number {
  const known = reachable[side] ?? Math.max(reachable.ALLIANCE, reachable.HORDE)

  return Math.max(known + Math.max(0, listed - atlas.listed), recorded)
}

/** "Exalted" is tier 7; the name is the fallback for a faction on a shorter tier table. */
const EXALTED_NAMES = new Set(['Exalted', 'Превознесение'])

export function isExalted(standing: any): boolean {
  return standing?.tier === 7 || EXALTED_NAMES.has(standing?.name)
}

/**
 * Whether a standing sits at the top of its faction's own ladder. A renown faction reports the level it
 * is on as `renown_level`, every other one as `tier`, and both are compared against the top the atlas
 * holds. A faction it does not know - one a patch added after the atlas was built - falls back to the
 * Exalted reading.
 */
export function isReputationMaxed(factionId: number | undefined, standing: any): boolean {
  const top = factionId === undefined ? undefined : tops[String(factionId)]
  const level = standing?.renown_level ?? standing?.tier

  if (typeof top === 'number' && typeof level === 'number') {
    return level >= top
  }

  return isExalted(standing)
}

/**
 * One character's place on a ladder, as the payload reports it: the tier of the step they stand on (or
 * the level of a renown ladder), the progress inside that step, and the width of the step. The names are
 * the payload's own field names on purpose, because `isExalted` and `isReputationMaxed` read them.
 */
export interface CharacterStanding {
  tier?: number
  renown_level?: number
  raw: number
  value: number
  max: number
  /** The step as the payload names it, in the language the document was read in. */
  name: string
}

/**
 * The character's own reputations, keyed by faction id - the one call a journal costs.
 *
 * The document is the character's own list and nothing else: Blizzard reports only the factions the
 * character has a record with, which is why a shelf reads factions against the atlas rather than against
 * this map - a faction missing from it is one the character has never touched, not one they cannot raise.
 */
export async function getReputationStandings(
  region: string,
  realm: string,
  name: string,
  locale: string
): Promise<Map<number, CharacterStanding>> {
  const token = await getBlizzardToken(region)
  const url =
    `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${encodeURIComponent(name)}` +
    `/reputations?namespace=profile-${region}&locale=${locale}`

  const data = await $fetch<{ reputations?: any[] }>(url, { headers: { Authorization: `Bearer ${token}` } })
  const standings = new Map<number, CharacterStanding>()

  for (const entry of data?.reputations || []) {
    const id = entry?.faction?.id
    if (typeof id !== 'number') continue

    const standing = entry.standing || {}
    standings.set(id, {
      ...(typeof standing.tier === 'number' ? { tier: standing.tier } : {}),
      ...(typeof standing.renown_level === 'number' ? { renown_level: standing.renown_level } : {}),
      raw: Number(standing.raw || 0),
      value: Number(standing.value || 0),
      max: Number(standing.max || 0),
      name: String(standing.name || '')
    })
  }

  return standings
}

/** A heading or a faction's name in the page's language, English standing in for the rest. */
function atlasLabel(faction: AtlasFaction | undefined, russian: boolean): string {
  if (!faction) return ''

  return (russian ? faction.ru || faction.en : faction.en || faction.ru).trim()
}

/**
 * The stage a row prints: the step's name in the page's language, and the message key of the fourteen
 * stages the game spells the same way on every ladder it uses them on - which is why the key is read off
 * the atlas (English, whatever language the payload came back in) rather than off the payload.
 *
 * `value` and `max` are the payload's own pair and are what a row prints beside its bar; `level` is the
 * renown level a renown ladder is counted by, and null on every other kind.
 */
function toStanding(
  standing: CharacterStanding,
  ladder: AtlasLadder | null,
  russian: boolean
): ReputationStanding {
  const step = ladder && typeof standing.tier === 'number' ? ladder.names[standing.tier] : undefined
  const named = step ? (russian ? step.ru || step.en : step.en || step.ru).trim() : ''

  return {
    key: step ? REPUTATION_STANDING_KEYS[step.en] ?? '' : '',
    label: named || standing.name,
    value: standing.value,
    max: standing.max,
    level: standing.renown_level ?? null
  }
}

/**
 * The steps of one ladder: the tier table its factions point at, or the levels of a renown ladder.
 *
 * A renown ladder is counted in levels rather than in tiers, and Blizzard reports the level and the points
 * inside it rather than a span - so its steps carry the level alone, and the shelf words them from the
 * message key. Every other ladder is a run of tiers with a name and a span each, which is what a division
 * of a bar is described by.
 */
function stepsOf(faction: AtlasFaction, steps: number, russian: boolean): ReputationStep[] {
  if (faction.renown) {
    return Array.from({ length: steps }, (_, index) => ({
      key: 'reputationsRenown',
      label: '',
      level: index + 1,
      from: null,
      to: null
    }))
  }

  const ladder = faction.ladder === null ? null : LADDERS[String(faction.ladder)] ?? null

  return (ladder?.spans || []).map((span, index) => {
    const name = ladder?.names[index]
    const label = name ? (russian ? name.ru || name.en : name.en || name.ru).trim() : ''

    return {
      key: name ? REPUTATION_STANDING_KEYS[name.en] ?? '' : '',
      label,
      level: null,
      from: span[0],
      to: span[1]
    }
  })
}

/**
 * The key a ladder's ledger is filed under in the journal, building that ledger the first time a row asks
 * for it.
 *
 * A hundred factions stand on the one classic table and a renown ladder is one table per level count, so
 * the steps are read once per ladder rather than once per row - which is what lets every row name its stage
 * and the span it covers without the journal weighing a hundred times as much. A ladder longer than
 * `REPUTATION_MAX_STEPS` is given no ledger at all: its stage is named by the row's own standing instead,
 * and its steps would be carried for the sake of one tooltip.
 */
function ledgerOf(
  faction: AtlasFaction,
  steps: number,
  russian: boolean,
  ledgers: Map<string, ReputationStep[]>
): string {
  const key = faction.renown ? `renown:${faction.top}` : `table:${faction.ladder}`

  if (!ledgers.has(key)) ledgers.set(key, stepsOf(faction, steps, russian))

  return key
}

/**
 * One row of the journal: the faction's name, the stage the character stands on, and the scale of its
 * ladder. Nought comes back for a heading rather than a reputation - an expansion, a side, `Guild` -
 * which is what keeps a heading out of the counts.
 *
 * `percent` and `position` are the same place counted two ways: one stage of a ladder takes an equal share
 * of its bar (eight stages of a classic reputation, thirty levels of a renown faction), so `percent` is
 * what the bar is filled to and `position` is that place in stages - `3.4` is three stages behind the
 * character and four tenths of the one they are standing on, whose span the row names on hover. A ladder
 * whose last step reports no width (`0 / 0` at the top) reads as finished instead.
 */
function toRow(
  id: number,
  russian: boolean,
  standings: Map<number, CharacterStanding>,
  ledgers: Map<string, ReputationStep[]>
): ReputationRow | null {
  const faction = FACTIONS[String(id)]
  if (!faction || !faction.top) return null

  const standing = standings.get(id) ?? null
  const ladder = faction.ladder === null ? null : LADDERS[String(faction.ladder)] ?? null
  const steps = faction.renown ? faction.top : ladder?.spans.length || faction.top + 1
  const finished = Boolean(standing) && isReputationMaxed(id, standing)

  const index = standing ? (faction.renown ? standing.renown_level ?? 0 : standing.tier ?? 0) : 0
  const within = standing && standing.max > 0 ? Math.min(1, standing.value / standing.max) : 0
  const position = finished ? steps : standing ? Math.min(index + within, steps) : 0

  return {
    id,
    name: atlasLabel(faction, russian),
    renown: faction.renown > 0,
    top: faction.top,
    steps,
    ladder: steps <= REPUTATION_MAX_STEPS ? ledgerOf(faction, steps, russian, ledgers) : '',
    standing: standing ? toStanding(standing, ladder, russian) : null,
    // A record at nought - Neutral with nothing paid in - is a faction the character has not started.
    started: (standing?.raw ?? 0) > 0,
    finished,
    percent: Math.round((position / steps) * 100),
    position: Math.round(position * 100) / 100
  }
}

/** A section of `rows`, counted; an empty run is dropped rather than drawn as an empty block. */
function toSection(id: string, label: string, rows: ReputationRow[]): ReputationSection | null {
  if (!rows.length) return null

  return {
    id,
    label,
    rows,
    finished: rows.filter((row) => row.finished).length,
    total: rows.length
  }
}

/**
 * The rows of one heading: the bar the pane draws on the heading itself where it carries one - a renown
 * faction, a garrison, the Tillers and the Anglers, whose sub-rows are the friends under them - and then
 * everything filed under it. Blizzard's tree runs three deep (an expansion, a heading, a faction), and a
 * patch that made it deeper would still draw every faction: a heading below the last level has its rows
 * flattened into its parent's section rather than dropped.
 */
function rowsUnder(node: AtlasNode, rowOf: (id: number | 'other') => ReputationRow | null): ReputationRow[] {
  const rows: ReputationRow[] = []
  const self = rowOf(node.id)
  if (self) rows.push(self)

  for (const child of node.children) {
    if (child.children.length) rows.push(...rowsUnder(child, rowOf))
    else {
      const row = rowOf(child.id)
      if (row) rows.push(row)
    }
  }

  return rows
}

/**
 * One expansion of the journal - or the group the atlas put the factions no expansion claimed into.
 *
 * The order is Blizzard's own, which is the order the game's pane lists them in: a row with no heading
 * over it stays where the tree put it, and a heading that groups rows opens a section of its own at the
 * point it stands. Rows are read against the character's side as they are built - a faction only the
 * other side may raise is not on this character's journal at all, exactly as `server/utils/collections`
 * keeps the other side's items off a shelf - so the counts a heading reads are the counts of what is
 * drawn under it.
 */
function toGroup(
  node: AtlasNode,
  russian: boolean,
  standings: Map<number, CharacterStanding>,
  side: string | null,
  ledgers: Map<string, ReputationStep[]>
): ReputationGroup | null {
  const sections: ReputationSection[] = []
  let run: ReputationRow[] = []

  const labelOf = (id: number | 'other'): string =>
    id === 'other' ? '' : atlasLabel(FACTIONS[String(id)], russian)

  const rowOf = (id: number | 'other'): ReputationRow | null => {
    if (id === 'other') return null
    const entry = FACTIONS[String(id)]
    if (entry?.side && side && entry.side !== side) return null

    return toRow(Number(id), russian, standings, ledgers)
  }

  /** Closes the run of rows Blizzard's tree names no heading over. */
  const flush = (): void => {
    const section = toSection('', '', run)
    if (section) sections.push(section)
    run = []
  }

  // A group that is a reputation itself - a renown faction no expansion claims, `Keg Leg's Crew` - opens
  // with its own bar under its own heading, which is the shape the game's pane draws it in.
  const self = rowOf(node.id)
  if (self) run.push(self)

  for (const child of node.children) {
    if (child.children.length) {
      const section = toSection(String(child.id), labelOf(child.id), rowsUnder(child, rowOf))
      if (!section) continue
      flush()
      sections.push(section)
    } else {
      const row = rowOf(child.id)
      if (row) run.push(row)
    }
  }

  flush()

  const rows = sections.flatMap((section) => section.rows)
  if (!rows.length) return null

  const finished = rows.filter((row) => row.finished).length

  return {
    id: node.id as ReputationGroupId,
    label: labelOf(node.id),
    sections,
    finished,
    started: rows.filter((row) => row.started).length,
    total: rows.length,
    percent: Math.round((finished / rows.length) * 100)
  }
}

/**
 * Assembles the journal of one character: every expansion the pane lists, the headings under it and the
 * factions in those, each with the stage the character stands on and the scale of its ladder, under the
 * running total of what the character has finished.
 *
 * `faction` is the one Blizzard names the character with (`HORDE`, `ALLIANCE`), and it is what keeps the
 * other side's factions off the journal - they are dropped before anything is counted, which is what makes
 * `total` read the same number `reputationTotal` hands the tile above the shelf. A character Blizzard
 * answers `NEUTRAL` for (or a caller that names no faction at all) reads a journal with nothing taken out
 * of it. `standings` is the character's own document, and the factions missing from it are the ones they
 * have never touched: their rows are drawn empty rather than left out, because a journal is a list of what
 * can be done, not only of what has been.
 */
export function buildReputationJournal(
  locale: string,
  standings: Map<number, CharacterStanding>,
  faction?: string | null
): ReputationJournal {
  const russian = locale.startsWith('ru')
  const side = FACTION_SIDE[String(faction || '').toUpperCase()] || null

  /** The ladders the rows are measured against, built as they are asked for and shared between them. */
  const ledgers = new Map<string, ReputationStep[]>()

  const groups: ReputationGroup[] = []
  for (const root of TREE) {
    const group = toGroup(root, russian, standings, side, ledgers)
    if (group) groups.push(group)
  }

  const rows = groups.flatMap((group) => group.sections.flatMap((section) => section.rows))
  const finished = rows.filter((row) => row.finished).length

  return {
    total: rows.length,
    started: rows.filter((row) => row.started).length,
    finished,
    percent: rows.length ? Math.round((finished / rows.length) * 100) : 0,
    renown: rows.filter((row) => row.renown).length,
    groups,
    ledgers: Object.fromEntries(ledgers),
    generatedAt: Date.now()
  }
}

