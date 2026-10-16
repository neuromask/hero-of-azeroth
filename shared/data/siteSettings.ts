/**
 * The settings an administrator edits, and the shape they travel in.
 *
 * Two things live here, and they are the same thing twice: the *names* of the settings - so the panel that
 * writes one and the page that reads it cannot spell a key differently - and the values a copy of the site
 * ships with, so a checkout that has never been opened in a panel still draws every figure it knows how to.
 *
 * The first setting is a figure's denominator. Most of the site's figures carry their own: a collection is
 * measured against the size Blizzard (or the Armoury) states for it, and every one of those travels with the
 * reading (`CharacterStat` in `server/utils/blizzard`). The rest are counts with no ceiling anybody publishes
 * - how many quests have been written, how many appearance sources exist, how many recipes a profession can
 * hold - and the site's own answer to a number it cannot read is a *snapshot*: a value an operator states,
 * corrected when a patch moves it (`METRIC_MAXIMA_DEFAULTS` below, the way `server/utils/armoury-totals.json`
 * already stands in for the mount journal). A metric with no maximum at all is a metric with no scale: the
 * board prints its figure and draws no bar, because a bar measured against an invented end is a lie drawn in
 * gold.
 *
 * Nothing here is a rating or a formula: those are the server's alone (`server/utils/playerScore`), and this
 * file is deliberately about a number an *administrator* owns rather than one the site computes.
 */
import type { MetricKey } from './historySchema'

/**
 * The denominator of each figure whose size the site has to be told rather than read.
 *
 * `Partial`, because the shape is one of *overrides*: a metric absent from it is a metric measured against
 * whatever its own row carries - the collections, whose totals come with the reading - and a metric set to
 * `null` is one the operator has deliberately left without a scale. A maximum a figure has outgrown is not a
 * problem to fix here: the bar's own rule clamps at a hundred percent (`collectionPercent` in
 * `shared/utils/wow-quality`), and the caption prints the two real figures, so a patch that adds quests is
 * visible in the caption before it is corrected here.
 */
export type MetricMaxima = Partial<Record<MetricKey, number>>

/**
 * The maxima this copy of the site ships with.
 *
 * The three figures the panel exists for - and the three that no collection of the site carries a size for.
 * They are the operator's numbers, read off a fully collected account rather than off any index: Blizzard
 * publishes the appetite of a wardrobe, a quest log or a recipe book nowhere, which is exactly why they are
 * settings rather than constants.
 */
export const METRIC_MAXIMA_DEFAULTS: MetricMaxima = {
  transmogs: 50_000,
  quests: 27_500,
  recipes: 11_000
}

/**
 * The maxima the panel offers a field for, in the order it draws them.
 *
 * One list, so a metric that gains a maximum is added here and nowhere else: the panel's groups are built
 * from it, and its own label is the message key the rest of the site already names the figure by
 * (`METRIC_KEYS` is that same vocabulary, and the locale files carry one key per metric).
 */
export const EDITABLE_METRIC_MAXIMA: readonly MetricKey[] = ['transmogs', 'quests', 'recipes']

/**
 * The public half of the settings: what every page of the site may read.
 *
 * `content` is the foundation the panel grows into - a page's copy, keyed `page.slug` so a heading or a
 * paragraph can be reworded without a deploy. It is empty until something reads it, which is what keeps this
 * a store rather than a second set of locale files.
 */
export interface SiteSettings {
  metricMaxima: MetricMaxima
  content: Record<string, string>
}

/**
 * What the panel sends when it saves: the same two halves, with the maxima a field was cleared in spelled
 * `null` rather than left out - an absent metric keeps its own total and a `null` one is left without a scale,
 * and the two would be the same request if a cleared field simply disappeared.
 */
export interface SiteSettingsPatch {
  metricMaxima?: Record<string, number | null>
  content?: Record<string, string>
}

/**
 * The Battletags that open the admin panel.
 *
 * A BattleTag is a name a reader can change, so this is a *default* rather than the rule: the accounts listed
 * here and in `NUXT_ADMIN_BATTLETAGS` (and in the stored `admins` row) may sign in and open the panel, and the
 * panel's own data is served by an endpoint that refuses everybody else (`server/api/admin/settings`).
 */
export const DEFAULT_ADMIN_BATTLETAGS: readonly string[] = ['neuromask#2809']
