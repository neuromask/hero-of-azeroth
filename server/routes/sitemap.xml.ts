/**
 * The sitemap `robots.txt` points crawlers at.
 *
 * It lists two kinds of page: the front door, which is the only address that exists without
 * having been searched for, and every character the site has rendered. A character page has no
 * registry to be read from - the game has no list of its players - so the site keeps its own,
 * written the moment a lookup finds somebody (see `server/utils/characterIndex.ts`), and hands
 * that list to a crawler here.
 *
 * A page is listed once, not once per language: the `<loc>` names it in the default language and
 * the languages it also exists in are `xhtml:link` alternates inside that same `<url>`, which is
 * how a crawler learns they are the same page rather than duplicates. Only the non-default
 * language carries its code in the address, so the English copy is the plain one and the Russian
 * copy sits under `/ru`.
 *
 * The XML carries a stylesheet instruction, so a browser open on the address paints the dark
 * table below instead of showing raw tags (see `public/sitemap.xsl`). A crawler ignores the
 * instruction and reads the tags, which is what it was always going to do.
 */

/** Mirrors `SUPPORTED_LOCALES` in `app/composables/lang.ts`. */
const LANGUAGES = ['en', 'ru'] as const

/** Mirrors `DEFAULT_LOCALE` in `app/composables/lang.ts`. */
const DEFAULT_LANGUAGE = 'en'

/**
 * A sitemap may name fifty thousand URLs and each character is one per language, so this is the
 * most characters whose pages the map will spell out.
 */
const CHARACTER_LIMIT = 20000

/** Text with the characters that would otherwise end an XML tag escaped. */
function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default defineEventHandler(async (event) => {
  const siteUrl = String(useRuntimeConfig(event).public.siteUrl || '').replace(/\/+$/, '')

  /**
   * The pages to list, each with the day it was last seen when the site knows one. The front
   * door never changes; a character page carries the day of the search that last reached it.
   */
  const characters = (await readCharacterIndex()).slice(0, CHARACTER_LIMIT)
  const pages = [
    { path: '/', lastmod: '' },
    ...characters.map((entry) => ({
      path: `/${regionPath(entry.region)}/${entry.realm}/${encodeURIComponent(entry.name)}`,
      lastmod: entry.updatedAt
    }))
  ]

  /**
   * A page as an absolute URL in `language`. The front door is the bare host in English
   * and `/ru` in Russian - no trailing slash, which is the address the page's own
   * canonical link names.
   */
  const urlFor = (path: string, language: string) => {
    const prefix = language === DEFAULT_LANGUAGE ? '' : `/${language}`
    if (path === '/') return prefix ? `${siteUrl}${prefix}` : `${siteUrl}/`
    return `${siteUrl}${prefix}${path}`
  }

  /**
   * One `<url>` per page. Its `<loc>` names the page in the default language, and the languages
   * the same page also exists in ride along as `xhtml:link` alternates inside that same block,
   * so the map never names a page twice.
   */
  const entries = pages.map(({ path, lastmod }) => {
    const alternates = [
      ...LANGUAGES.map((code) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${xml(urlFor(path, code))}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${xml(urlFor(path, DEFAULT_LANGUAGE))}"/>`
    ].join('\n')

    const changed = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''
    return `  <url>\n    <loc>${xml(urlFor(path, DEFAULT_LANGUAGE))}</loc>${changed}\n${alternates}\n  </url>`
  })

  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  // The list grows as the site is searched, so it is cached for an hour rather than a day.
  setHeader(event, 'cache-control', 'public, max-age=3600')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`
})