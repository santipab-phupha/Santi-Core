import type { FeedItem } from "../src/data-types"
import type { NewsVerification } from "../src/news-review-types"
import { newsReviewInput } from "../src/news-review-types.ts"
import { isReferenceUrl, verificationKey } from "./news-verification.ts"
import type { AgentsConfig } from "./eleven-agent"
import type { ReviewStore } from "./impact-review"

export const SOURCE_READER_VERSION = 2
export type SourceCheck = NewsVerification & { excerpt: string; structured: string; readerVersion?: number }
export function matchingSourceQuote(source: string, item: FeedItem): { quote: string; text: string; index: number } | null {
  const text = source.replace(/\s+/g, " ").trim()
  const fold = (value: string) => value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").toLowerCase()
  const candidates = [item.title.slice(0, 220), ...(item.summary?.split(/(?<=[.!?])\s+/).slice(0, 3).map(value => value.slice(0, 220)) ?? [])]
  for (const candidate of candidates) {
    const needle = candidate.replace(/\s+/g, " ").trim()
    if (needle.length < 8) continue
    const index = fold(text).indexOf(fold(needle))
    if (index >= 0) return { text, index, quote: text.slice(index, index + needle.length) }
  }
  return null
}

// The reference worker performs HTTP/text matching only: no LLM, no outside
// search, and no assumption that a successful HTTP response proves a headline.
export function createOriginalSourceChecker(options: {
  config: AgentsConfig; store: ReviewStore; signal: AbortSignal
  read: (url: unknown) => Promise<unknown>
}) {
  const { config, store, signal, read } = options
  const concurrency = config.referenceCheckConcurrency ?? 6
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) throw new Error("Invalid reference worker concurrency")
  let active = 0
  const queue: { resolve: () => void; reject: (reason: unknown) => void }[] = []
  signal.addEventListener("abort", () => { for (const item of queue.splice(0)) item.reject(signal.reason) }, { once: true })
  async function acquire() {
    signal.throwIfAborted()
    if (active < concurrency) { active++; return }
    await new Promise<void>((resolve, reject) => queue.push({ resolve, reject }))
  }
  function release() {
    active--
    const next = queue.shift()
    if (next) { active++; next.resolve() }
  }
  return async function check(item: FeedItem, force = false): Promise<SourceCheck> {
    signal.throwIfAborted()
    const key = verificationKey(config, item)
    const cached = await store.get(key) as SourceCheck | undefined
    const age = cached ? Date.now() - Date.parse(cached.checkedAt) : Infinity
    if ((!force || cached?.status === "approved") && cached?.input === newsReviewInput(item) && cached.method && typeof cached.excerpt === "string" &&
      (cached.status === "approved" || cached.readerVersion === SOURCE_READER_VERSION) &&
      age >= 0 && age < (cached.status === "approved" ? 21_600_000 : 1_800_000)) return cached
    await acquire()
    try {
      signal.throwIfAborted()
      const checkedAt = new Date().toISOString()
      let result: SourceCheck
      if (item.unlock && isReferenceUrl(item.url)) {
        const structured = JSON.stringify(item.unlock)
        result = { id: item.id, input: newsReviewInput(item), status: "approved", method: "provider-data", checkedAt, excerpt: "", structured,
          reason: "The unlock fields came from the configured Tokenomist API. This is provider data; webpage text was not checked.",
          references: [{ url: item.url, title: item.title, source: item.source, kind: "structured", retrievedAt: checkedAt, quote: structured.slice(0, 220) }] }
      } else {
        const value = isReferenceUrl(item.url) ? await read(item.url) as { available: boolean; text?: string } : { available: false }
        signal.throwIfAborted()
        const match = value.available && value.text ? matchingSourceQuote(value.text, item) : null
        const start = match ? Math.max(0, match.index - 180) : 0
        result = { id: item.id, input: newsReviewInput(item), status: match ? "approved" : "unverified", method: "original-link-match", checkedAt,
          excerpt: match ? match.text.slice(start, start + 1800) : "", structured: "",
          reason: match ? "The publisher headline or supplied excerpt was matched directly on its original link. This checks source correspondence, not factual truth."
            : value.available ? "The original page was accessible, but its text did not match the supplied headline or publisher excerpt."
              : "The original link could not provide readable matching text within the source-check limit. This does not establish that the story is false.",
          references: match ? [{ url: item.url, title: item.title, source: item.source, kind: "publisher", quote: match.quote, retrievedAt: checkedAt }] : [] }
      }
      result.readerVersion = SOURCE_READER_VERSION
      await store.set(key, result, result.status === "approved" ? 21_600 : 1800)
      return result
    } finally { release() }
  }
}
