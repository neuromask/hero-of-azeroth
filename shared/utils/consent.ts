/**
 * Cookie consent: the one key the reader's answer is kept under, and the one thing that answer does.
 *
 * The answer is a string in the reader's own `localStorage`, and it is deliberately the plainest thing that
 * could hold it: a local store is not sent with any HTTP request, nothing of it reaches the server, and it
 * costs no cookie at all - which matters on a site whose one cookie is the session the Battle.net sign-in
 * hands out (`server/utils/session.ts`), and where that one cannot be asked for permission, because it *is*
 * the sign-in: a website cannot offer to break itself.
 *
 * The key and the two words it may hold live here rather than at either end of the site, because both ends
 * need them: the banner writes the answer (`app/composables/cookieConsent.ts`) and two inline scripts in the
 * page's own `<head>` read it before the tag manager loads (`nuxt.config.ts`). A second copy of a key is how
 * a banner comes to ask a question that nothing can then answer.
 *
 * The whole protocol is the key's name and its two values. `cookie_consent` is absent for a browser that has
 * never answered, which is the only state the banner is shown in; `'true'` allowed the counter, and `'false'`
 * refused it - and refusing is an answer too, so it is stored and remembered rather than being the absence of
 * one, which would ask again on the next page.
 *
 * What the answer does is Google's Consent Mode, and that is why it is read in the head rather than only in
 * the banner. `denied` is what tells the tags inside the container not to touch the reader's browser; without
 * it, "decline" would hide a banner and change nothing about what Google collects. `default` can only be said
 * once and has to be said before the container loads, so the defaults live in the head too: `denied` for
 * everyone - the question is asked of everyone rather than guessed by region - with `functionality_storage`
 * and `security_storage` granted, because those two are the sign-in and the state its OAuth round trip
 * carries.
 */

/** Where the reader's answer is kept: their own browser's storage, so nothing of it is ever sent anywhere. */
export const CONSENT_KEY = 'cookie_consent'

/** The answer as it is stored: `'true'` allowed the counter, `'false'` refused it. */
export type ConsentChoice = 'true' | 'false'

/**
 * Whether a stored value is an answer this site wrote - a reader who edited it by hand, or who has an older
 * build's leftovers under the key, has no answer at all, and the question is asked.
 */
export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === 'true' || value === 'false'
}

/**
 * What every tag is told before the reader has answered, and what the answer is measured against.
 *
 * `denied` is not "do not run": the whole point of Consent Mode is that the tags still load and still send
 * the cookieless, aggregated pings Google can use, while everything that would touch the reader's own
 * browser - cookies, identifiers, storage - waits for a `granted`. Being asked is what makes the answer
 * meaningful; a tag that had already read the reader is not un-read by a later `denied`.
 */
export const CONSENT_DEFAULTS: Record<string, string> = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  functionality_storage: 'granted',
  security_storage: 'granted'
}

/**
 * What an answer changes. Only analytics is the reader's to give, because analytics is all there is: the site
 * runs no ads, so the three advertising switches keep their default and `denied` is where they stay - a
 * banner that offered a choice it does not have would be worse than no banner.
 */
export function consentUpdate(choice: ConsentChoice): Record<string, string> {
  return { analytics_storage: choice === 'true' ? 'granted' : 'denied' }
}
