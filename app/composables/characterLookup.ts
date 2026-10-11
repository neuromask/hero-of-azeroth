/**
 * The site's search, as something a page can ask for from outside the control that carries it.
 *
 * The two fields that look a character up are written once (`app/components/CharacterSearchForm.vue`) and
 * offered in two places: the card the front door opens with, and the sheet a page's own row drops
 * (`app/components/CharacterSearchDialog.vue`). A reader who arrives with a name already in hand - the name
 * the table has no row for, the name whose page came back "not found" - is looking somewhere other than
 * where the search is, and a page cannot reach into another component's `ref` to open it.
 *
 * So the ask is written here instead: a page *asks* for the search to be opened on a name, the sheet that
 * already stands in the page's own row answers it, and neither knows the other exists. What travels is the
 * whole ask rather than a flag - the name is the interesting half of it, and a token is what makes two asks
 * for the same name two asks rather than one.
 *
 * The state is kept in `useState` rather than in a module-level `ref`, which is what makes it the same
 * value for the writer and the reader across a page that is rendered on the server and then taken over by
 * the browser. Nothing races there: the ask is only ever made in the browser, because it is a press that
 * makes it, so the server's copy is empty and both sides draw the same page.
 */

/** One ask: the name to open the search on, and what tells one ask from the next. */
export interface CharacterLookupAsk {
  /** The name to put in the field, or an empty string for a search that opens on nothing. */
  name: string
  /** A fresh number per ask, so asking twice for the same name opens the search twice. */
  token: number
}

/** The key the ask is kept under, shared by every reader of it on a page. */
export const CHARACTER_LOOKUP_KEY = 'hoa-character-lookup'

export function useCharacterLookup() {
  const ask = useState<CharacterLookupAsk | null>(CHARACTER_LOOKUP_KEY, () => null)

  /**
   * Asks for the search to be opened on `name` - the whole act, from any page of the site. An empty name
   * is the same act with nothing to fill in, which is what a page that only wants the search asks for.
   */
  const open = (name = '') => {
    ask.value = { name: name.trim(), token: Date.now() }
  }

  /** Says the ask has been answered, so a sheet that has been shut stays shut. */
  const clear = () => {
    ask.value = null
  }

  return { ask, open, clear }
}
