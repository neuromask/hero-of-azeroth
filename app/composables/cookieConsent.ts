/**
 * The reader's answer about cookies: what the banner shows, and what the tag manager is told.
 *
 * Two things live here and they are the same thing read twice. The banner is the question - asked once, of a
 * browser that has never answered, and never again afterwards (`app/components/CookieNotice.vue`); signing in
 * is a cookie the site cannot work without, so it is not what the question is about. The answer is one of two
 * strings under `cookie_consent` in the reader's own storage (`shared/utils/consent.ts` documents the key and
 * each of the two words), and the tag manager is its other side: `gtag('consent', 'update', ...)` tells
 * Google's Consent Mode what the reader decided, and the tags inside the container honour it.
 *
 * The state is at module scope rather than provided by the root - the opposite of the choice `pageLoading`
 * documents, and for a reason of its own: that store belongs to one rendered site, while this is a fact
 * about the browser reading the page. It is one answer for every page and it has to survive every
 * navigation, and none of it is per-request, so none of it can leak between two.
 *
 * The stored answer is read on the client and in `onMounted`, never during setup: the server has no storage
 * to read, and a banner rendered into the hydration pass of a reader who answered a year ago would be a
 * mismatch the browser would have to repair - a flash of the question, which is exactly the thing the
 * reader already answered.
 */
import { CONSENT_KEY, consentUpdate, isConsentChoice, type ConsentChoice } from '#shared/utils/consent'

/**
 * The window as the tag manager leaves it. `gtag` is a function declaration in one of the two inline
 * scripts of the head, so it is a property of the global object whenever the page's own scripts ran at all.
 */
type ConsentWindow = Window & { gtag?: (...args: unknown[]) => void }

/** The reader's answer, or `null` for a browser that has never given one. */
const answer = ref<ConsentChoice | null>(null)

/** Whether storage has been read. Until it has, nothing is drawn and nothing is claimed. */
const ready = ref(false)

/**
 * Reads the answer this browser kept.
 *
 * A browser that refuses site storage cannot be asked the question a second time - there is nowhere to keep
 * the reply - so it is not asked at all: the answer becomes `denied` and the banner stays away rather than
 * standing on every page of the site for ever. That is also what the tags keep, so a reader in that
 * situation is exactly as untracked as one who said no.
 */
function load(): void {
  if (ready.value || !import.meta.client) return
  ready.value = true
  try {
    const kept = localStorage.getItem(CONSENT_KEY)
    if (isConsentChoice(kept)) answer.value = kept
  } catch {
    answer.value = 'denied'
  }
}

/**
 * Hands the answer to the tag manager. It is skipped when the container never loaded - a reader whose
 * extension blocks Google, or a staging copy built without an id - because there is then nobody to tell and
 * nothing to correct: the defaults of the page (`denied`) are already what the answer would have said.
 */
function tell(choice: ConsentChoice): void {
  if (!import.meta.client) return
  const { gtag } = window as ConsentWindow
  if (typeof gtag !== 'function') return
  gtag('consent', 'update', consentUpdate(choice))
}

/**
 * The question, and what the answer does.
 *
 * `open` is the banner's whole condition, and it is one clause long on purpose: the question stands for a
 * browser that has never answered, and for one that has answered it stands never - not on the next page, not
 * on the next visit, and not from the foot of a page either, because a question asked again is not the
 * question the reader answered. `decide` is both buttons - they differ only in the answer they carry - and it
 * writes the answer before it is announced anywhere, so a reader whose storage refuses the write is still
 * counted the way they asked for, for as long as this page lives.
 *
 * The answer is not handed back to callers: nothing on the site has a reason to show it, and a value nobody
 * reads is a value that drifts.
 */
export function useCookieConsent() {
  onMounted(load)

  return {
    /** Whether the question stands on the page right now. */
    open: computed(() => ready.value && answer.value === null),
    /** Keeps the reader's answer, hands it to the tag manager and takes the question away for good. */
    decide(choice: ConsentChoice): void {
      answer.value = choice
      try {
        localStorage.setItem(CONSENT_KEY, choice)
      } catch {
        // Nothing to do: the answer holds for this page, which is all a browser without storage can be
        // promised. The tags have already been told.
      }
      tell(choice)
    }
  }
}
