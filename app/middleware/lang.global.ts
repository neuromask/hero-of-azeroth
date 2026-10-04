/**
 * Applies the language the address names, on the server as well as in the browser.
 *
 * The language is the first path segment and the default one is not written out, so a
 * path whose first segment names no known language is the default one. Nothing here
 * reads a cookie or looks at the visitor's browser, which is what makes an address
 * render the same for everyone and a crawler see what a visitor sees.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // `useI18n()` may only be called from setup(), so middleware has to go through
  // the i18n instance Nuxt exposes on the app.
  const i18n = useNuxtApp().$i18n
  const requested = localeFromPath(to.path)

  if (requested !== i18n.locale.value) await i18n.setLocale(requested)
})