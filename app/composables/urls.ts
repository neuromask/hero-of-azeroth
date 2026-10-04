/**
 * The shape of the site's addresses.
 *
 * A character page is `/language/region-eu/realm/name`, and only the non-default
 * language is spelled out: English lives at `/region-eu/gordunni/neromask` and Russian
 * at `/ru/region-eu/gordunni/neromask`. A default language that names itself would
 * lengthen every shared link without saying anything, and one spelling per page is what
 * keeps a crawler from reading two addresses as two pages.
 *
 * The pages serve the Russian address as an alias of the English one and the middleware
 * applies the language an address names; this file is only the strings a link is built
 * from.
 */
import type { AppLocale } from './lang'

/** Blizzard regions the site serves, as a page spells them. */
export const REGIONS = ['eu', 'us'] as const

export type Region = (typeof REGIONS)[number]

/** The region in an address: `eu` is served as `region-eu`. */
export function regionPath(region: string): string {
  return `region-${region}`
}

/** The region an address segment names, or an empty string when it names none. */
export function regionFromPath(value: string): Region | '' {
  const code = String(value || '').replace(/^region-/, '').toLowerCase()
  return (REGIONS as readonly string[]).includes(code) ? (code as Region) : ''
}

/** `path` as `locale` serves it: `/ru/region-eu/...`, `/region-eu/...` in English. */
export function localePath(locale: string, path: string): string {
  const clean = path && !path.startsWith('/') ? `/${path}` : path || '/'
  if (locale === DEFAULT_LOCALE) return clean
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`
}

/** The language an address is served in: its first segment when that names one. */
export function localeFromPath(path: string): AppLocale {
  const segment = (String(path || '').split('/')[1] || '').toLowerCase()
  return isAppLocale(segment) ? segment : DEFAULT_LOCALE
}

/** The same page without the language it happens to be served in. */
export function stripLocalePrefix(path: string): string {
  const prefix = String(path || '').split('/')[1] || ''
  if (!isAppLocale(prefix)) return path || '/'
  return path.slice(prefix.length + 1) || '/'
}

/**
 * Returns an in-app URL for `path` in the language the visitor is browsing in, so an
 * internal link never drops it.
 */
export function useLocaleUrl() {
  const { locale } = useI18n()

  return (path: string): string => localePath(locale.value, path)
}