/**
 * The two locales, key for key.
 *
 * Every page of the site renders through `$t`, so a key a locale is missing does not fail a build and does not
 * throw: it prints the key itself, in the middle of a sentence, in one language only - which is exactly the kind of
 * defect nobody sees until a reader does. The site has kept the two files level by hand, and this is what makes
 * that a rule rather than a habit.
 *
 * The one difference that is not a defect, and is deliberately allowed: Russian needs plural forms
 * (`timeDays_few`, `timeDays_many`) beside the base key, so the Russian file may hold keys the English one does
 * not - but only of that shape, and never a key that means something the other language has no word for.
 */
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'

/** Plural suffixes `@nuxtjs/i18n` picks between, which only a language with cases needs. */
const PLURAL_SUFFIXES = ['_few', '_many']

describe('the two locales', () => {
  it('say the same things, key for key', () => {
    const missing = Object.keys(en).filter((key) => !(key in ru))

    expect(missing).toEqual([])
  })

  it('hold nothing but plural forms beyond what English has', () => {
    const extra = Object.keys(ru).filter((key) => !(key in en))
    const unexplained = extra.filter((key) => !PLURAL_SUFFIXES.some((suffix) => key.endsWith(suffix)))

    expect(unexplained).toEqual([])
  })

  it('say all of it in a string, and never leave a phrase half-written', () => {
    for (const [locale, messages] of [
      ['en', en],
      ['ru', ru]
    ] as const) {
      for (const [key, value] of Object.entries(messages)) {
        expect(typeof value, `${locale}.${key}`).toBe('string')
        expect(value.trim(), `${locale}.${key}`).not.toBe('')
        // A message that lost its closing brace, or gained one, is a message that prints a placeholder at a reader.
        expect((value.match(/\{/g) || []).length, `${locale}.${key}`).toBe((value.match(/\}/g) || []).length)
      }
    }
  })
})
