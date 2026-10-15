import type { SourceQueueStatus } from "./news-review-types"

export type ImpactActivity = { coinId: string; enabled: boolean; busy: boolean; error: string; reviewed: number; pending: number }
export type FeedActivity = { loading: boolean; offline: boolean; error: string; checkedAt: number | null; count: number; stale: boolean }
export type PipelineNode = { id: "feed" | "sources" | "impact"; name: string; state: "running" | "idle" | "error" | "paused"; label: string; detail: string; progress: number }
const ratio = (done: number, total: number) => total > 0 ? Math.max(0, Math.min(1, done / total)) : 0

export function pipelineNodes(feed: FeedActivity, queue: SourceQueueStatus | undefined, sourceError: string, impact: ImpactActivity | null, symbol: string, now: number): PipelineNode[] {
  const elapsed = feed.checkedAt === null ? 0 : Math.max(0, now - feed.checkedAt)
  const seconds = Math.max(0, Math.ceil((60_000 - elapsed) / 1000))
  const news: PipelineNode = { id: "feed", name: "News feed", state: feed.offline ? "paused" : feed.loading ? "running" : feed.error || feed.stale ? "error" : "idle",
    label: feed.offline ? "Offline" : feed.loading ? "Fetching…" : feed.error || feed.stale ? "Feed delayed" : feed.checkedAt === null ? "Waiting" : seconds ? `Next ${seconds}s` : "Refresh due",
    detail: `${feed.count} news and tokenomics items. Checks every minute while connected.`, progress: feed.loading ? 1 : feed.checkedAt === null ? 0 : ratio(elapsed, 60_000) }
  const sources: PipelineNode = { id: "sources", name: "Source check", state: queue?.running ? "running" : sourceError || queue?.error || queue?.failed ? "error" : "idle",
    label: queue?.running ? `Checking ${queue.checked}/${queue.total}` : sourceError ? "Unavailable" : queue?.failed ? `${queue.failed} interrupted` : queue?.pending ? `${queue.pending} queued` : queue?.enabled ? queue.total ? "Up to date" : "Waiting" : "On demand",
    detail: sourceError || queue?.error || (queue ? `${queue.matched} matched · ${queue.unverified} no evidence · ${queue.pending} pending. Opens original publisher links; uses no AI credits.` : "Source checks run before impact analysis. Queue status is not available yet."),
    progress: queue ? ratio(queue.checked, queue.total) : 0 }
  const analyst: PipelineNode = { id: "impact", name: "Impact AI", state: impact?.error ? "error" : impact?.busy ? "running" : "idle",
    label: impact?.error ? "Needs retry" : impact?.busy ? "Reviewing…" : !impact?.enabled ? "Waiting for data" : impact.pending ? `${impact.pending} pending` : "Reviewed",
    detail: impact ? `${symbol} · ${impact.reviewed} reviewed · ${impact.pending} pending. ${impact.error || "Classifies supported news as positive, negative or inconclusive. Cached reviews are reused."}` : `Waiting for the ${symbol} review status.`,
    progress: impact ? ratio(impact.reviewed, impact.reviewed + impact.pending) : 0 }
  return [news, sources, analyst]
}
