/**
 * The site language travels in the URL as `?lang=<code>` rather than as a path
 * prefix, because the first path segment is reserved for the region
 * (/eu/gordunni/neromask). English is the default, so `?lang` only ever appears
 * for the other languages – that keeps shared links readable and makes every
 * request render in the same language on the server and in the browser.
 */
export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = ['en', 'ru'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Query object carrying `locale` in the URL (empty for the default locale). */
export function langQuery(locale: string): Record<string, string> {
  return locale && locale !== DEFAULT_LOCALE ? { lang: locale } : {}
}

/**
 * Returns an in-app URL for `path` with the current language appended, so
 * internal links never drop the language the visitor is browsing in.
 */
export function useLocaleUrl() {
  const { locale } = useI18n()

  return (path: string): string => {
    const query = new URLSearchParams(langQuery(locale.value)).toString()
    return query ? `${path}?${query}` : path
  }
}
