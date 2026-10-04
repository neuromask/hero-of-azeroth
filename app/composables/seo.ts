import type { MaybeRefOrGetter } from 'vue'

/**
 * `og:locale` is `language_TERRITORY`, while a URL of this site carries the plain
 * language code (`?lang=ru`), so one has to be mapped onto the other.
 */
const OG_LOCALES: Record<string, string> = { en: 'en_US', ru: 'ru_RU' }

/** The brand, which reads the same in every language. */
const SITE_NAME = 'HeroOfAzeroth'

/** The card the API renders, announced so a network can lay its preview out. */
const CARD_WIDTH = 1200
const CARD_HEIGHT = 630

interface PageSeoOptions {
  /** What the page is called on its own; the brand is appended to it. */
  title: MaybeRefOrGetter<string>
  /** One sentence for a search result and for a link preview. */
  description: MaybeRefOrGetter<string>
  /** Preview image, either absolute or relative to the site root. */
  image?: MaybeRefOrGetter<string | undefined>
  /** Overrides the default "title · brand" caption of the preview image. */
  imageAlt?: MaybeRefOrGetter<string>
  imageWidth?: number
  imageHeight?: number
  imageType?: string
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
 * Every URL is absolute and built on `siteUrl` from the runtime config rather than
 * on the host the request arrived at: the language travels in `?lang=`, the public
 * name of the site is a single one, and a canonical or an `og:image` that took its
 * origin from the request would change with the visitor (a preview build has to
 * never be the host a crawler is sent to).
 */
export function usePageSeo(options: PageSeoOptions) {
  const route = useRoute()
  const { siteUrl } = useRuntimeConfig().public

  /** The language the URL asked for, which is the one the page rendered in. */
  const lang = computed(() => (isAppLocale(route.query.lang) ? route.query.lang : DEFAULT_LOCALE))

  /** This page in `code`, as an absolute URL on the public host. */
  const urlFor = (code: string) => {
    const url = new URL(route.path, siteUrl)

    for (const [key, value] of Object.entries(langQuery(code))) {
      url.searchParams.set(key, value)
    }

    return url.href
  }

  const canonical = computed(() => urlFor(lang.value))

  const image = computed(() => {
    const value = options.image ? toValue(options.image) : ''
    return value ? new URL(value, siteUrl).href : undefined
  })

  /** A page without a preview image gets the small card, not the large one. */
  const hasImage = computed(() => Boolean(image.value))

  useSeoMeta({
    title: () => toValue(options.title),
    // The brand is part of every title, so a page only names itself.
    titleTemplate: (title) => `${title} · ${SITE_NAME}`,
    description: () => toValue(options.description),
    // `max-image-preview:large` is what lets a search result show the card instead
    // of a thumbnail of it.
    robots: () =>
      toValue(options.noindex)
        ? 'noindex, nofollow'
        : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',

    ogTitle: () => toValue(options.title),
    ogDescription: () => toValue(options.description),
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
      hasImage.value
        ? toValue(options.imageAlt) || `${toValue(options.title)} · ${SITE_NAME}`
        : undefined,

    twitterCard: () => (hasImage.value ? 'summary_large_image' : 'summary'),
    twitterTitle: () => toValue(options.title),
    twitterDescription: () => toValue(options.description),
    twitterImage: () => image.value
  })

  useHead({
    // The i18n module writes `<html lang>` only when it builds the head itself,
    // and here the head is built from the `?lang=` in the URL.
    htmlAttrs: { lang: () => lang.value },

    link: () => [
      { rel: 'canonical', href: canonical.value },
      // The same page in every language, so a crawler serves the copy that matches
      // the visitor and never treats the two as competing pages.
      ...SUPPORTED_LOCALES.map((code) => ({ rel: 'alternate', hreflang: code, href: urlFor(code) })),
      { rel: 'alternate', hreflang: 'x-default', href: urlFor(DEFAULT_LOCALE) }
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