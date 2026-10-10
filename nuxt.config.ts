/**
 * Public facts about where this copy of the site lives. Both can be overridden from
 * the environment, so a staging copy never advertises the production host in its
 * canonical URLs, its sitemap or its tag manager.
 */
const SITE_URL = (process.env.NUXT_PUBLIC_SITE_URL || 'https://heroofazeroth.com').replace(/\/+$/, '')
const GTM_ID = process.env.NUXT_PUBLIC_GTM_ID || 'GTM-WXMVB755'

/**
 * The port the server binds.
 *
 * Nitro's `node-server` entry listens on `NITRO_PORT`, else on `PORT`, else on 3000,
 * and that last fallback is hard-coded: no Nitro setting changes it. This host runs
 * a second application on 3000, so the number lives here and `server/plugins/port.ts`
 * hands it to Nitro when the host names no port of its own - `PORT` and `NITRO_PORT`
 * still win, which keeps a panel or a process manager in charge where it assigns one.
 */
const PORT = 3100

/**
 * Development's port is pinned by the command, not by this file.
 *
 * `nuxt dev` resolves its port as `--port`, then `NUXT_PORT`, then `NITRO_PORT`, then `PORT`, and
 * only then `devServer.port` - and it reads those variables *before* this config is loaded, so
 * nothing here can win against a stray `PORT` inherited from another project or an editor. That is
 * why `npm run dev` is `nuxt dev --port 3100`: the CLI argument is the one answer nothing else can
 * move, and the OAuth callback is registered against `http://localhost:3100`.
 */

/**
 * Google Tag Manager. The loader goes into `<head>` and Nitro prints the
 * `<noscript>` half right after `<body>` (see `app.head.noscript`), which is the
 * position Google asks for. The container id is interpolated into both, so the
 * snippet itself stays as it came out of the GTM console.
 */
const GTM_LOADER = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`

const GTM_FRAME = `<iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden" title="Google Tag Manager"></iframe>`

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxtjs/i18n',
    '@pinia/nuxt'
  ],
  runtimeConfig: {
    // Read by `server/plugins/port.ts`, which is the port the built server binds
    // when neither `PORT` nor `NITRO_PORT` is set on the host.
    port: PORT,
    blizzardClientId: process.env.NUXT_BLIZZARD_CLIENT_ID,
    blizzardClientSecret: process.env.NUXT_BLIZZARD_CLIENT_SECRET,
    /**
     * The secret the sign-in cookie is sealed with (h3 `useSession` -> iron). Public game data
     * still rides the client-credentials client above; this one is only for the reader's own
     * session, so it is a secret of the site rather than of the Battle.net app.
     */
    sessionPassword: process.env.NUXT_SESSION_PASSWORD,
    /**
     * The OAuth callback, when it has to be named rather than worked out. Left unset, the callback
     * is the site's own host plus `/api/auth/callback` - except on a local address, where it is the
     * address the browser is actually reading (see `server/utils/bnetOAuth.ts`), because a
     * development sign-in must come back to the development server rather than to production.
     */
    oauthRedirectUri: process.env.NUXT_OAUTH_REDIRECT_URI,
    public: {
      // Absolute host of the public site: canonical URLs, hreflang links, the
      // sitemap and the structured data are all built on it, so none of them
      // depends on the host a request happened to arrive at.
      siteUrl: SITE_URL,
      gtmId: GTM_ID
    }
  },
  css: ['~/assets/css/main.css'],
  /**
   * Where a component is picked up from. `app/components` is scanned the way Nuxt scans it by
   * default - the name of a sub-folder becomes a prefix - and the leaderboard's own folder is
   * scanned without one, because the components in it are already named in full
   * (`LeaderboardTable`), so a prefix would only spell the word twice.
   */
  components: [
    { path: '~/components', pathPrefix: true },
    { path: '~/components/leaderboard', pathPrefix: false }
  ],
  /** `nuxt dev` (and `nuxt preview`, which runs the built server) on the same port. */
  devServer: { port: PORT },
  /**
   * Vite's own server, should it ever be the one that listens, is not allowed to drift either.
   * Nuxt's dev server is the listener (see the port note above), so this is the belt to that
   * braces - a Vite that opened 3101 instead of failing would break the same callback.
   */
  vite: { server: { strictPort: true } },
  /**
   * The head tags that belong to the site rather than to a page: the tag manager,
   * the icons a browser and a crawler look for, and the `theme-color` a mobile
   * browser paints its bars with (the page background is `#080a0f`). A page adds
   * its own title, canonical and structured data through `usePageSeo`.
   */
  app: {
    head: {
      meta: [
        { name: 'theme-color', content: '#080a0f' },
        { name: 'format-detection', content: 'telephone=no' }
      ],
      link: [
        // Gilroy, the site's typeface, is preloaded in the two weights a first paint is set
        // in - the body copy and the headings - so the browser starts fetching them while the
        // stylesheet is still being parsed. Without this the text paints in the fallback face
        // and reflows into Gilroy a moment later, which is the flash and the shift preload
        // exists to remove. `crossorigin` is not optional: a font is fetched as a CORS
        // resource, and a preload opened without credentials is a second, discarded request.
        { rel: 'preload', href: '/fonts/gilroy/Gilroy-Regular.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' },
        { rel: 'preload', href: '/fonts/gilroy/Gilroy-Bold.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' },
        // The SVG is the icon a modern browser takes: it scales to any size and can answer a
        // dark-mode media query. The `.ico` beside it is the fallback for the ones that cannot.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: 'any' },
        // iOS ignores the SVG when the site is added to the home screen, so it is handed a
        // raster icon of its own, 180x180, the size it scales from.
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        // Android reads the manifest for the name, the icons and the colours of an installed copy.
        { rel: 'manifest', href: '/site.webmanifest' },
        { rel: 'sitemap', type: 'application/xml', href: '/sitemap.xml' },
        // The container is fetched on every page view, so the connection is opened
        // while the page itself is still parsing.
        { rel: 'preconnect', href: 'https://www.googletagmanager.com' }
      ],
      script: [{ innerHTML: GTM_LOADER }],
      // GTM wants this immediately after `<body>`; `bodyOpen` is the position
      // Nitro prints before the app markup.
      noscript: [{ tagPosition: 'bodyOpen', innerHTML: GTM_FRAME }]
    }
  },
  i18n: {
    locales: [
      { code: 'en', iso: 'en-US', name: 'English', file: 'en.json' },
      { code: 'ru', iso: 'ru-RU', name: 'Русский', file: 'ru.json' }
    ],
    lazy: true,
    langDir: 'locales',
    // The language is the first path segment and only Russian spells one out:
    // /region-eu/gordunni/neromask is English, /ru/region-eu/gordunni/neromask is
    // Russian. `no_prefix` keeps i18n out of the router: the pages carry their own
    // language (see `app/pages/index.vue`) and the middleware applies it.
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false
  },
  /**
   * The character card draws the same SVGs the page shows from `~/assets/icons`.
   * A deployment ships `.output` alone, so there is no `app/` directory next to
   * the running server: Nitro bundles every `serverAssets` folder into the build,
   * which is what makes the artwork readable on the host. `dir` is relative to
   * the `server/` directory.
   */
  nitro: {
    serverAssets: [{ baseName: 'icons', dir: '../app/assets/icons' }],
    /**
     * Where the characters the site has rendered are kept, which is what the sitemap is
     * built from (see `server/utils/characterIndex.ts`). An `fsLite` mount writes each key
     * as a file under `base`, and the list is written under the key `characters.json`, so
     * it lands in `server/data/characters.json` beside the source: one document, read by
     * the sitemap and rewritten whenever a character is seen for the first time.
     */
    storage: {
      /**
       * Where a cached endpoint's answers are kept. `memory` is the whole point of the mount: the
       * hall of fame (`/api/leaderboard`) is served from here, and the promise that page makes is
       * that a reader costs a few milliseconds and no disk at all. A restart empties it, which
       * costs one recompute from the in-process snapshot (`server/utils/leaderboardStorage.ts`)
       * rather than a read of Blizzard or of a file.
       */
      cache: { driver: 'memory' },
      characters: { driver: 'fsLite', base: './server/data' }
    },
    /**
     * The same for `nuxt dev`, which otherwise keeps its cache on disk (`.nuxt/cache`) whatever
     * `storage` above says. With this the two environments answer from the same place, so what is
     * measured locally is what the host does - and no cache file is written into the project while
     * the server is being watched.
     */
    devStorage: {
      cache: { driver: 'memory' }
    }
  }
})