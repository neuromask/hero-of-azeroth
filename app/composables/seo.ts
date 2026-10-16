import type { MaybeRefOrGetter } from 'vue'

/**
 * `og:locale` is `language_TERRITORY`, while the language of an address is the plain
 * code in its first segment (`/ru/...`), so one has to be mapped onto the other.
 */
const OG_LOCALES: Record<string, string> = { en: 'en_US', ru: 'ru_RU' }

/**
 * The brand every page's title ends with, which reads the same in every language.
 *
 * It is exported rather than kept here because it is not `usePageSeo`'s alone: the structured data of the front door
 * names the site, the character page's own template ends in it, and every one of them has to spell it the same way.
 */
export const SITE_NAME = 'Hero of Azeroth'

/**
 * What parts the site's titles are joined with, in one place for the whole site: `Зал славы - Счёт - Hero of Azeroth`.
 *
 * A title is read in a search result and in a chat window, where the parts are what a reader scans rather than a
 * sentence they parse - so it is the same dash everywhere, and a page that composes a title of its own (the
 * character pages do, their titles ending in the brand) composes it with this. Nothing else about a page is joined
 * with it: a line of figures under a name, a description, a scope label - those are prose and keep their own
 * separator (`·`).
 */
export const TITLE_SEPARATOR = ' - '

/**
 * A page's own name, with the brand after it: what `usePageSeo`'s default template does, offered as a function as
 * well because a page that writes its title whole needs the same join (`app/pages/[region]/[realm]/[name].vue`).
 */
export function titleWithBrand(title?: string): string {
  return title ? `${title}${TITLE_SEPARATOR}${SITE_NAME}` : SITE_NAME
}

/** The card the API renders, announced so a network can lay its preview out. */
const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

interface PageSeoOptions {
  /** What the page is called on its own; the brand is appended to it. */
  title: MaybeRefOrGetter<string>
  /**
   * How a page's own title becomes the document's. The brand is appended by default; a page
   * whose title already reads whole - the character page, which ends in the brand itself -
   * passes its own, so the two are never composed into a title that names the brand twice.
   */
  titleTemplate?: (title?: string) => string
  /** One sentence for a search result and for a link preview. */
  description: MaybeRefOrGetter<string>
  /**
   * The sentence a link preview wears, where it differs from a search result's: the character
   * page prints its statistics as a row of figures behind glyphs, which is what a chat window
   * shows, while a search result wants the same facts spelled out. Falls back to `description`.
   */
  ogDescription?: MaybeRefOrGetter<string>
  /** Preview image, either absolute or relative to the site root. */
  image?: MaybeRefOrGetter<string | undefined>
  /** Overrides the default "title · brand" caption of the preview image. */
  imageAlt?: MaybeRefOrGetter<string>
  imageWidth?: number
  imageHeight?: number
  imageType?: 'image/jpeg' | 'image/gif' | 'image/png' | 'image/webp' | 'image/avif'
  /** Only a page about a person is a `profile`; everything else is a `website`. */
  ogType?: 'website' | 'profile'
  /** Set while the page has nothing to index: an unknown character, a failure. */
  noindex?: MaybeRefOrGetter<boolean>
  /**
   * The schema.org node describing this page. A callback, because the node names
   * the canonical URL, which only this composable works out.
   */
  jsonLd?: (canonical: string) => Record<string, unknown> | null
}

/**
 * The SEO head of a page, in one place for the whole site.
 *
 * Every URL is absolute and built on `siteUrl` from the runtime config rather than on
 * the host the request arrived at: the language is part of the path but the public name
 * of the site is a single one, and a canonical or an `og:image` that took its origin
 * from the request would change with the visitor (a preview build has to never be the
 * host a crawler is sent to).
 */
export function usePageSeo(options: PageSeoOptions) {
  const route = useRoute()
  const { siteUrl } = useRuntimeConfig().public

  /** The language this page is served in, which its own address names. */
  const lang = computed(() => localeFromPath(route.path))

  /**
   * This page in `code`, as an absolute URL on the public host. The language the page
   * currently carries comes off first, so what is left is the page itself.
   */
  const urlFor = (code: string) => new URL(localePath(code, stripLocalePrefix(route.path)), siteUrl).href

  const canonical = computed(() => urlFor(lang.value))

  /**
   * The title as the document and the previews carry it: the page names itself and the template
   * appends the brand, parted from it by the one separator every title of the site is parted by
   * (`TITLE_SEPARATOR`). `og:title` is that same string, because a preview missing its brand reads
   * as a link from nowhere.
   */
  const titleTemplate = options.titleTemplate || ((title?: string) => titleWithBrand(title))
  const fullTitle = computed(() => titleTemplate(toValue(options.title)))

  /** The sentence a preview carries, which is the search one unless a page says otherwise. */
  const shareDescription = computed(() => toValue(options.ogDescription ?? options.description))

  const image = computed(() => {
    const value = options.image ? toValue(options.image) : ''
    return value ? new URL(value, siteUrl).href : undefined
  })

  /** A page without a preview image gets the small card, not the large one. */
  const hasImage = computed(() => Boolean(image.value))

  useSeoMeta({
    title: () => toValue(options.title),
    // The brand is part of every title, so a page only names itself.
    titleTemplate,
    description: () => toValue(options.description),
    // `max-image-preview:large` is what lets a search result show the card instead
    // of a thumbnail of it.
    robots: () =>
      toValue(options.noindex)
        ? 'noindex, nofollow'
        : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',

    ogTitle: () => fullTitle.value,
    ogDescription: () => shareDescription.value,
    ogType: options.ogType || 'website',
    ogUrl: () => canonical.value,
    ogSiteName: SITE_NAME,
    ogLocale: () => OG_LOCALES[lang.value]!,
    // The other languages the very same page exists in.
    ogLocaleAlternate: () =>
      SUPPORTED_LOCALES.filter((code) => code !== lang.value).map((code) => OG_LOCALES[code]!),
    ogImage: () => image.value,
    // The size and the type describe an image; without one they would be tags
    // about nothing, so they are dropped together with it.
    ogImageWidth: () => (hasImage.value ? options.imageWidth || CARD_WIDTH : undefined),
    ogImageHeight: () => (hasImage.value ? options.imageHeight || CARD_HEIGHT : undefined),
    ogImageType: () => (hasImage.value ? options.imageType || 'image/png' : undefined),
    ogImageAlt: () =>
      hasImage.value ? toValue(options.imageAlt) || titleWithBrand(toValue(options.title)) : undefined,

    twitterCard: () => (hasImage.value ? 'summary_large_image' : 'summary'),
    twitterTitle: () => fullTitle.value,
    twitterDescription: () => shareDescription.value,
    twitterImage: () => image.value
  })

  useHead({
    // The i18n module writes `<html lang>` only when it builds the head itself, and
    // here the head is built from the language the address names.
    htmlAttrs: { lang: () => lang.value },

    link: () => [
      { rel: 'canonical' as const, href: canonical.value },
      // The same page in every language, so a crawler serves the copy that matches
      // the visitor and never treats the two as competing pages.
      ...SUPPORTED_LOCALES.map((code) => ({ rel: 'alternate' as const, hreflang: code, href: urlFor(code) })),
      { rel: 'alternate' as const, hreflang: 'x-default', href: urlFor(DEFAULT_LOCALE) }
    ],

    script: () => {
      const data = options.jsonLd?.(canonical.value)
      if (!data) return []

      return [
        {
          type: 'application/ld+json',
          // A `<` in a character name could otherwise close the block.
          innerHTML: JSON.stringify(data).replace(/</g, '\\u003c')
        }
      ]
    }
  })
}