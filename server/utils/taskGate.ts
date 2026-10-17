/**
 * A gate that lets only so many heavy tasks run at once, and queues - boundedly - the rest.
 *
 * A card is drawn by a native rasteriser and a native encoder, each of which holds tens of megabytes of
 * pixels outside the V8 heap for as long as it runs, and the host has 416 MiB for the whole site. Three cards
 * asked for at the same moment are three of those peaks at once; one after another they are three peaks that
 * never overlap. The queue is a list of promises, not a loop: nothing here blocks the event loop, requests
 * for other pages are answered while a card waits its turn.
 *
 * The queue is bounded too. A crawler that asks for a thousand cards must not be answered by a thousand
 * pending closures; past `maxQueue` a task is refused at once with a 503 and a `Retry-After`, which a
 * crawler understands and a reader's retry survives.
 */
export interface TaskGate {
  /** Runs `task` when a slot is free, and settles with what it settles with. */
  run<T>(task: () => Promise<T>): Promise<T>
  /** How many tasks are running right now. */
  readonly active: number
  /** How many tasks are waiting for a slot. */
  readonly waiting: number
}

export function createTaskGate(limit: number, maxQueue = 16): TaskGate {
  const queue: Array<() => void> = []
  let active = 0

  function release(): void {
    const next = queue.shift()

    // The slot goes straight to the next waiter, so `active` never dips and a late arrival cannot cut in.
    if (next) next()
    else active--
  }

  const gate: TaskGate = {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= limit) {
        if (queue.length >= maxQueue) {
          throw createError({
            statusCode: 503,
            statusMessage: 'The renderer is busy, try again in a moment',
            data: { retryAfter: '5' }
          })
        }

        await new Promise<void>((resolve) => queue.push(resolve))
      } else {
        active++
      }

      try {
        return await task()
      } finally {
        release()
      }
    },

    get active() {
      return active
    },

    get waiting() {
      return queue.length
    }
  }

  return gate
}
