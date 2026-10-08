/**
 * Wowhead Power: the widget that turns a link to an achievement, an item or a spell into the
 * tooltip the game itself draws, read from Wowhead in the visitor's language.
 *
 * The script is the CDN copy of Wowhead's Power widget. It is loaded once per document and only in
 * the browser: a link renders on the server as an ordinary anchor, so a crawler and a visitor
 * without JavaScript both get a working link, and the tooltip is an enhancement laid over it.
 *
 * The widget's options live on a global that has to be in place before the script runs, which is
 * why they are set here, synchronously, before the script is asked for. The brief named that global
 * `wowheadPower`; the widget itself reads `whTooltips` (or its documented alias `wowhead_tooltips`),
 * so the same object is handed to every name and whichever one the script looks for it finds.
 */

// The tick a booked scan of the document runs on (see `refreshLinks`).
import { nextTick } from 'vue'

/** The kinds of game data a link can name, which is also the widget's own spelling of them. */
export type WowheadType = 'achievement' | 'item' | 'spell' | 'mount' | 'pet' | 'npc' | 'faction'

/** Wowhead's Power widget, from the CDN their own pages load it from. */
const POWER_SCRIPT = 'https://wow.zamimg.com/widgets/power.js'

/** The languages Wowhead serves on a subdomain of their own; every other language reads `www`. */
const LOCALE_SUBDOMAINS: Record<string, string> = { ru: 'ru' }

/**
 * The address of the page `type` and `id` name, on the subdomain `locale` reads Wowhead on - so a
 * Russian visitor's tooltip opens the Russian page and an English visitor's the English one.
 */
export function wowheadUrl(locale: string, type: WowheadType, id: number | string): string {
  const host = LOCALE_SUBDOMAINS[locale] || 'www'
  return `https://${host}.wowhead.com/${type}=${id}`
}

/**
 * What the widget is told to do, read off the global it looks for. `colorLinks` tints the link by
 * the rarity of what it names and `tooltips` asks for the in-game tooltip itself. `iconizeLinks`
 * and `renameLinks` are left off on purpose: the feed already draws its own icon and its own title,
 * so a second icon or a renamed label from the widget would double what is already on the card.
 */
const POWER_OPTIONS = { colorLinks: true, tooltips: true, iconizeLinks: false, renameLinks: false } as const

/**
 * The document holds one copy of the script, however many links ask for it: the first starts the
 * load and everyone after it waits on the same promise instead of adding a second `<script>`.
 */
let powerLoading: Promise<void> | null = null

function loadPowerScript(): Promise<void> {
  if (powerLoading) return powerLoading

  powerLoading = new Promise<void>((resolve, reject) => {
    // A navigation back to the page finds the widget already here.
    if ((window as unknown as { $WowheadPower?: unknown }).$WowheadPower) {
      resolve()
      return
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${POWER_SCRIPT}"]`)
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Wowhead Power failed to load')), { once: true })

    if (!existing) {
      script.src = POWER_SCRIPT
      script.async = true
      document.head.appendChild(script)
    }
  })

  return powerLoading
}

/**
 * Whether a scan of the document is already booked.
 *
 * The widget's `refreshLinks` walks the whole page, and a page asks for it far more often than it has
 * anything new to show: the activity feed mounts two hundred links in one flush - a card carries its
 * icon and its name - and every one of them asks on its own mount, on its own update and on a change
 * of language. Two hundred walks of a hundred-card timeline is what would make the page crawl, so a
 * burst of asks is collapsed into a single scan on the tick after them. Nothing is lost by waiting:
 * the asks all name the same document, and a scan that runs last sees every link the earlier ones
 * would have found.
 */
let scanBooked = false

/**
 * Asks the widget to look again for links it has not seen yet, at most once per tick.
 *
 * The feed is read after the page has painted and a switch of language rewrites every address, so a
 * link can appear after the widget's first pass; this is what gives such a link its tooltip. The
 * server has no widget to ask - the links it renders are plain anchors - so the ask is a no-op there.
 */
function refreshLinks(): void {
  if (!import.meta.client || scanBooked) return

  scanBooked = true
  nextTick(() => {
    scanBooked = false
    const power = (window as unknown as { $WowheadPower?: { refreshLinks?: () => void } }).$WowheadPower
    power?.refreshLinks?.()
  })
}

/**
 * Connects the page to the Wowhead Power widget and hands back the one method a page needs from it:
 * `refreshLinks`, which makes the widget look again for links it has not seen yet.
 */
export function useWowheadPower() {
  // The server has no window and no widget; the links it renders are plain anchors.
  if (import.meta.client) {
    const globals = window as unknown as Record<string, unknown>
    globals.wowheadPower = POWER_OPTIONS
    globals.whTooltips = POWER_OPTIONS
    globals.wowhead_tooltips = POWER_OPTIONS

    // Once the script is up, the links already on the page are handed to it for a tooltip.
    void loadPowerScript().then(refreshLinks).catch(() => {})
  }

  return { refreshLinks }
}