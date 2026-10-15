type PollerOptions = {
  interval: number
  run: (signal: AbortSignal) => Promise<void>
  onOffline: (offline: boolean) => void
  now: () => number
  online: () => boolean
  schedule: (callback: () => void, delay: number) => unknown
  cancel: (timer: unknown) => void
}

// Serial requests keep refresh clicks, focus and network events from overlapping.
export function startResourcePoller(options: PollerOptions) {
  const controller = new AbortController()
  let timer: unknown
  let busy = false
  let stopped = false
  let queued = false
  let completedAt: number | null = null
  function clearTimer() {
    if (timer !== undefined) options.cancel(timer)
    timer = undefined
  }
  async function refresh() {
    if (stopped || busy) return
    clearTimer()
    const offline = !options.online()
    options.onOffline(offline)
    if (offline) return
    busy = true
    try {
      await options.run(controller.signal)
    } catch {
      // The consumer reports request errors while automatic retries continue.
    } finally {
      busy = false
      completedAt = options.now()
      if (!stopped && options.online()) {
        const delay = queued ? 0 : options.interval
        queued = false
        timer = options.schedule(() => { void refresh() }, delay)
      }
    }
  }
  function resume(force = false) {
    if (stopped) return
    options.onOffline(!options.online())
    if (force && busy) queued = true
    if (force || completedAt === null || options.now() - completedAt >= options.interval)
      void refresh()
  }
  void refresh()
  return {
    refresh: () => { void refresh() },
    resume,
    offline() {
      if (stopped) return
      clearTimer()
      options.onOffline(true)
    },
    stop() {
      stopped = true
      clearTimer()
      controller.abort()
    },
  }
}
