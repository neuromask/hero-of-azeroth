/**
 * The languages the site is served in.
 *
 * The language is the first path segment, and only the non-default one is written out:
 * `/ru/region-eu/gordunni/neromask` is the Russian copy of
 * `/region-eu/gordunni/neromask`. An address therefore says which language it is, and
 * the other copy of the same page is one segment away. `app/composables/urls.ts` builds
 * those addresses; this file only names the languages.
 */
export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = ['en', 'ru'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}