/**
 * The site's own settings, as a page reads them.
 *
 * One request for the whole site, keyed `site-settings`, so the admin panel's form and the comparison board's
 * bars are drawn from one answer - and so a save followed by a `refresh()` of this same key is enough to move
 * both, rather than a board that holds the numbers it was rendered with (`app/pages/admin.vue`).
 *
 * The default is the maxima the *site ships with* rather than an empty map: `server/api/settings` already lays
 * the stored values over them, and the shipped ones are the honest answer for the moment before that answer
 * lands - a board that drew no bars while it waited would look like a copy without a panel at all.
 */
import { METRIC_MAXIMA_DEFAULTS, type SiteSettings } from '#shared/data/siteSettings'

export function useSiteSettings() {
  return useFetch<SiteSettings>('/api/settings', {
    key: 'site-settings',
    default: () => ({ metricMaxima: { ...METRIC_MAXIMA_DEFAULTS }, content: {} })
  })
}
