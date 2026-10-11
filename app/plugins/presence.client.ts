/**
 * The presence beat, started once for the whole site.
 *
 * A plugin rather than a line in a page's setup, because being on the site is not a fact about one page: a
 * reader on the front page, on a character page or in the hall of fame is just as present as one on the page
 * that happens to draw the dots, and the beat has to outlive a navigation between them.
 *
 * It is a `.client` plugin: nothing of it runs on the server, which has no tab to be visible or hidden. What
 * it starts is one timer and one listener for the app's lifetime (see `usePresenceHeartbeat`), so a page
 * never pays for it and a signed-out visitor never sends anything.
 */
export default defineNuxtPlugin(() => {
  usePresenceHeartbeat()
})
