<script setup lang="ts">
/**
 * One metric's panel: its history, and the leaderboard's distribution of it.
 *
 * Drawn under a stat row of the comparison board, once per column. The history is that column's own
 * character (`/api/history`), and it is a series of its own - two players' points are never merged into one
 * dataset. The distribution is the population's (`/api/distribution`), so the very same answer is handed to
 * both columns and each panel marks both players on one shared histogram.
 *
 * Both charts are interactive without a library: the histogram colours the bucket this column's character
 * falls into and reads any bucket on hover, and the history draws a crosshair through the point nearest the
 * cursor. Two small SVGs, which scale to the column's width and render on the server like everything else.
 */
import type { DistributionResponse, HistorySeries, HistorySeriesPoint, MetricKey } from '#shared/data/historySchema'
import { DISTRIBUTION_METRICS } from '#shared/data/historySchema'
import { formatNumber } from '#shared/utils/formatNumber'

/** One side of the comparison, as the legend names it. */
interface PanelPlayer {
  key: string
  name: string
  hex: string
}

const props = defineProps<{
  metric: MetricKey
  /** This column's character's history for the metric, or `null` while it is on its way or failed. */
  history: HistorySeries | null
  pending: boolean
  failed: boolean
  /** The metric's shared distribution, or `null` while it is on its way. */
  distribution: DistributionResponse | null
  /** The two players of the comparison, in the order the legend reads them. */
  players: PanelPlayer[]
  /** This column's player, whose marker and bucket the panel emphasizes. */
  highlight: string
}>()

const { t, locale } = useI18n()

/** Whether the canonical leaderboard carries this metric at all, so a histogram can be drawn of it. */
const distributable = computed(() => (DISTRIBUTION_METRICS as readonly string[]).includes(props.metric))

/** The message key that names the metric, which both tooltips lead with. */
const METRIC_LABELS: Record<MetricKey, string> = {
  score: 'lbColScore',
  ilvl: 'itemLevel',
  mPlusScore: 'mPlus',
  achievements: 'achievements',
  mounts: 'mounts',
  pets: 'pets',
  toys: 'toys',
  decor: 'decor',
  reputations: 'reputations',
  titles: 'titles',
  quests: 'quests',
  recipes: 'recipes',
  transmogs: 'transmogs',
  honorableKills: 'honorableKills',
  honorLevel: 'honorLevel'
}
const metricLabel = computed(() => t(METRIC_LABELS[props.metric]))

type Period = '7d' | '30d' | '90d' | '1y' | 'max'
const PERIODS: Array<{ key: Period; days: number | null }> = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: '1y', days: 365 },
  { key: 'max', days: null }
]
const period = ref<Period>('max')
const view = ref<'line' | 'table'>('line')

const points = computed<HistorySeriesPoint[]>(() => props.history?.points ?? [])

/**
 * The points the chosen period keeps, read against the newest point on file rather than the wall clock - so
 * the first render is the same on the server and in the browser, and the range does not drift on a page that
 * was left open (`max` keeps everything, which is what the first paint draws).
 */
const visible = computed(() => {
  const spec = PERIODS.find((entry) => entry.key === period.value)
  if (!spec?.days || !points.value.length) return points.value

  const newest = points.value[points.value.length - 1]!.takenAt
  const cutoff = newest - spec.days * 86400
  return points.value.filter((point) => point.takenAt >= cutoff)
})

/** The drawn points: the period's, with the null figures a partial read left out. */
const drawn = computed(() =>
  visible.value.filter((point): point is { takenAt: number; value: number } => typeof point.value === 'number')
)

const CHART_W = 320
const CHART_H = 120
const PAD_Y = 6
const Y_TICKS = 5
const X_TICKS = 4

/**
 * The line's geometry: the path, the per-point positions the crosshair indexes, and the two value ends.
 *
 * The x axis is the whole width (`CHART_W`), which is what lets the cursor's own ratio across the element be
 * turned back into a moment without a second mapping. `null` for a history too short to draw a line through.
 */
const chart = computed(() => {
  const series = drawn.value
  if (series.length < 2) return null

  const t0 = series[0]!.takenAt
  const t1 = series[series.length - 1]!.takenAt
  const vMin = Math.min(...series.map((point) => point.value))
  const vMax = Math.max(...series.map((point) => point.value))
  const tSpan = t1 - t0 || 1
  const vSpan = vMax - vMin || 1

  const points = series.map((point) => ({
    x: ((point.takenAt - t0) / tSpan) * CHART_W,
    y: PAD_Y + (1 - (point.value - vMin) / vSpan) * (CHART_H - 2 * PAD_Y),
    takenAt: point.takenAt,
    value: point.value
  }))

  return {
    path: points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '),
    points,
    vMin,
    vMax,
    t0,
    t1
  }
})

/** The horizontal gridlines' positions, top to bottom. */
const yTicks = computed(() => {
  if (!chart.value) return []
  return Array.from({ length: Y_TICKS }, (_, index) => PAD_Y + (index / (Y_TICKS - 1)) * (CHART_H - 2 * PAD_Y))
})

/**
 * The vertical gridlines and their date labels, left to right.
 *
 * The ends align to their own edge rather than centring on it, which is what keeps the first and last date
 * inside the chart instead of hanging off it by half a label.
 */
const xTicks = computed(() => {
  const geometry = chart.value
  if (!geometry) return []

  return Array.from({ length: X_TICKS }, (_, index) => {
    const share = index / (X_TICKS - 1)
    return {
      takenAt: geometry.t0 + (geometry.t1 - geometry.t0) * share,
      leftPercent: share * 100,
      align: index === 0 ? 'start' : index === X_TICKS - 1 ? 'end' : 'center'
    }
  })
})
/** The crosshair: the point nearest the cursor, or `null` while the cursor is off the chart. */
const hoveredIndex = ref<number | null>(null)
const hoveredPoint = computed(() => {
  const geometry = chart.value
  if (!geometry || hoveredIndex.value === null) return null
  return geometry.points[hoveredIndex.value] ?? null
})

const chartEl = ref<HTMLElement | null>(null)

/** The point nearest the cursor: the cursor's ratio across the element is the moment it stands over. */
function onChartMove(event: MouseEvent): void {
  const geometry = chart.value
  const element = chartEl.value
  if (!geometry || !element) return

  const rect = element.getBoundingClientRect()
  if (!rect.width) return

  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const moment = geometry.t0 + ratio * (geometry.t1 - geometry.t0)

  let nearest = 0
  let distance = Infinity
  geometry.points.forEach((point, index) => {
    const delta = Math.abs(point.takenAt - moment)
    if (delta < distance) {
      distance = delta
      nearest = index
    }
  })

  hoveredIndex.value = nearest
}

function onChartLeave(): void {
  hoveredIndex.value = null
}

/**
 * The tooltip's two moments: the reader's own clock and UTC.
 *
 * This is the one date on the panel that is *not* pinned to UTC, and it is safe to leave unpinned because the
 * tooltip exists only under the cursor - it is never part of the server's render, so a reader's own zone can
 * never be a hydration mismatch. Both moments are the same instant, which is exactly what the pair is for.
 */
const momentFormat = computed(() =>
  new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
)
const utcMomentFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'UTC'
    })
)

const hoveredMoments = computed(() => {
  const point = hoveredPoint.value
  if (!point) return null

  const date = new Date(point.takenAt * 1000)
  return { local: momentFormat.value.format(date), utc: utcMomentFormat.value.format(date) }
})

/** The name the tooltip signs the figure with: this column's player, in their own colour. */
const hoveredPlayer = computed(() => props.players.find((player) => player.key === props.highlight) ?? null)

/**
 * A date on the axis, pinned to UTC.
 *
 * The points are UTC seconds (`snapshots.taken_at`), and pinning the zone is what keeps the server's render
 * and the browser's hydration byte-for-byte the same - a local-time format would read one way on the server
 * and another in a reader's own zone, which is a hydration mismatch rather than a feature.
 */
const dateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC'
    })
)

function dateLabel(takenAt: number): string {
  return dateFormat.value.format(new Date(takenAt * 1000))
}

/** The axis's own date: numeric and compact, because a narrow column has no room for month names. */
const axisDateFormat = computed(
  () =>
    new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    })
)

function axisDateLabel(takenAt: number): string {
  return axisDateFormat.value.format(new Date(takenAt * 1000))
}

/** A share of the population, to four places - the precision the distribution tooltip prints. */
const shareFormat = computed(
  () =>
    new Intl.NumberFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    })
)

function shareLabel(value: number): string {
  return shareFormat.value.format(value)
}

/** The table the `Table` view draws: every point, and how much it moved since the one before it. */
const rows = computed(() =>
  visible.value.map((point, index) => {
    const previous = index > 0 ? visible.value[index - 1]!.value : null
    const delta = typeof point.value === 'number' && typeof previous === 'number' ? point.value - previous : null
    return { takenAt: point.takenAt, value: point.value, delta }
  })
)

/** The histogram's own range, which is the population's - the same for every panel of the comparison. */
const distMin = computed(() => props.distribution?.bins[0]?.from ?? 0)
const distMax = computed(() => {
  const bins = props.distribution?.bins ?? []
  return bins.length ? bins[bins.length - 1]!.to : 0
})
const maxBin = computed(() => Math.max(0, ...(props.distribution?.bins ?? []).map((bin) => bin.count)))

/**
 * The buckets with the two figures a tooltip reads off them: the share of the population each holds, and the
 * percentile band it spans - the cumulative share below it, up to the cumulative share including it. The
 * band's width is the share, which is what makes the two lines of the tooltip agree.
 */
const binStats = computed(() => {
  const bins = props.distribution?.bins ?? []
  const population = props.distribution?.population ?? 0
  let below = 0

  return bins.map((bin) => {
    const from = below
    below += bin.count
    return {
      ...bin,
      share: population ? (bin.count / population) * 100 : 0,
      percentileFrom: population ? (from / population) * 100 : 0,
      percentileTo: population ? (below / population) * 100 : 0
    }
  })
})

/** The legend: each player's own figure and the place the table gives it, or nothing where it has none. */
const legend = computed(() =>
  props.players.map((player) => {
    const position = (props.distribution?.positions ?? []).find((entry) => entry.key === player.key)
    return {
      ...player,
      value: position?.value ?? null,
      percentile: position?.percentile ?? null,
      rank: position?.rank ?? null
    }
  })
)

/** The bucket this column's character falls into, or `-1` for one with no figure to place. */
const highlightBin = computed(() => {
  const value = legend.value.find((entry) => entry.key === props.highlight)?.value
  if (typeof value !== 'number') return -1
  return binStats.value.findIndex((bin) => value >= bin.from && value <= bin.to)
})

/** The bucket under the cursor, or `null` while the cursor is off the histogram. */
const hoveredBin = ref<number | null>(null)
const hoveredBinStat = computed(() => (hoveredBin.value === null ? null : (binStats.value[hoveredBin.value] ?? null)))
const hoveredBinLeftPercent = computed(() =>
  hoveredBin.value === null || !binStats.value.length ? 0 : ((hoveredBin.value + 0.5) / binStats.value.length) * 100
)

const histogramEl = ref<HTMLElement | null>(null)

/** The bucket the cursor stands over, read off the whole strip rather than the bars - so the thin gaps between
 * them are not a flicker. */
function onHistogramMove(event: MouseEvent): void {
  const element = histogramEl.value
  const bins = binStats.value
  if (!element || !bins.length) return

  const rect = element.getBoundingClientRect()
  if (!rect.width) return

  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  hoveredBin.value = Math.min(bins.length - 1, Math.floor(ratio * bins.length))
}

function onHistogramLeave(): void {
  hoveredBin.value = null
}

/**
 * The fill of one bar: the bucket this column's character falls into wears their own class colour, the bucket
 * under the cursor is lifted, and every other bar keeps the site's own blue.
 */
function barFill(index: number): string {
  if (index === highlightBin.value && hoveredPlayer.value) return hoveredPlayer.value.hex
  if (index === hoveredBin.value) return 'rgba(56, 189, 248, 0.85)'
  return 'rgba(14, 165, 233, 0.45)'
}

/** A dash for a figure that is not there, the way the board prints one. */
function print(value: number | null): string {
  return typeof value === 'number' ? formatNumber(value) : '—'
}
</script>

<template>
  <div class="space-y-3">
    <!-- The distribution: the population's histogram, shared by both columns. The bucket this column's
         character falls into wears their colour, and any bucket can be read under the cursor. -->
    <section class="rounded-xl border border-white/10 bg-black/25 p-3">
      <h4 class="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-300">{{ $t('distributionTitle') }}</h4>

      <p v-if="!distribution" class="flex h-56 items-center justify-center text-xs text-gray-500">{{ $t('loading') }}</p>
      <p v-else-if="!distributable" class="flex h-56 items-center justify-center text-xs text-gray-500">{{ $t('distributionUnavailable') }}</p>
      <p v-else-if="!binStats.length" class="flex h-56 items-center justify-center text-xs text-gray-500">{{ $t('historyNoData') }}</p>
      <template v-else>
        <div ref="histogramEl" class="relative" @mousemove="onHistogramMove" @mouseleave="onHistogramLeave">
          <svg viewBox="0 0 100 42" class="h-40 w-full" preserveAspectRatio="none" role="img" :aria-label="metricLabel">
            <line x1="0" y1="40" x2="100" y2="40" class="stroke-white/20" stroke-width="1" vector-effect="non-scaling-stroke" />
            <rect
              v-for="(bin, index) in binStats"
              :key="index"
              :x="(index / binStats.length) * 100"
              :width="100 / binStats.length - 0.4"
              :y="40 - (maxBin ? (bin.count / maxBin) * 38 : 0)"
              :height="maxBin ? (bin.count / maxBin) * 38 : 0"
              :fill="barFill(index)"
            />
            <line
              v-if="hoveredBin !== null"
              :x1="hoveredBinLeftPercent"
              :x2="hoveredBinLeftPercent"
              y1="1"
              y2="40"
              class="stroke-white/45"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <!-- The bucket under the cursor: its range, its share of the population, and the percentile band.
               Pinned to the corner so it never moves under the cursor, over a blurred plate so the bars
               beneath it stay legible. -->
          <div
            v-if="hoveredBinStat"
            class="pointer-events-none absolute left-0 top-0 z-10 w-max max-w-[17rem] rounded-lg border border-white/15 bg-wow-dark/90 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur-md"
          >
            <p class="font-semibold text-white">
              {{ formatNumber(hoveredBinStat.from) }} – {{ formatNumber(hoveredBinStat.to) }} {{ metricLabel }}
            </p>
            <p class="text-gray-300">{{ $t('distributionShare', { share: shareLabel(hoveredBinStat.share) }) }}</p>
            <p class="text-gray-300">
              {{ $t('distributionPercentile', { from: shareLabel(hoveredBinStat.percentileFrom), to: shareLabel(hoveredBinStat.percentileTo) }) }}
            </p>
          </div>
        </div>

        <div class="mt-1 flex justify-between text-[10px] tabular-nums text-gray-500">
          <span>{{ formatNumber(distMin) }}</span>
          <span>{{ formatNumber(distMax) }}</span>
        </div>

        <!-- The legend: each player's own figure and the place the table gives it. -->
        <ul class="mt-2 space-y-1">
          <li v-for="entry in legend" :key="entry.key" class="flex items-center gap-2 text-xs">
            <span class="h-2.5 w-2.5 shrink-0 rounded-sm" :style="{ backgroundColor: entry.hex }" />
            <span class="min-w-0 flex-1 truncate" :class="entry.key === highlight ? 'font-semibold text-white' : 'text-gray-300'">
              {{ entry.name }}
            </span>
            <span class="shrink-0 tabular-nums text-white">{{ print(entry.value) }}</span>
            <span v-if="entry.percentile !== null" class="shrink-0 text-[10px] font-semibold text-wow-goldLight">
              {{ $t('historyTop', { percent: entry.percentile }) }}
            </span>
          </li>
        </ul>
      </template>
    </section>

    <!-- The history: this column's own character, a line or a table, over the chosen period. Under the cursor
         a crosshair is drawn through the nearest point and that point is read out. -->
    <section class="rounded-xl border border-white/10 bg-black/25 p-3">
      <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 class="text-[11px] font-bold uppercase tracking-wider text-gray-300">{{ $t('historyTitle') }}</h4>

        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="entry in PERIODS"
            :key="entry.key"
            type="button"
            class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
            :class="period === entry.key ? 'bg-wow-gold/25 text-wow-goldLight' : 'text-gray-400 hover:bg-white/10'"
            @click="period = entry.key"
          >{{ $t(`historyPeriod_${entry.key}`) }}</button>
          <span class="mx-0.5 h-3 w-px bg-white/15" />
          <button
            type="button"
            class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
            :class="view === 'line' ? 'bg-wow-gold/25 text-wow-goldLight' : 'text-gray-400 hover:bg-white/10'"
            @click="view = 'line'"
          >{{ $t('historyViewLine') }}</button>
          <button
            type="button"
            class="rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
            :class="view === 'table' ? 'bg-wow-gold/25 text-wow-goldLight' : 'text-gray-400 hover:bg-white/10'"
            @click="view = 'table'"
          >{{ $t('historyViewTable') }}</button>
        </div>
      </div>

      <p v-if="pending" class="flex h-44 items-center justify-center text-xs text-gray-500">{{ $t('loading') }}</p>
      <p v-else-if="failed" class="flex h-44 items-center justify-center text-xs text-gray-500">{{ $t('historyError') }}</p>
      <p v-else-if="!points.length" class="flex h-44 items-center justify-center text-xs text-gray-500">{{ $t('historyNoData') }}</p>

      <template v-else-if="view === 'line'">
        <div v-if="chart" class="flex items-start gap-2">
          <div ref="chartEl" class="relative min-w-0 flex-1" @mousemove="onChartMove" @mouseleave="onChartLeave">
            <svg viewBox="0 0 320 120" class="h-40 w-full" preserveAspectRatio="none" role="img" :aria-label="metricLabel">
              <line
                v-for="y in yTicks"
                :key="'h' + y"
                x1="0"
                :y1="y"
                x2="320"
                :y2="y"
                class="stroke-white/10"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
              <line
                v-for="tick in xTicks"
                :key="'v' + tick.leftPercent"
                :x1="(tick.leftPercent / 100) * 320"
                y1="0"
                :x2="(tick.leftPercent / 100) * 320"
                y2="120"
                class="stroke-white/[0.06]"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
              <path
                :d="chart.path"
                fill="none"
                stroke="currentColor"
                class="text-wow-goldLight"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                vector-effect="non-scaling-stroke"
              />
              <template v-if="hoveredPoint">
                <line :x1="hoveredPoint.x" :x2="hoveredPoint.x" y1="0" y2="120" class="stroke-white/40" stroke-width="1" vector-effect="non-scaling-stroke" />
                <circle :cx="hoveredPoint.x" :cy="hoveredPoint.y" r="3.5" fill="#ffffff" class="stroke-wow-goldLight" stroke-width="2" vector-effect="non-scaling-stroke" />
              </template>
            </svg>

            <!-- The moment axis, under the chart at the same shares of its width: numeric and small, because
                 a narrow column has no room for month names. -->
            <div class="relative mt-1 h-3.5">
              <span
                v-for="tick in xTicks"
                :key="'x' + tick.leftPercent"
                class="absolute whitespace-nowrap text-[10px] tabular-nums text-gray-500"
                :class="tick.align === 'start' ? 'left-0' : tick.align === 'end' ? 'right-0' : '-translate-x-1/2'"
                :style="tick.align === 'center' ? { left: tick.leftPercent + '%' } : {}"
              >{{ axisDateLabel(tick.takenAt) }}</span>
            </div>

            <!-- The point under the cursor: the metric and both clocks, pinned to the corner over a blurred
                 plate. The figure itself is left out on purpose - the row above the board already prints it. -->
            <div
              v-if="hoveredPoint && hoveredMoments"
              class="pointer-events-none absolute left-0 top-0 z-10 w-max max-w-[18rem] rounded-lg border border-white/15 bg-wow-dark/90 px-2.5 py-1.5 text-[11px] shadow-xl backdrop-blur-md"
            >
              <p class="font-semibold text-white">{{ metricLabel }}</p>
              <p class="text-gray-300">{{ $t('historyTooltipLocal', { time: hoveredMoments.local }) }}</p>
              <p class="text-gray-300">{{ $t('historyTooltipUtc', { time: hoveredMoments.utc }) }}</p>
            </div>
          </div>
        </div>
        <p v-else class="flex h-44 items-center justify-center text-xs text-gray-500">{{ $t('historyTooShort') }}</p>
      </template>

      <table v-else class="w-full text-xs">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-gray-500">
            <th class="py-1 text-left font-semibold">{{ $t('historyColumnDate') }}</th>
            <th class="py-1 text-right font-semibold">{{ $t('historyColumnValue') }}</th>
            <th class="py-1 text-right font-semibold">{{ $t('historyColumnChange') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.takenAt" class="border-t border-white/5">
            <td class="py-1 text-gray-300">{{ dateLabel(row.takenAt) }}</td>
            <td class="py-1 text-right tabular-nums text-white">{{ print(row.value) }}</td>
            <td
              class="py-1 text-right tabular-nums"
              :class="row.delta === null ? 'text-gray-500' : row.delta > 0 ? 'text-emerald-300' : row.delta < 0 ? 'text-rose-300' : 'text-gray-400'"
            >
              {{ row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${formatNumber(row.delta)}` }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

