<script setup lang="ts">
/**
 * A page that is a document rather than a view of the data: the frame the about page, the privacy policy and
 * the legal notice are all cut from.
 *
 * The pages differ in what they say and in nothing else, so the frame is written once here: the backdrop, the
 * header with the link a document offers, one pane of the site's glass with the article in it, the sign-off and
 * the two floating controls. It is the same arrangement the hall of fame stands in, because a reader who
 * followed a link in the foot of that page should arrive somewhere that looks like the page they left.
 *
 * What a page hands over is its title, its one line of meta, the date it was last edited - the policy
 * records one, the trademark notice does not - and the sections themselves. All of them are message keys
 * rather than sentences: a document is written as prose in the locale files and translated in one place, the
 * same way every label of the site is, and the split into paragraphs (a blank line inside a body) is kept
 * here so a section can be edited as a single string rather than chopped into a key per paragraph.
 *
 * The links under the article come from the page that owns them (a slot): the policy names Google, Blizzard,
 * Wowhead and the way to ask for a deletion, the notice names Blizzard's own terms - and a frame that
 * guessed at either would be inventing references. They are styled by the paragraph they land in, so a page
 * writes plain anchors and never the treatment: the slot's content is compiled by the page, but the classes
 * are the frame's.
 */
withDefaults(
  defineProps<{
    /** The artwork the page stands on, which a document takes from the site's own pictures. */
    image: string
    /**
     * The page's name, as a message key: this is the heading the header prints, and the page itself sets the
     * document's `<title>` through `usePageSeo`.
     */
    title: string
    /** One line under the heading, as a message key. */
    meta: string
    /** When the document was last edited, for the pages that record it. */
    updated?: string
    /**
     * The prose of the document, in the order it is read. A section may carry no heading - the trademark
     * notice is three paragraphs and no titles - and its `body` is one message whose paragraphs are separated
     * by a blank line.
     *
     * A page that is *laid out* rather than written keeps its prose here and appends its own body to the slot:
     * the about page opens with its introduction and goes on to a shelf of cards, and a frame that could only
     * print headings and paragraphs would have to be taught about cards next.
     */
    sections?: { title?: string; body: string }[]
  }>(),
  { sections: () => [] }
)

const { t } = useI18n()
const localeUrl = useLocaleUrl()

/** The one page a reader may have come from, offered as every page's own row offers its links. It is the front
 * door, which is the hall of fame, so the two links this row used to carry - the home page and the table - are
 * one address now and are drawn once. */
const links = computed(() => [{ label: t('lbNav'), to: localeUrl('/') }])

/** The paragraphs of a section: its body is one message, split on the blank lines it carries. */
const paragraphs = (body: string) => String(t(body)).split('\n\n')
</script>

<template>
  <div
    class="relative flex min-h-screen flex-col justify-between bg-wow-dark text-white selection:bg-wow-gold selection:text-black"
  >
    <SiteBackdrop :image="image" />

    <!-- The heading and its one line are messages like every label of the site, so they are keys here and
         translated once, where the header draws them. -->
    <SiteHeader :title="t(title)" :meta="t(meta)" :links="links" />

    <div
      class="relative z-10 container mx-auto w-full flex-1 px-4 pt-4 lg:grid lg:max-w-5xl lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-x-6"
    >
      <!-- The rail of documents and the article are one arrangement, cut the way the shelves cut theirs: a
           column on a phone - the rail above, the article under it - and a rail of 13rem beside the article
           from `lg` up, where a window is wide enough to hold both. The measure the pair takes is the 64rem the
           container is capped at, which leaves the article the 48rem a column of prose wants. -->
      <DocumentNav class="mb-4 lg:mb-0" />

      <article class="hoa-panel min-w-0 p-5 sm:p-7">
        <p v-if="updated" class="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {{ t(updated) }}
        </p>

        <!-- The date sits above the first heading, so the first section only starts a step below it when
             there is one to be read past. -->
        <section
          v-for="(section, index) in sections"
          :key="section.title || index"
          :class="index === 0 ? (updated ? 'mt-3' : '') : 'mt-6'"
        >
          <h2 v-if="section.title" class="text-sm font-bold text-white sm:text-base">{{ t(section.title) }}</h2>

          <p
            v-for="(paragraph, line) in paragraphs(section.body)"
            :key="line"
            class="mt-2 text-sm leading-relaxed text-gray-300"
          >
            {{ paragraph }}
          </p>
        </section>

        <!-- What a page that is laid out rather than written adds under its prose: the about page opens with
             the paragraphs of its introduction and goes on to a shelf of cards. A page that is only prose
             leaves the slot empty, and an empty slot draws nothing. -->
        <slot />

        <!-- Who the document names, and where their own terms are. -->
        <p
          v-if="$slots.references"
          class="mt-7 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-4 text-xs [&_a]:text-gray-300 [&_a]:outline-none [&_a]:transition-colors hover:[&_a]:text-wow-goldLight focus-visible:[&_a]:text-wow-goldLight"
        >
          <slot name="references" />
        </p>
      </article>
    </div>

    <footer class="relative z-20 container mx-auto px-4 pb-2 text-xs">
      <SiteFooter />
    </footer>

    <BackToTop />
    <SupportButton />
  </div>
</template>
