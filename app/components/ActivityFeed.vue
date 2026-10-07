<script setup lang="ts">
// The feed's own shape, shared with the endpoint that builds it, so a field means the same
// thing to the server that filled it in and to the card that draws it (see `#shared/utils/activity`).
import type { ActivityItem } from '#shared/utils/activity'

defineProps<{
  /** The most recently earned achievements, newest first. */
  items: ActivityItem[]
  /** The character's total achievement points, printed beside the heading. */
  totalPoints: number
}>()

// The wording and the exact moment of each event (see the composable).
const { formatRelative, formatAbsolute } = useRelativeTime()

/**
 * The look of a card, picked by the accent the server put on the item.
 *
 * Three parts travel together - the frame of the card, the ring around the icon and the node
 * on the rail - so a feat of strength and a raid read as different kinds of event at a glance,
 * and everything else wears the brand gold an achievement is drawn in.
 */
const ACCENTS = {
  feat: {
    // A feat of strength is a proof rather than progress, so its card is warmed with gold.
    card: 'border-amber-400/40 bg-gradient-to-br from-amber-500/[0.16] via-white/[0.04] to-fuchsia-500/[0.06]',
    frame: 'border-amber-400/80 shadow-[0_0_18px_rgba(245,158,11,0.55)]',
    node: 'bg-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.9)]',
    badge: 'border-amber-400/50 bg-amber-500/15 text-amber-200'
  },
  raid: {
    // A dungeon, a raid or a Mythic+ key wears the violet the game itself marks them with.
    card: 'border-violet-400/40 bg-gradient-to-br from-violet-500/[0.16] via-white/[0.04] to-sky-500/[0.06]',
    frame: 'border-violet-400/80 shadow-[0_0_18px_rgba(139,92,246,0.55)]',
    node: 'bg-violet-400 shadow-[0_0_14px_rgba(139,92,246,0.9)]',
    badge: 'border-violet-400/50 bg-violet-500/15 text-violet-200'
  },
  plain: {
    card: '',
    frame: 'border-wow-gold/50',
    node: 'bg-wow-gold shadow-[0_0_10px_rgba(248,183,0,0.75)]',
    badge: 'border-wow-gold/40 bg-wow-gold/10 text-wow-goldLight'
  }
} as const

function accentOf(item: ActivityItem) {
  return ACCENTS[item.accent ?? 'plain']
}
</script>

<template>
  <section class="mx-auto max-w-3xl">
    <!-- The heading of the feed: what the list is, and the running total it belongs to. -->
    <div class="mb-5 flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-base font-bold uppercase tracking-wider text-gray-200 sm:text-lg">
        {{ $t('recentAchievements') }}
      </h2>
      <span class="text-xs text-gray-400 sm:text-sm">
        {{ $t('achievements') }}:
        <b class="text-white tabular-nums">{{ totalPoints.toLocaleString('en-US') }}</b>
      </span>
    </div>

    <!-- The timeline: a rail down the left that every card hangs from, each event a node on it.
         The rail fades out at the bottom so the list reads as ongoing rather than cut off. -->
    <ol class="relative">
      <span
        class="pointer-events-none absolute bottom-6 left-[26px] top-2 w-px bg-gradient-to-b from-wow-gold/50 via-white/10 to-transparent"
        aria-hidden="true"
      />

      <li
        v-for="item in items"
        :key="`${item.id}-${item.completedAt}`"
        class="relative pb-5 pl-16 last:pb-0"
      >
        <!-- The node on the rail, coloured by the kind of event. -->
        <span
          class="absolute left-[18px] top-4 h-4 w-4 rounded-full ring-4 ring-wow-dark"
          :class="accentOf(item).node"
          aria-hidden="true"
        />

        <article
          class="hoa-panel p-3.5 transition-transform duration-200 hover:-translate-y-0.5 sm:p-4"
          :class="accentOf(item).card"
        >
          <div class="flex items-start gap-3.5">
            <!-- The icon in a WoW-style frame: a filled square with the ring the game draws
                 around an achievement, warmed for the accent the card carries. -->
            <span
              class="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border-2 bg-black/50"
              :class="accentOf(item).frame"
            >
              <img
                v-if="item.icon"
                :src="item.icon"
                :alt="item.name"
                loading="lazy"
                class="h-full w-full object-cover"
              />
              <AppIcon v-else name="achievments" class="h-6 w-6 opacity-70" />
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-2">
                <h3 class="text-base font-bold leading-snug text-white sm:text-lg">{{ item.name }}</h3>
                <span
                  v-if="item.points"
                  class="shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold tabular-nums"
                  :class="accentOf(item).badge"
                >
                  +{{ item.points }}
                </span>
              </div>

              <p v-if="item.description" class="mt-1 text-sm leading-relaxed text-gray-400">
                {{ item.description }}
              </p>

              <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                <!-- How long ago it happened, with the exact moment on hover. -->
                <span
                  class="group/date relative cursor-help font-medium text-gray-300"
                  :title="formatAbsolute(item.completedAt)"
                >
                  {{ formatRelative(item.completedAt) }}
                  <span
                    class="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-black/90 px-2.5 py-1 text-[11px] font-medium text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.6)] backdrop-blur group-hover/date:block"
                  >
                    {{ formatAbsolute(item.completedAt) }}
                  </span>
                </span>
                <span v-if="item.category" class="truncate">{{ item.category }}</span>
              </div>
            </div>
          </div>
        </article>
      </li>
    </ol>
  </section>
</template>