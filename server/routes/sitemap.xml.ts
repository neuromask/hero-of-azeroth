/**
 * The sitemap `robots.txt` points crawlers at.
 *
 * Only what can be written down without guessing is listed here: the home page and
 * the characters of the configured warband. Any other character page is reached
 * through the search form, and each one names itself with a canonical URL and
 * hreflang links, so a crawler picks those up while following links.
 *
 * Every page appears once per language and each copy names the others, which is how
 * a crawler learns the two are the same page in different languages rather than
 * duplicates of each other.
 */

/** Mirrors `SUPPORTED_LOCALES` in `app/composables/lang.ts`. */
const LANGUAGES = ['en', 'ru'] as const

/** Mirrors `DEFAULT_LOCALE` in `app/composables/lang.ts`. */
const DEFAULT_LANGUAGE = 'en'

export default defineEventHandler((event) => {
  const siteUrl = String(useRuntimeConfig(event).public.siteUrl || '').replace(/\/+$/, '')

  /** The site's own pages: the front door, then the warband's characters. */
  const paths = [
    '/',
    ...warbandMembers().map(
      (member) => `/${member.region}/${member.realm}/${encodeURIComponent(member.name)}`
    )
  ]

  /** A page as an absolute URL in `language` (the default one carries no query). */
  const urlFor = (path: string, language: string) =>
    `${siteUrl}${path}${language === DEFAULT_LANGUAGE ? '' : `?lang=${language}`}`

  const entries = paths.flatMap((path) =>
    LANGUAGES.map((language) => {
      const alternates = [
        ...LANGUAGES.map(
          (code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${urlFor(path, code)}"/>`
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${urlFor(path, DEFAULT_LANGUAGE)}"/>`
      ].join('\n')

      return `  <url>\n    <loc>${urlFor(path, language)}</loc>\n${alternates}\n  </url>`
    })
  )

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  // The list only changes when the warband does, so a day of caching costs nothing.
  setHeader(event, 'cache-control', 'public, max-age=86400')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`
})