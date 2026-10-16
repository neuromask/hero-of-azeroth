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
 */
import type { SiteSettingsPatch } from '#shared/data/siteSettings'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  if (!isAdmin(user.battletag)) {
    throw createError({ statusCode: 403, statusMessage: 'Administrators only' })
  }

  const patch = await readBody<SiteSettingsPatch>(event)
  return saveSiteSettings(patch && typeof patch === 'object' ? patch : {})
})
