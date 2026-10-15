import { randomUUID } from "node:crypto"
import type { FeedItem, FeedResponse } from "../src/data-types"
import type { SourceQueueStatus } from "../src/news-review-types"
import { newsReviewInput } from "../src/news-review-types.ts"
import type { AgentsConfig } from "./eleven-agent"
import type { ReviewStore } from "./impact-review"
import { createEvidenceReader } from "./evidence-reader.ts"
import { createOriginalSourceChecker, SOURCE_READER_VERSION } from "./original-source-checker.ts"
import type { SourceCheck } from "./original-source-checker"
import { verificationKey } from "./news-verification.ts"

function waitFor<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export function createSourceReviewService(options: {
  getConfig: () => AgentsConfig
  store: ReviewStore
  fetcher?: typeof fetch
  read?: (url: unknown, signal: AbortSignal) => Promise<unknown>
  getFeed: () => Promise<FeedResponse>
  intervalMs?: number
}) {
  const config = options.getConfig(), { store } = options
  const controller = new AbortController()
  const owner = randomUUID()
  const inflight = new Map<string, Promise<SourceCheck>>()
  const checkOriginal = createOriginalSourceChecker({ config, store, signal: controller.signal,
    read: options.read ? url => options.read!(url, controller.signal) : async url => {
      if (typeof url !== "string") return { available: false }
      const reader = createEvidenceReader(new Map([[url, { url, title: "Original publisher", origin: "feed" as const }]]), controller.signal, options.fetcher,
        { timeoutMs: config.referenceCheckTimeoutMs ?? 6000, includeHeading: true, minimumLength: 8 })
      return reader(url)
    },
  })
  let enabled = false, running = false, timer: ReturnType<typeof setTimeout> | undefined
  let latest: FeedResponse | undefined, updatedAt = "", lastError = ""
  let pass: Promise<void> | undefined

  async function cached(item: FeedItem, force = false) {
    const value = await store.get(verificationKey(config, item)) as SourceCheck | undefined
    const age = value ? Date.now() - Date.parse(value.checkedAt) : Infinity
    return value?.input === newsReviewInput(item) && value.method && typeof value.excerpt === "string"
      && (value.status === "approved" || value.readerVersion === SOURCE_READER_VERSION)
      && age >= 0 && age < (value.status === "approved" ? 21_600_000 : 1_800_000)
      && (!force || value.status === "approved") ? value : undefined
  }
  async function check(item: FeedItem, signal: AbortSignal, force = false): Promise<SourceCheck> {
    signal.throwIfAborted(); controller.signal.throwIfAborted()
    const key = verificationKey(config, item)
    const existing = await cached(item, force)
    if (existing) return existing
    signal.throwIfAborted()
    let work = inflight.get(key)
    if (!work) {
      // All callers, including the background queue and asset analysts, share
      // one source task. A visitor leaving does not cancel other consumers.
      work = (async () => {
        await store.set(`${key}:job:source`, { owner, expires: Date.now() + 300_000 }, 300)
        try {
          const value = await checkOriginal(item, force)
          await store.delete(`${key}:job:source-error`)
          return value
        } catch (error) {
          if (!controller.signal.aborted) await store.set(`${key}:job:source-error`, true, 60).catch(() => {})
          throw error
        } finally {
          inflight.delete(key)
          const marker = await store.get(`${key}:job:source`).catch(() => undefined) as { owner?: string } | undefined
          if (marker?.owner === owner) await store.delete(`${key}:job:source`).catch(() => {})
          updatedAt = new Date().toISOString()
        }
      })()
      inflight.set(key, work)
    }
    return waitFor(work, signal)
  }
  async function status(): Promise<SourceQueueStatus> {
    const items = latest?.items.filter(item => !item.snapshot) ?? []
    let matched = 0, unverified = 0, failed = 0
    for (const item of items) {
      const value = await cached(item)
      if (value) { if (value.status === "approved") matched++; else unverified++ }
      else if (await store.get(`${verificationKey(config, item)}:job:source-error`)) failed++
    }
    return { enabled, running, total: items.length, checked: matched + unverified, matched, unverified,
      pending: items.length - matched - unverified - failed, failed, updatedAt, ...(lastError ? { error: lastError } : {}) }
  }
  async function runOnce(feed?: FeedResponse) {
    if (pass) return pass
    pass = (async () => {
      running = true
      try {
        controller.signal.throwIfAborted()
        latest = feed ?? await options.getFeed()
        if (latest.stale) throw new Error("Fresh news is required for source checks.")
        const items = latest.items.filter(item => !item.snapshot)
        let cursor = 0
        const failures: unknown[] = []
        const worker = async () => {
          while (cursor < items.length && !controller.signal.aborted) {
            const item = items[cursor++]
            try { await check(item, controller.signal) } catch (error) { failures.push(error) }
          }
        }
        await Promise.all(Array.from({ length: Math.min(config.referenceCheckConcurrency ?? 6, items.length) }, worker))
        if (failures.length) throw new Error("Some source checks could not complete. They will retry on the next local scan.")
        lastError = ""
      } catch (error) {
        if (!controller.signal.aborted) lastError = error instanceof Error && error.message === "Fresh news is required for source checks." ? error.message : "Source checks could not complete. The local queue will retry shortly."
      } finally { running = false; pass = undefined; updatedAt = new Date().toISOString() }
    })()
    return pass
  }
  async function tick() {
    await runOnce()
    if (enabled && !controller.signal.aborted) { timer = setTimeout(() => { void tick() }, options.intervalMs ?? 60_000); timer.unref?.() }
  }
  return {
    check, status, runOnce,
    start() { if (!enabled && !controller.signal.aborted) { enabled = true; void tick() } },
    async stop() { enabled = false; clearTimeout(timer); controller.abort(); await Promise.allSettled([...inflight.values()]); await pass },
    async verifiedFeed(feed: FeedResponse, signal: AbortSignal): Promise<FeedResponse> {
      // AI receives supported sources only. Failed sources remain visible in
      // the public feed; filtering applies solely to its analysis copy.
      if (feed.stale) throw new Error("Fresh news is required before analysis.")
      const checks = await Promise.all(feed.items.map(async item => ({ item, source: item.snapshot ? null : await check(item, signal) })))
      signal.throwIfAborted()
      const items = checks.filter(({ item, source }) => item.snapshot || source?.status === "approved").map(({ item }) => item)
      return { ...feed, items, sourceCoverage: { total: feed.items.length, supported: items.length, excluded: feed.items.length - items.length } }
    },
  }
}
