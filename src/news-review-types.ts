import type { FeedItem } from "./data-types"

export type NewsReference = {
  url: string
  title: string
  source: string
  quote: string
  kind: "publisher" | "publisher_feed" | "related" | "related_feed" | "structured"
  retrievedAt: string
}
export type NewsVerification = {
  id: string
  input: string
  status: "approved" | "unverified"
  reason: string
  references: NewsReference[]
  checkedAt: string
  method?: "original-link-match" | "provider-data"
  impactReviewedAt?: string
}
export type NewsReviewState = Omit<NewsVerification, "status"> & {
  status: NewsVerification["status"] | "pending" | "processing" | "error" | "source-checked"
}
export type SourceQueueStatus = { enabled: boolean; running: boolean; total: number; checked: number; matched: number; unverified: number; pending: number; failed: number; updatedAt: string; error?: string }
export type NewsReviewResponse = { items: NewsReviewState[]; sourceQueue?: SourceQueueStatus }
export const newsReviewInput = (item: Pick<FeedItem, "id" | "url" | "title" | "publishedAt" | "unlock" | "summary">) =>
  JSON.stringify([item.id, item.url, item.title, item.publishedAt, item.unlock ?? null, item.summary ?? ""])
