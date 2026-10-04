/**
 * Returns the realm list used by the realm combobox.
 *
 * Realms of every supported region are returned together (each entry carries
 * its `region`), so the UI can group them under "Europe" / "America" headers and
 * derive the region from the realm the user picks – there is no separate region
 * selector any more. Pass ?region=eu to limit the response to one region.
 */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const locale = (query.locale as string) || 'en_US'
  const requested = query.region === 'eu' || query.region === 'us' ? (query.region as 'eu' | 'us') : ''
  const regions: Array<'eu' | 'us'> = requested ? [requested] : ['eu', 'us']

  try {
    const lists = await Promise.all(regions.map((region) => getRealms(region, locale)))
    return regions.flatMap((region, index) =>
      lists[index]!.map((realm) => ({ ...realm, region }))
    )
  } catch (err: any) {
    console.error('[realms] failed:', err)
    throw createError({
      statusCode: err.statusCode || 500,
      statusMessage: err.message || err.statusMessage || 'Failed to fetch realm list'
    })
  }
})

