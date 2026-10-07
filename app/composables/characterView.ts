/**
 * What the character shell hands to the views it renders.
 *
 * The page is a shell around two views - the profile and the activity feed - and the shell is
 * the one that knows the character: it fetched the profile, it is where the Refresh button and
 * the toast live, and it is the only place that survives a switch between the views (a nested
 * route reuses the parent, so the header above them is never rebuilt). Everything a view needs
 * to draw itself therefore arrives through here rather than being fetched a second time.
 *
 * It is `provide`/`inject` rather than a store on purpose: the values belong to one rendered
 * character, live exactly as long as the shell does, and are gone when the visitor leaves - a
 * module-level store would outlive the page and need keying to a character to stay correct.
 */
import type { ComputedRef, InjectionKey, Ref } from 'vue'
// The profile's shape, which is what the endpoint behind the shell answers with.
import type { CharacterData } from '~~/server/utils/blizzard'
// The feed's shape, shared with the endpoint that builds it (see `#shared/utils/activity`).
import type { ActivityFeed } from '#shared/utils/activity'

export interface CharacterViewContext {
  /** The region as the endpoints spell it (`eu`, `us`), read from the address. */
  region: string
  /** The realm's slug, from the address. */
  realm: string
  /** The character's name, from the address. */
  name: string
  /** The language the profile and the feed are read in, which the address's first segment names. */
  apiLocale: ComputedRef<string>
  /** The profile the shell fetched, shared so a view does not read Blizzard for it again. */
  character: Ref<CharacterData | null>
  /** The activity feed, once it has been read; `null` until a view asks for it. */
  activity: Ref<ActivityFeed | null>
  /** True while the feed is being read, so the view can show the wait. */
  activityPending: Ref<boolean>
  /** The failure a read of the feed left behind, if it failed. */
  activityError: Ref<Error | null>
  /** Reads the feed, or leaves it alone when it is already on hand. */
  loadActivity: (force?: boolean) => Promise<void>
  /** The one message the shell shows, raised by the Refresh button and the share tray. */
  toast: Ref<string>
}

/** The key the context is provided and injected under. A symbol, so nothing can collide with it. */
const CHARACTER_VIEW: InjectionKey<CharacterViewContext> = Symbol('hoa-character-view')

/** Provides the shell's context to the views rendered inside it. */
export function provideCharacterView(context: CharacterViewContext): void {
  provide(CHARACTER_VIEW, context)
}

/**
 * The context of the surrounding shell. A view that is somehow rendered outside one - which the
 * router makes impossible, they only exist under the shell - throws rather than drawing against
 * nothing.
 */
export function useCharacterView(): CharacterViewContext {
  const context = inject(CHARACTER_VIEW)
  if (!context) {
    throw createError({ statusCode: 500, statusMessage: 'The character view has no shell around it' })
  }
  return context
}