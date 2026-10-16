<script setup lang="ts">
/**
 * The admin panel: the numbers an operator owns, in one place, and the foundation the next ones stand on.
 *
 * The site reads almost everything it prints from Blizzard, and the few figures nobody publishes a size for are
 * *stated* rather than read (`#shared/data/siteSettings`): how many quests have been written, how many
 * appearance sources exist, how many recipes a book can hold. Those are the numbers this page exists for - the
 * comparison board measures a row against them (`app/components/CharacterVersus.vue`) - and they are kept in the
 * site's own database rather than in a file, so correcting one is a form rather than a deploy.
 *
 * It is a *page* and not a drawer of the account, because its writes are not the reader's own: the endpoint
 * behind the save refuses anybody the site does not list as an administrator, so what this page can do at all is
 * decided a layer down. The gate drawn here is the panel's own courtesy - a signed-out visitor is offered the
 * way in, and a signed-in one who is not an administrator is told so rather than shown an empty form.
 *
 * The second section is the foundation: a page's copy, keyed `page.slug`, stored and served by the very same
 * endpoint. Nothing reads it yet - a page still prints its own words - and that is deliberate: the store, the
 * validation and the way back in are the work, and the first page that reads a key is a page that chooses to.
 */
definePageMeta({ alias: '/ru/admin' })

import backdrop from '~/assets/img/bg-01.webp'
import { EDITABLE_METRIC_MAXIMA } from '#shared/data/siteSettings'
import type { MetricKey } from '#shared/data/historySchema'

const { t } = useI18n()
const localeUrl = useLocaleUrl()

/**
 * Who is reading, from the answer the header's own corner is already drawn from: the same key, so the panel and
 * the Battle.net menu over it cost the site one request rather than two.
 */
const { data: profile } = await useFetch<{ user: { battletag: string | null; isAdmin?: boolean } | null }>(
  '/api/profile',
  { key: 'profile-identity' }
)

const user = computed(() => profile.value?.user ?? null)
const isAdmin = computed(() => user.value?.isAdmin === true)

usePageSeo({
  title: () => t('adminTitle'),
  description: () => t('adminDescription'),
  // An operator's panel is nobody's search result.
  noindex: true
})

const { data: settings, refresh } = await useSiteSettings()

/** The maxima as the fields hold them, which a first render fills and a save re-reads. */
const maximaDraft = reactive<Record<string, string>>({})

/** The stored copy as the rows hold it, in the order the panel drew them. */
const contentDraft = ref<Array<{ key: string; value: string }>>([])

/** Fills both drafts from an answer - what a first render and a refresh alike do. */
function fillDrafts() {
  const maxima = settings.value?.metricMaxima ?? {}

  for (const metric of EDITABLE_METRIC_MAXIMA) {
    const value = maxima[metric]
    maximaDraft[metric] = typeof value === 'number' ? String(value) : ''
  }

  contentDraft.value = Object.entries(settings.value?.content ?? {}).map(([key, value]) => ({ key, value }))
}

fillDrafts()
watch(settings, fillDrafts)

/**
 * What a metric is called, which is the message key the rest of the site already names it by - with the two
 * exceptions the locale files spell differently (`score` is the hall of fame's column, `mPlusScore` is the key).
 */
const METRIC_LABEL: Partial<Record<MetricKey, string>> = { score: 'lbColScore', mPlusScore: 'mPlus' }
const labelOf = (metric: MetricKey) => t(METRIC_LABEL[metric] || metric)

/** The three states a save can be in, said under the buttons rather than as a toast nobody is watching for. */
const saving = ref(false)
const failed = ref(false)
const saved = ref(false)

/**
 * The maxima as the store wants them: a whole number, or `null` for a field that was cleared - which is a figure
 * the operator has deliberately left without a scale, and not a figure that keeps its own total.
 */
function maximaPatch(): Record<string, number | null> {
  const patch: Record<string, number | null> = {}

  for (const metric of EDITABLE_METRIC_MAXIMA) {
    const raw = (maximaDraft[metric] ?? '').replace(/\s+/g, '')
    const value = Number(raw)
    patch[metric] = raw && Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  return patch
}

/** Adds an empty copy row, which is how a key is introduced - nothing is stored until the form is saved. */
function addContentRow() {
  contentDraft.value = [...contentDraft.value, { key: '', value: '' }]
}

/** Drops a row, which the next save turns into a key that is no longer stored. */
function removeContentRow(index: number) {
  contentDraft.value = contentDraft.value.filter((_, at) => at !== index)
}

/** Writes both halves, then re-reads them: what the panel shows is always the store's answer, never the form's. */
async function save() {
  if (saving.value || !isAdmin.value) return

  saving.value = true
  failed.value = false
  saved.value = false

  const content: Record<string, string> = {}
  for (const row of contentDraft.value) {
    const key = row.key.trim()
    if (key) content[key] = row.value
  }

  try {
    await $fetch('/api/admin/settings', { method: 'POST', body: { metricMaxima: maximaPatch(), content } })
    await refresh()
    saved.value = true
  } catch {
    failed.value = true
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="relative min-h-screen">
    <SiteBackdrop :image="backdrop" />

    <SiteHeader :title="t('adminTitle')" :meta="t('adminMeta')" />

    <main class="relative z-10 container mx-auto w-full flex-1 px-4 pb-10 pt-4">
      <!-- The way in, drawn exactly as the account page draws it: the panel is an account's, so a reader who is
           nobody is offered the sign-in rather than a form they cannot save. -->
      <div v-if="!user" class="hoa-panel mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
        <p class="text-lg text-gray-200">{{ t('profileSignedOut') }}</p>
        <a href="/api/auth/login" class="hoa-tab hoa-liquid-glass mt-4 inline-flex px-5 py-2 text-sm font-semibold">
          {{ t('signInBattleNet') }}
        </a>
      </div>

      <!-- Signed in, and not one of the administrators: said plainly rather than drawn as a broken page - the
           endpoint behind the save would refuse this reader anyway (`server/api/admin/settings`). -->
      <div v-else-if="!isAdmin" class="hoa-panel mx-auto mt-10 max-w-xl rounded-2xl p-8 text-center">
        <p class="text-lg font-semibold text-red-400">{{ t('adminDeniedTitle') }}</p>
        <p class="mt-2 text-sm leading-relaxed text-gray-400">{{ t('adminDeniedBody') }}</p>
        <NuxtLink :to="localeUrl('/')" class="hoa-tab hoa-liquid-glass mt-4 inline-flex px-5 py-2 text-sm font-semibold">
          {{ t('backToSearch') }}
        </NuxtLink>
      </div>

      <div v-else class="mx-auto max-w-3xl space-y-6">
        <!-- The maxima the comparison board measures a row against. Only the figures whose size nobody publishes,
             and only those: a collection's total arrives with its own reading and is never stated here. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ t('adminMetricMaximaTitle') }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('adminMetricMaximaHint') }}</p>

          <div class="mt-4 grid gap-3 sm:grid-cols-3">
            <label v-for="metric in EDITABLE_METRIC_MAXIMA" :key="metric" class="block">
              <span class="block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                {{ labelOf(metric) }}
              </span>
              <input
                v-model="maximaDraft[metric]"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                :placeholder="t('adminMetricEmpty')"
                class="mt-1 w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-semibold tabular-nums text-white outline-none transition-colors placeholder:font-normal placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60"
              >
            </label>
          </div>

          <p class="mt-3 text-[11px] leading-relaxed text-gray-500">{{ t('adminMetricEmptyHint') }}</p>
        </section>
        <!-- The foundation: a page's copy, keyed `page.slug`. Nothing reads it yet - the store, the validation and
             the way in are what this section establishes - so it draws the shape of a row and no more. -->
        <section class="hoa-panel rounded-2xl p-4 sm:p-5">
          <h2 class="text-sm font-bold uppercase tracking-wider text-white sm:text-base">
            {{ t('adminContentTitle') }}
          </h2>
          <p class="mt-1 text-xs leading-relaxed text-gray-400">{{ t('adminContentHint') }}</p>

          <p v-if="!contentDraft.length" class="mt-4 text-xs text-gray-500">{{ t('adminContentEmpty') }}</p>

          <ul v-else class="mt-4 space-y-2">
            <li v-for="(row, index) in contentDraft" :key="index" class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="row.key"
                type="text"
                autocomplete="off"
                spellcheck="false"
                :placeholder="t('adminContentKey')"
                class="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs font-semibold text-white outline-none transition-colors placeholder:font-normal placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60 sm:w-64"
              >
              <input
                v-model="row.value"
                type="text"
                autocomplete="off"
                :placeholder="t('adminContentValue')"
                class="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-wow-gold/60 focus:bg-black/60"
              >
              <button
                type="button"
                class="shrink-0 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:border-red-400/50 hover:bg-red-500/20"
                :aria-label="t('adminContentRemove')"
                :title="t('adminContentRemove')"
                @click="removeContentRow(index)"
              >
                {{ t('adminContentRemove') }}
              </button>
            </li>
          </ul>

          <button
            type="button"
            class="hoa-tab hoa-liquid-glass mt-3 inline-flex px-4 py-2 text-xs font-semibold"
            @click="addContentRow"
          >
            {{ t('adminContentAdd') }}
          </button>
        </section>

        <!-- The save, with the three answers it can give under it: what the panel shows afterwards is the store's
             own reply rather than the form's, so a value the store dropped does not look like a value it kept. -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="hoa-tab hoa-liquid-glass px-5 py-2.5 text-sm font-semibold"
            :class="{ 'hoa-tab-active': saved }"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? t('adminSaving') : t('adminSave') }}
          </button>

          <p v-if="saved" class="text-xs font-semibold text-emerald-400">{{ t('adminSaved') }}</p>
          <p v-else-if="failed" class="text-xs font-semibold text-red-400">{{ t('adminSaveFailed') }}</p>
        </div>
      </div>
    </main>

    <SiteFooter />
  </div>
</template>

