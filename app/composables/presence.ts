/**
 * Presence on the client: the beat that says a reader is here, and the list that says who else is.
 *
 * The two halves are one idea read from two sides, which is why they share a file. `usePresenceHeartbeat`
 * is what a signed-in browser *sends* - one POST a minute while the tab is visible
 * (`/api/user/heartbeat`), which is what puts the reader's own main in the list - and it is started once
 * for the whole site by `app/plugins/presence.client.ts`, so every page beats rather than the one page that
 * happens to draw a dot. `usePresence` is what a page *reads* (`/api/leaderboard/presence`), and only the
 * hall of fame draws anything with it.
 *
 * Both are written to the beat's own economy. A hidden tab sends nothing: a reader who switched away is
 * still on the site, and the window the server keeps is five minutes wide precisely so that the beat can
 * be missed without the dot going out (see `server/utils/presence.ts`). A tab that becomes visible again
 * beats and reads at once rather than waiting out the rest of the minute, because coming back to the tab is
 * exactly when a reader expects to see it. And a beat that fails is dropped: presence is a courtesy, and a
 * reader whose network dropped one POST is a reader whose next one will land.
 *
 * The list is read through `useAsyncData` so the server renders it with the page - the first paint of the
 * hall of fame already has its dots - and re-read every minute after that, which is what keeps them honest
 * while the table itself stays cached for an hour.
 */
import type { LeaderboardPresence } from '#shared/data/leaderboardSchema'

/** How often a reader beats and the list is re-read: well inside the window the server keeps. */
const BEAT_MS = 60 * 1000

/** Whether the tab is being looked at, which is the only state a beat is worth sending in. */
function visible(): boolean {
  return !import.meta.client || document.visibilityState === 'visible'
}

/**
 * The reader's own beat: one POST a minute while the tab is visible, sent as soon as the page knows whether
 * anybody is signed in.
 *
 * It reads the session through the very request the header's own plate is drawn from (the shared
 * `profile-identity` key of `/api/profile`), so a page that draws the account plate pays no second request
 * for the beat, and a signed-out visitor sends nothing at all rather than a minute of refused calls.
 *
 * There is no lifecycle here on purpose: this is started by `app/plugins/presence.client.ts`, where there is
 * no component to mount or unmount, and the beat lives exactly as long as the tab does - which is what the
 * dot means. Signing in or out is a full navigation that builds the app again, so the beat follows the
 * session without watching for it beyond the one `watch` below.
 */
export function usePresenceHeartbeat(): void {
  if (!import.meta.client) return

  const { data: identity } = useFetch<{ user: { battletag: string | null } | null }>('/api/profile', {
    key: 'profile-identity'
  })

  /** Sends one beat, unless nobody is signed in or the tab is hidden - which is the whole of the rule. */
  function beat(): void {
    if (!identity.value?.user || !visible()) return
    void $fetch('/api/user/heartbeat', { method: 'POST' }).catch(() => {})
  }

  watch(identity, beat)
  beat()

  setInterval(beat, BEAT_MS)
  document.addEventListener('visibilitychange', beat)
}

/**
 * Who is on the site, as the hall of fame reads it: the keys of the mains whose account has beaten inside
 * the window, and how wide that window is.
 *
 * The list is fetched with the page rather than after it, so the dots are in the first answer the server
 * sends, and it is refreshed every minute while the tab is visible - the same beat, the other direction.
 */
export async function usePresence() {
  const { data } = await useAsyncData<LeaderboardPresence>(
    'leaderboard-presence',
    () => $fetch<LeaderboardPresence>('/api/leaderboard/presence'),
    { default: () => ({ window: 0, keys: [] }) }
  )

  if (import.meta.client) {
    const reRead = () => {
      if (visible()) void refreshNuxtData('leaderboard-presence')
    }

    onMounted(() => {
      setInterval(reRead, BEAT_MS)
      document.addEventListener('visibilitychange', reRead)
    })
  }

  return {
    /** The keys of the online mains, which a row is matched against by `searchHistoryKey`. */
    online: computed(() => new Set(data.value?.keys || [])),
    /** How many mains are on the site right now, which is what the first widget prints. */
    count: computed(() => (data.value?.keys || []).length),
    /** How long a beat is good for, in seconds, which is what the dot's freshness means. */
    window: computed(() => data.value?.window || 0)
  }
}
