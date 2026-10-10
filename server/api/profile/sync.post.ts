/**
 * Fills in a few of the reader's own characters behind the page that asks.
 *
 * The profile page calls this once after it has drawn: the reader sees their alts immediately and
 * the figures appear a moment later, on the next read of the page. The work is deliberately *not*
 * awaited - the response is one line, and the batch runs on the server after it has been sent -
 * which is what keeps a thirty-alt account from turning a page view into a gateway timeout.
 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  // Started, not awaited: the reply is the promise of work, not the work.
  void syncDueCharacters(5, (getQuery(event).locale as string) || 'en_US', user.id).catch(() => {})

  return { started: true }
})
