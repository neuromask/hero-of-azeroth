/**
 * Route parameters arrive percent-encoded from the router (which matters for
 * realm / character names with non-ASCII characters), and are passed straight
 * into URLs pointing at the Blizzard API. Decoding is idempotent, so it is safe
 * to call even if a future Nitro version hands us an already decoded value.
 */
/** Blizzard regions the site serves. A page carries one as `region-eu`. */
export const SUPPORTED_REGIONS = ['eu', 'us'] as const

export type BlizzardRegion = (typeof SUPPORTED_REGIONS)[number]

export function isRegion(value?: string | null): value is BlizzardRegion {
  return typeof value === 'string' && (SUPPORTED_REGIONS as readonly string[]).includes(value.toLowerCase())
}

/** The region as a page spells it: `eu` is served as `region-eu`. */
export function regionPath(region: string): string {
  return `region-${region}`
}

/**
 * Reads the region from a route parameter and rejects anything the Blizzard API does
 * not know about. A page names the region `region-eu` while the endpoints under
 * `/api/` take the bare `eu`; both spellings are accepted here, so an address copied
 * out of the browser can be handed to an endpoint unchanged.
 */
export function parseRegion(value?: string | null): BlizzardRegion {
  const region = decodeRouteParam(value).toLowerCase().replace(/^region-/, '')
  if (!isRegion(region)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown region "${region}" (expected ${SUPPORTED_REGIONS.join(' or ')})`
    })
  }
  return region
}

/**
 * The region a caller asked to *narrow a table to*, or `undefined` for every region.
 *
 * The two questions a region is asked here are not the same question. An address naming one
 * (`parseRegion` above) must be served or refused, because a page standing for a region the site has no data for is
 * a page with nothing behind it. A *filter* arrives from a control a reader pressed among two or three, and a value
 * that is no longer among them - a link written by an older build, a hand-edited address - is a choice that has
 * gone rather than a broken request: the table stands whole, narrowed by nothing. Both spellings of the region
 * (`eu`, `region-eu`) are read the same way.
 */
export function parseRegionFilter(value?: string | null): BlizzardRegion | undefined {
  const region = decodeRouteParam(value).toLowerCase().replace(/^region-/, '')
  return isRegion(region) ? region : undefined
}

export function decodeRouteParam(value?: string | null): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}