/**
 * The admin panel's write: the maxima the board measures a figure against, and the copy a page may print.
 *
 * The one endpoint of the site that refuses anybody by *name*. A sign-in is what every account endpoint asks
 * for (`requireUser`, `server/utils/session`); this asks a second question - is this account one of the
 * administrators (`isAdmin` in `server/utils/siteSettings`) - and answers a 403 rather than a sign-in wall when
 * it is not, because the reader is already somebody, just not somebody who may move this site's numbers.
 *
 * The body is a patch (`SiteSettingsPatch`): the maxima the panel drew, and the copy it edited. Everything is
 * validated in the store rather than here, so the panel cannot write a name the pages do not read.
 *
 * The gate is the shared one (`requireAdminAction`): a signed-in administrator, and a POST whose `Origin` is
 * this site's own - the same two questions every other endpoint of the panel asks, and the same refusals
 * (`401` for nobody, `403` for a reader who is not an administrator).
 */
import type { SiteSettingsPatch } from '#shared/data/siteSettings'

export default defineEventHandler(async (event) => {
  await requireAdminAction(event)

  const patch = await readBody<SiteSettingsPatch>(event)
  const saved = saveSiteSettings(patch && typeof patch === 'object' ? patch : {})

  // Which namespaces moved, and nothing of what they now say: the settings are an operator's copy, not a
  // diagnostic, and the panel only needs to know that the write happened (`server/utils/adminDiagnostics`).
  const namespaces = [patch?.metricMaxima ? 'maxima' : '', patch?.content ? 'content' : ''].filter(Boolean)
  recordDiagnostic({
    level: 'info',
    category: 'admin',
    message: `settings saved (${namespaces.join(', ') || 'nothing'})`
  })

  return saved
})
