import type { SourceQueueStatus as Queue } from "./news-review-types"

export default function SourceQueueStatus({ queue }: { queue?: Queue }) {
  if (!queue?.enabled) return null
  return <div className="news-source-queue" role="status">
    Source checks <strong>{queue.checked}/{queue.total}</strong> · {queue.running ? "Checking sources…" : queue.pending || queue.failed ? "Waiting for next scan" : "Up to date"}
    <small>{queue.matched} matched · {queue.unverified} no evidence{queue.pending ? ` · ${queue.pending} pending` : ""}{queue.failed ? ` · ${queue.failed} interrupted` : ""} · Source checking uses no AI credits.</small>
    {queue.error && <small>{queue.error}</small>}
  </div>
}
