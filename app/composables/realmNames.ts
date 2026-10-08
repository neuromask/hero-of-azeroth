/**
 * The realm a slug names, in the language being read.
 *
 * A leaderboard row stores the realm's name as the profile spelled it, and a profile is read in the
 * language of the page that asked for it: the same realm is `Гордунни` in one record and `Gordunni`
 * in the next, so a table drawn straight from the records mixes the two. The site already knows both
 * names for every realm - the search box has been reading them all along (`server/api/realms.get.ts`)
 * - so the table, the filters and the widgets all ask this composable instead, and a realm is written
 * in the language of the page rather than in the language of whoever happened to be looked up first.
 *
 * The list is one request for the whole page: `useFetch` shares its answer by key, so the three
 * components that need a name read the same response rather than fetching it three times, and the
 * endpoint behind it keeps Blizzard's own list in memory once it has it.
 */

/** A realm as `/api/realms` answers it: the slug an address carries, and both of its names. */
export interface RealmOption {
  slug: string
  name: string
  region: 'eu' | 'us'
  /** The name the game uses in Russian, or an empty string for a realm that has only one. */
  nameRu: string
}

export function useRealmNames() {
  const { locale } = useI18n()

  const { data } = useFetch<RealmOption[]>('/api/realms', {
    key: 'hoa-realm-names',
    default: () => []
  })

  /** The list as a lookup, keyed the way a record names a realm: its region and its slug. */
  const byRegionAndSlug = computed(() => {
    const map = new Map<string, RealmOption>()
    for (const realm of data.value || []) map.set(`${realm.region}:${realm.slug}`, realm)
    return map
  })

  /**
   * The realm's name in the language being read.
   *
   * `fallback` is what a record stored, which is used when the list does not know the realm - a realm
   * that has been merged away since the record was written, or a list that could not be read at all -
   * so a row always names its realm, in one language or another.
   */
  function realmLabel(region: string, slug: string, fallback = ''): string {
    const realm = byRegionAndSlug.value.get(`${region}:${slug}`)
    if (!realm) return fallback || slug

    return locale.value === 'ru' ? realm.nameRu || realm.name : realm.name
  }

  return { realmLabel }
}
