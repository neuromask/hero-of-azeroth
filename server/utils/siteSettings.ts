/**
 * The settings an administrator edits, kept in the site's own database.
 *
 * The store is deliberately one table with one row per *namespace* (`./db`): the panel that writes it and the
 * pages that read it are the only two ends, and a schema of its own per setting would be a migration for every
 * knob the site grows. A namespace holds JSON, which is what lets the first setting (the denominators of the
 * comparison board, `#shared/data/siteSettings`) and the next one (a page's copy) share one table - and the
 * defaults live in `shared/`, in front of this store, so a checkout with no row at all still draws a figure.
 *
 * Who may write is not decided here but one layer out: this module answers the panel's endpoint and the
 * endpoint refuses anybody who is not an administrator (`server/api/admin/settings`). The read, on the other
 * hand, is public on purpose - the board a *stranger* looks at is drawn from these same maxima.
 */
import {
  DEFAULT_ADMIN_BATTLETAGS,
  EDITABLE_METRIC_MAXIMA,
  METRIC_MAXIMA_DEFAULTS,
  type MetricMaxima,
  type SiteSettings,
  type SiteSettingsPatch
} from '#shared/data/siteSettings'
import type { MetricKey } from '#shared/data/historySchema'
// A plain import rather than Nitro's auto-import, so this module works under the unit tests too (see
// `./runtimeEnv`).
import { privateSetting } from './runtimeEnv'
// The clock from `./db` directly; the connection from the auto-imported `useDb()`, which is what lets a test
// point this module at an in-memory database (`test/helpers/memoryDb.ts`).
import { nowSec } from './db'

/** The rows the settings are kept in: one per namespace, its value held as JSON. */
const METRIC_MAXIMA_KEY = 'metricMaxima'
const CONTENT_KEY = 'content'
const ADMINS_KEY = 'admins'

/** The names the store knows, and the shape of a copy key: a slug (`page.section.heading`). */
const EDITABLE_MAXIMA: ReadonlySet<string> = new Set<string>(EDITABLE_METRIC_MAXIMA)
const CONTENT_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i
/** How long one stored paragraph may be: a page's copy, not a document. */
const CONTENT_VALUE_LIMIT = 4000

/** A namespace as it is on file, or `null` where nothing has ever written one. */
function readRow(key: string): unknown {
  const row = useDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return null

  try {
    return JSON.parse(row.value)
  } catch {
    // A row a hand edit or a rolled-back build left unreadable is a namespace with nothing in it rather than a
    // site that cannot start - the defaults in front of this store then stand, which is the whole point of them.
    return null
  }
}

/** Writes one namespace, replacing whatever was there. */
function writeRow(key: string, value: unknown): void {
  useDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), nowSec())
}

/** The maxima on file, laid over the ones the site ships with. */
export function getMetricMaxima(): MetricMaxima {
  const maxima: MetricMaxima = { ...METRIC_MAXIMA_DEFAULTS }
  const stored = readRow(METRIC_MAXIMA_KEY)

  if (!stored || typeof stored !== 'object') return maxima

  for (const [metric, value] of Object.entries(stored as Record<string, unknown>)) {
    if (!EDITABLE_MAXIMA.has(metric)) continue

    // A stored `null` is a metric the operator has left without a scale, so the default is taken *away* -
    // which is what separates "cleared" from "never touched".
    if (value === null) delete maxima[metric as MetricKey]
    else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      maxima[metric as MetricKey] = Math.round(value)
    }
  }

  return maxima
}

/** The page copy on file, which is empty until something is stored - a page's own words stand until then. */
export function getContent(): Record<string, string> {
  const stored = readRow(CONTENT_KEY)
  if (!stored || typeof stored !== 'object') return {}

  const content: Record<string, string> = {}

  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (CONTENT_KEY_PATTERN.test(key) && typeof value === 'string' && value.length <= CONTENT_VALUE_LIMIT) {
      content[key] = value
    }
  }

  return content
}

/** Everything a page may read, which is what `/api/settings` answers with. */
export function getSiteSettings(): SiteSettings {
  return { metricMaxima: getMetricMaxima(), content: getContent() }
}

/**
 * Writes a patch, and answers with the settings as they now stand.
 *
 * Every half is optional and every half *replaces*: a patch that names the maxima writes the whole set of them
 * (the panel sends every field it draws, cleared ones included), and one that names the copy writes the whole
 * map. Only the namespaces a patch mentions are touched, so a save from the maxima form cannot blank a
 * paragraph nobody was looking at - and a value that is not a name the store knows, or is not a number or a
 * sentence, is *dropped* rather than refused: a request is not a reason to take the panel down.
 */
export function saveSiteSettings(patch: SiteSettingsPatch): SiteSettings {
  if (patch.metricMaxima) {
    const maxima: Record<string, number | null> = {}

    for (const [metric, value] of Object.entries(patch.metricMaxima)) {
      if (!EDITABLE_MAXIMA.has(metric)) continue

      if (value === null) maxima[metric] = null
      else if (typeof value === 'number' && Number.isFinite(value) && value > 0) maxima[metric] = Math.round(value)
    }

    writeRow(METRIC_MAXIMA_KEY, maxima)
  }

  if (patch.content) {
    const content: Record<string, string> = {}

    for (const [key, value] of Object.entries(patch.content)) {
      if (CONTENT_KEY_PATTERN.test(key) && typeof value === 'string' && value.length <= CONTENT_VALUE_LIMIT) {
        content[key] = value
      }
    }

    writeRow(CONTENT_KEY, content)
  }

  return getSiteSettings()
}

/**
 * The BattleTags that may open the panel.
 *
 * Three sources, joined: the environment (a host's own answer, `NUXT_ADMIN_BATTLETAGS`), the stored row (the
 * panel's, for a copy that has outgrown the file) and the default the site ships with. They are *additions*
 * rather than replacements, so a host that names nobody cannot lock the panel's owner out of it.
 */
export function adminBattletags(): string[] {
  const fromEnv = privateSetting('NUXT_ADMIN_BATTLETAGS')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const stored = readRow(ADMINS_KEY)
  const fromStore = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : []

  return [...new Set([...fromEnv, ...fromStore, ...DEFAULT_ADMIN_BATTLETAGS])]
}

/**
 * Whether an account is an administrator.
 *
 * Compared without case, because the case a BattleTag is spelled in is Battle.net's to decide and a panel that
 * hinged on it would lock its owner out over a capital letter.
 */
export function isAdmin(battletag: string | null | undefined): boolean {
  if (!battletag) return false

  const tag = battletag.toLowerCase()
  return adminBattletags().some((entry) => entry.toLowerCase() === tag)
}
