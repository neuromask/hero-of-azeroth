/**
 * The addresses a page had before the region and the language moved.
 *
 * A character page used to be `/eu/gordunni/neromask` with the language in the query
 * (`?lang=ru`), and is now `/ru/region-eu/gordunni/neromask`. A crawler and a visitor
 * both still hold the old ones, so each is answered with a permanent redirect rather
 * than a 404 - and the language leaves the query, where it no longer means anything.
 */

/** `/eu/gordunni/neromask`: the region as the first segment used to spell it. */
const LEGACY_REGION = /^\/(eu|us)\/([^/]+)\/([^/]+)\/?$/

/** `/ru/...` or `/en/...`: the language the first segment names, when it names one. */
const LOCALE_PREFIX = /^\/(ru|en)(?=\/|$)/

export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const path = url.pathname

  // The JSON endpoints, the bundles and the files at the root keep the paths they have.
  if (path.startsWith('/api/') || path.startsWith('/_nuxt/') || path.startsWith('/__')) return

  const asked = url.searchParams.get('lang')
  const onPath = LOCALE_PREFIX.exec(path)?.[1] || ''
  const legacy = LEGACY_REGION.exec(path)

  // The page without its language, which is what the target is rebuilt from.
  const base = legacy
    ? `/${regionPath(legacy[1] || '')}/${legacy[2]}/${legacy[3]}`
    : path.replace(LOCALE_PREFIX, '') || '/'

  // `?lang=` is how the language used to be asked for; without it the path decides.
  const language = asked === 'ru' || asked === 'en' ? asked : onPath || 'en'
  const target = language === 'ru' ? (base === '/' ? '/ru' : `/ru${base}`) : base

  // Nothing to say when the address is already the one it should be, and a query that
  // meant a language always is: dropping it is the whole point of the redirect.
  if (target === path && !asked) return

  return sendRedirect(event, target, 301)
})