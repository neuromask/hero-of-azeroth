/**
 * Applies the language requested by `?lang=<code>` on every navigation, on the
 * server as well as in the browser. A missing or unknown value falls back to the
 * default locale, which is what makes every URL render deterministically instead
 * of depending on a cookie or on the visitor's browser language.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // `useI18n()` may only be called from setup(), so middleware has to go through
  // the i18n instance Nuxt exposes on the app.
  const i18n = useNuxtApp().$i18n
  const requested = isAppLocale(to.query.lang) ? to.query.lang : DEFAULT_LOCALE

  if (requested !== i18n.locale.value) await i18n.setLocale(requested)
})
