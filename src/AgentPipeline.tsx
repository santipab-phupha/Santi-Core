import { useEffect, useState } from "react"
import type { SourceQueueStatus } from "./news-review-types"
import { pipelineNodes } from "./pipeline-status"
import type { FeedActivity, ImpactActivity, PipelineNode } from "./pipeline-status"
import "./agent-pipeline.css"

function PipelineAvatar({ kind }: { kind: PipelineNode["id"] }) {
  return <svg className="pipeline-avatar" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 13V7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="32" cy="5" r="3" fill="currentColor" />
    <path d="M10 32H7v13h5m42-13h3v13h-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <rect x="12" y="15" width="40" height="40" rx="15" fill="currentColor" fillOpacity=".95" />
    <path d="M20 56h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".45" />
    <rect x="17" y="26" width="30" height="21" rx="9" fill="#12111d" />
    <rect x="23" y="32" width="4" height="6" rx="2" fill="currentColor" /><rect x="37" y="32" width="4" height="6" rx="2" fill="currentColor" />
    <path d="M28 42h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    {kind === "feed" ? <g stroke="#10131e" strokeWidth="1.6" strokeLinecap="round"><path d="M27 21h10m-10 3h6" /></g>
      : kind === "sources" ? <path d="m28 21 3 3 5-6" stroke="#101a17" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      : <path d="m32 17 1.5 3.5L37 22l-3.5 1.5L32 27l-1.5-3.5L27 22l3.5-1.5L32 17Z" fill="#1b1225" />}
  </svg>
}

export default function AgentPipeline({ feed, queue, sourceError, impact, symbol }: {
  feed: FeedActivity; queue?: SourceQueueStatus; sourceError: string; impact: ImpactActivity | null; symbol: string
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (feed.loading || feed.offline || feed.error || feed.checkedAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [feed.loading, feed.offline, feed.error, feed.checkedAt])
  const nodes = pipelineNodes(feed, queue, sourceError, impact, symbol, Math.max(now, feed.checkedAt ?? 0))
  return <ol className="agent-pipeline" aria-label="Automatic research pipeline">
    {nodes.map(node => <li key={node.id} className={`pipeline-node pipeline-${node.id} is-${node.state}`} tabIndex={0} aria-label={`${node.name}: ${node.label}. ${node.detail}`}>
      <div className="pipeline-orb">
        <svg className="pipeline-ring" viewBox="0 0 88 88" fill="none" aria-hidden="true">
          <circle className="pipeline-ring-track" cx="44" cy="44" r="31" />
          <circle className="pipeline-ring-progress" cx="44" cy="44" r="31" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - node.progress)} transform="rotate(-90 44 44)" />
          {Array.from({length:6},(_,index) => <circle className={`pipeline-segment ${node.state === "running" || node.progress >= (index + 1) / 6 ? "is-lit" : ""}`} key={index} cx="44" cy="44" r="40" pathLength="100" strokeDasharray="11.5 88.5" transform={`rotate(${index * 60 - 80} 44 44)`} />)}
          {node.state === "running" && <circle className="pipeline-ring-running" cx="44" cy="44" r="31" pathLength="100" strokeDasharray="24 76" />}
        </svg>
        <span className="pipeline-face"><PipelineAvatar kind={node.id} /></span>
        <span className="pipeline-state-dot" aria-hidden="true" />
      </div>
      <span className="pipeline-name">{node.name}</span>
      <span className="pipeline-state-label">{node.label}</span>
      <span className="pipeline-tooltip" aria-hidden="true">{node.detail}</span>
    </li>)}
  </ol>
}
