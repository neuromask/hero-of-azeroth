/**
 * Where a served request sends the reader next, in the language their browser asks for.
 *
 * The site's own language is part of the address and only Russian spells itself out (`/ru`), and
 * the pages apply it themselves - there is no server-side negotiation to lean on
 * (see `app/middleware/lang.global.ts`). The sign-in callback is the one place that has to land
 * somewhere the visitor did not name, so it reads the request's own `Accept-Language` for the one
 * language this build serves a second copy of.
 */
import type { H3Event } from 'h3'

export function localeRedirect(event: H3Event, path: string): string {
  const accepted = getRequestHeader(event, 'accept-language') || ''
  const wantsRussian = /(^|[,\s])ru\b/i.test(accepted)

  if (!wantsRussian || path === '/ru' || path.startsWith('/ru/')) return path
  return path === '/' ? '/ru' : `/ru${path}`
}
