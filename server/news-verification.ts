import { createHash } from "node:crypto"
import type { FeedItem, FeedResponse } from "../src/data-types"
import type { NewsReviewResponse, NewsVerification } from "../src/news-review-types"
import { newsReviewInput } from "../src/news-review-types.ts"
import type { AgentsConfig } from "./eleven-agent"
import type { ReviewStore } from "./impact-review"

const referenceHosts = new Set(["coindesk.com", "www.coindesk.com", "cointelegraph.com", "decrypt.co", "insights.unlocks.app", "tokenomist.ai"])
export function isReferenceUrl(raw: string) {
  try { const url = new URL(raw); return url.protocol === "https:" && referenceHosts.has(url.hostname) && !url.port && !url.username && !url.password }
  catch { return false }
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
export const reviewNamespace = (config: AgentsConfig) => `v5:${hash(`${config.apiKey}:${config.model}:${config.impactAgentId ?? "default"}:${config.impactThinkingBudget ?? 1024}`)}:`
// Reference checks are public text matching and are reused across assets/models.
export const verificationKey = (_config: AgentsConfig, item: FeedItem) => `source-v2:${hash(newsReviewInput(item))}`
export function publicVerification(value: NewsVerification): NewsVerification {
  return { id: value.id, input: value.input, status: value.status, reason: value.reason,
    references: value.references, checkedAt: value.checkedAt, method: value.method, impactReviewedAt: value.impactReviewedAt }
}

export async function readNewsReviews(feed: FeedResponse, config: AgentsConfig, store: ReviewStore): Promise<NewsReviewResponse> {
  const items = await Promise.all(feed.items.map(async item => {
    const key = verificationKey(config, item)
    const saved = await store.get(key) as NewsVerification | undefined
    const current = !feed.stale && saved?.input === newsReviewInput(item) ? publicVerification(saved) : undefined
    const processing = await store.get(`${key}:job:processing`) as { expires?: number } | undefined
    const sourceProcessing = await store.get(`${key}:job:source`) as { expires?: number } | undefined
    const sourceError = await store.get(`${key}:job:source-error`)
    const error = await store.get(`${key}:job:error`)
    const empty = { id: item.id, input: newsReviewInput(item), references: [], checkedAt: "" }
    if (!feed.stale && processing && Number(processing.expires) > Date.now()) return { ...(current ?? empty), status: "processing" as const,
      reason: current?.references.length ? "Original source matched. Impact analysis is running." : "Checking the original publisher link." }
    if (!feed.stale && sourceProcessing && Number(sourceProcessing.expires) > Date.now()) return { ...(current ?? empty), status: "processing" as const, reason: "Checking the original publisher link." }
    if (sourceError && !current) return { ...empty, status: "error" as const, reason: "Source checking was interrupted. The local queue will retry shortly." }
    if (error) return { ...(current ?? empty), status: "error" as const, reason: "The review could not complete. No new impact verdict was produced." }
    if (current?.status === "unverified" || (current?.status === "approved" && current.impactReviewedAt)) return current
    if (current?.status === "approved" && current.references.length) return { ...current, status: "source-checked" as const, reason: "Original source checked. Asset impact has not been analyzed yet." }
    return { ...(current ?? empty), status: "pending" as const, reason: feed.stale ? "The feed is stale. A fresh source review is required."
      : current?.references.length ? "Original source matched. Awaiting impact analysis." : "Awaiting original-link check." }
  }))
  return { items }
}
