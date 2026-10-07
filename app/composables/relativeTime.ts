/**
 * How an activity card dates its event.
 *
 * A feed is read as \"what has this character done lately\", so a card leads with how long ago
 * it happened - \"yesterday\", \"3 days ago\" - which is the shape a person reads at a glance.
 * The exact moment is still worth keeping, so it is handed out separately for the tooltip the
 * card shows on hover.
 *
 * The wording lives in i18n, one message per grammatical category the language distinguishes
 * (`timeDays_one`, `timeDays_few`, `timeDays_many`, `timeDays_other`), and the category is the
 * one `Intl.PluralRules` reports for the number: Russian picks its three, English its two. The
 * messages are plain strings rather than vue-i18n's `|` plurals on purpose - the rule this
 * library applies to a `|` message only tells 0, 1 and \"everything else\" apart, which would
 * print \"2 дней назад\" instead of \"2 дня назад\". A day or less is named rather than counted -
 * before the hour it is \"just now\", on the first day \"yesterday\" - which is how a feed is
 * spoken about aloud.
 */
export function useRelativeTime() {
  const { locale, t, te } = useI18n()

  /** The language an exact timestamp is formatted in for the tooltip. */
  const dateLocale = computed(() => (locale.value === 'ru' ? 'ru-RU' : 'en-US'))

  /** The plural rule of the page's language, which names the form a number takes. */
  const plural = computed(() => new Intl.PluralRules(locale.value === 'ru' ? 'ru' : 'en'))

  /**
   * The message `key` in the form `n` takes: `key_one`, `key_few`, `key_many` or `key_other`.
   * A language that does not distinguish a category falls through to its `other` message.
   */
  function counted(key: string, n: number): string {
    const category = plural.value.select(n)
    const exact = `${key}_${category}`
    if (te(exact)) return t(exact, { n })
    const other = `${key}_other`
    if (te(other)) return t(other, { n })
    return String(n)
  }

  /**
   * How long ago `timestamp` was, in words. A timestamp of `0` - an event with no moment to
   * place - answers an empty string, so a card shows nothing rather than \"1970\".
   */
  function formatRelative(timestamp: number): string {
    if (!timestamp) return ''

    const diff = Math.max(0, Date.now() - timestamp)
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (diff < 60000) return t('timeJustNow')
    if (hours < 1) return counted('timeMinutes', minutes)
    if (days < 1) return counted('timeHours', hours)
    if (days === 1) return t('timeYesterday')
    if (days < 7) return counted('timeDays', days)

    const weeks = Math.floor(days / 7)
    if (days < 30) return counted('timeWeeks', weeks)

    const months = Math.floor(days / 30)
    if (days < 365) return counted('timeMonths', months)

    return counted('timeYears', Math.floor(days / 365))
  }

  /** The exact moment, in the visitor's language, for the tooltip a card shows on hover. */
  function formatAbsolute(timestamp: number): string {
    if (!timestamp) return ''
    return new Intl.DateTimeFormat(dateLocale.value, { dateStyle: 'long', timeStyle: 'short' })
      .format(new Date(timestamp))
  }

  return { formatRelative, formatAbsolute }
}