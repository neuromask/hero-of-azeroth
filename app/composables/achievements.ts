/**
 * A character's achievements, read from the endpoint that assembles them.
 *
 * Two reads share the one endpoint: `useAchievementSummary` for the root page (the running total and
 * a row per category) and `useAchievementPage` for one category's shelf. Both go through
 * `useAsyncData` so a deep link carries its data in the first response, and both are keyed by the
 * language, so switching to Russian asks for the shelf read in Russian rather than re-drawing the
 * English one.
 */
import type { AchievementCategory, AchievementPage, AchievementSummary } from '#shared/data/achievementsSchema'
import { useCharacterView } from './characterView'

/** The root page's read: every category, summarised, under one running total. */
export function useAchievementSummary() {
  const { region, realm, name, apiLocale } = useCharacterView()

  return useAsyncData<AchievementSummary | null>(
    () => `achievements:summary:${region}:${realm}:${name}:${apiLocale.value}`,
    () => $fetch<AchievementSummary>(`/api/achievements/${region}/${realm}/${name}?locale=${apiLocale.value}`),
    {
      default: () => null,
      watch: [apiLocale]
    }
  )
}

/** One category's shelf, read by its slug. */
export function useAchievementPage(category: () => AchievementCategory) {
  const { region, realm, name, apiLocale } = useCharacterView()

  return useAsyncData<AchievementPage | null>(
    () => `achievements:page:${category()}:${region}:${realm}:${name}:${apiLocale.value}`,
    () => {
      const query = new URLSearchParams({ category: category(), locale: apiLocale.value })
      return $fetch<AchievementPage>(`/api/achievements/${region}/${realm}/${name}?${query}`)
    },
    {
      default: () => null,
      watch: [() => category(), apiLocale]
    }
  )
}
