import type { FeedItem } from "./data-types"
import type { NewsReviewResponse, NewsReviewState } from "./news-review-types"
import { newsReviewInput } from "./news-review-types"
import type useNewsReviews from "./useNewsReviews"
import "./news-review.css"

export type NewsReviews = ReturnType<typeof useNewsReviews>
export function newsReviewState(item: FeedItem, data: NewsReviewResponse): NewsReviewState {
  return data.items.find(value => value.id === item.id && value.input === newsReviewInput(item)) ?? {
    id: item.id, input: newsReviewInput(item), status: "pending", reason: "This story has not completed source review.", references: [], checkedAt: "",
  }
}
export function newsReviewClass(item: FeedItem, data: NewsReviewResponse) {
  return `news-state-${item.snapshot ? "provider" : newsReviewState(item, data).status}`
}
const names = { pending: "Pending", processing: "Processing", approved: "Approved", unverified: "No evidence", error: "Review failed", "source-checked": "Source checked" }

export default function NewsReviewDetails({ item, reviews }: { item: FeedItem; reviews: NewsReviews }) {
  const state = newsReviewState(item, reviews.data)
  if (item.snapshot) return <div className="news-review"><span className="news-review-badge provider" title="Provider data snapshot; not an AI-reviewed news story.">Provider data</span><a className="news-original-link" href={item.url} target="_blank" rel="noreferrer">Source ↗</a></div>
  const retry = state.status === "pending" || state.status === "error" || state.status === "unverified" || state.status === "source-checked"
  return <div className="news-review">
    <div className="news-review-heading">
      <span className={`news-review-badge ${state.status}`} title={state.status === "approved" ? "Source check and impact analysis completed. This does not certify factual truth." : state.reason}>
        <i aria-hidden="true">{state.status === "approved" || state.status === "source-checked" ? "✓" : state.status === "unverified" ? "!" : ""}</i>{names[state.status]}
      </span>
      {retry && <button className="news-review-action" onClick={() => { void reviews.review(item.id) }} disabled={reviews.activeId !== null}>
        {reviews.activeId === item.id ? "Checking…" : state.references.length ? "Analyze impact" : state.status === "pending" ? "Review sources" : "Retry sources"}
      </button>}
    </div>
    {state.status === "processing" && <p className="news-review-note">{state.references.length ? "Ref. matched · Analyzing impact…" : "Checking the original link…"}</p>}
    {state.status === "source-checked" && <p className="news-review-note">Reference checked · awaiting asset impact analysis.</p>}
    {state.references.length > 0 && <>
      <div className="news-reference-links"><span>Ref.</span>{state.references.map((reference, index) => <a key={reference.url} href={reference.url} title={reference.title} aria-label={`Reference: ${reference.source}, ${reference.title}`} target="_blank" rel="noreferrer">{index + 1}. {reference.source} ↗</a>)}</div>
      <details className="news-review-evidence"><summary>Review evidence</summary>
        <p>{state.reason}</p>
        {state.references.map(reference => <div key={reference.url}><a href={reference.url} target="_blank" rel="noreferrer">{reference.kind === "related" ? "Related report" : reference.kind === "related_feed" ? "Related RSS excerpt" : reference.kind === "publisher_feed" ? "Publisher RSS excerpt" : reference.kind === "structured" ? "Provider data" : "Original publisher link"}: {reference.title} ↗</a><blockquote>{reference.quote}</blockquote></div>)}
        <small>{state.method === "provider-data" ? "Structured fields were supplied by the provider API." : "Text was matched directly on the original link."} This checks source correspondence, not factual truth.</small>
      </details>
    </>}
    {state.status === "unverified" && <div className="news-review-missing"><p>{state.reason}</p><p>Inconclusive for related assets · no supporting evidence mapped.</p><a className="news-original-link" href={item.url} target="_blank" rel="noreferrer">Publisher link ↗</a></div>}
    {state.status === "error" && <p className="news-review-note">{state.reason}</p>}
    {reviews.activeId === item.id && reviews.error && <p className="news-review-note" role="status">{reviews.error}</p>}
  </div>
}
