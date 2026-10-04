export default defineI18nConfig(() => ({
  legacy: false,
  // Mirrors `defaultLocale` in nuxt.config.ts. The `?lang=` parameter in the URL
  // is what actually decides, and the middleware applies it before the first
  // render, so this only covers the rare case of a render without a route.
  locale: 'en'
}))