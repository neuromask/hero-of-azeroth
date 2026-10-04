export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss',
    '@nuxtjs/i18n',
    '@pinia/nuxt'
  ],
  runtimeConfig: {
    blizzardClientId: process.env.NUXT_BLIZZARD_CLIENT_ID,
    blizzardClientSecret: process.env.NUXT_BLIZZARD_CLIENT_SECRET,
    // The account's own characters (comma separated `region/realm/name`), whose
    // mounts and reputations are merged into every page of that account: Blizzard
    // reports those two collections per character while the game shows the
    // account-wide journal. Empty means "report the character as it arrives".
    warbandCharacters: process.env.NUXT_WARBAND_CHARACTERS || ''
  },
  css: ['~/assets/css/main.css'],
  i18n: {
    locales: [
      { code: 'en', iso: 'en-US', name: 'English', file: 'en.json' },
      { code: 'ru', iso: 'ru-RU', name: 'Русский', file: 'ru.json' }
    ],
    lazy: true,
    langDir: 'locales',
    // The language travels in the URL as ?lang=ru (English by default) instead of
    // as a path prefix, which frees the first path segment for the region:
    // /eu/gordunni/neromask?lang=ru
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: false
  }
})