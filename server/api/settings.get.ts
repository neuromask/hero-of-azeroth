/**
 * The site's public settings: the maxima a figure without a size of its own is measured against, and the page
 * copy an administrator has stored.
 *
 * Public on purpose, and it is the one half of the panel that is. The comparison board of a *stranger* draws
 * the same bars as the board of an administrator (`app/components/CharacterVersus.vue`), so the numbers behind
 * them cannot sit behind a sign-in - what is gated is the *writing* (`server/api/admin/settings`).
 *
 * It answers from one small table (`server/utils/siteSettings`), read once per render rather than cached here:
 * an answer this cheap is not worth a cache an operator then has to know to bust.
 */
export default defineEventHandler(() => getSiteSettings())
