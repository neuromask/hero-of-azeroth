/**
 * What the process can say about itself, for the administrator's panel - and for nobody else.
 *
 * Read-only by construction: the handler asks who is calling (`requireAdmin`, which is a `401` for nobody and a
 * `403` for somebody who is not an administrator) and hands back what the diagnostics module has already
 * counted. No query is taken from the request, nothing is written, and no figure is invented - what the panel
 * cannot measure it does not print (`#shared/data/adminDiagnostics`).
 *
 * The answer is assembled inside a twenty-second server-side window (`readAdminDiagnostics`), so a page that
 * refreshes itself while it is open counts the tables at most once a window however many tabs are watching, and
 * a stranger who learned the URL still cannot read it: the gate is the first statement, not a link the panel
 * happens not to draw.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return readAdminDiagnostics()
})
