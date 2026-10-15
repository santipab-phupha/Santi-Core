import type { DebateSide } from "./bear-bull-types"

export default function AgentAvatar({ side }: { side: DebateSide }) {
  return <svg className="agent-avatar" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    {side === "bull" ? <path d="M19 26C5 24 5 12 10 7c0 10 7 9 13 11M45 26c14-2 14-14 9-19 0 10-7 9-13 11" fill="currentColor" opacity=".75" />
      : <><circle cx="15" cy="18" r="10" fill="currentColor" opacity=".65" /><circle cx="49" cy="18" r="10" fill="currentColor" opacity=".65" /></>}
    <rect x="11" y="17" width="42" height="39" rx="17" fill="currentColor" />
    <rect x="17" y="25" width="30" height="21" rx="10" fill="white" fillOpacity=".92" />
    <g className="agent-eyes" fill="currentColor"><rect x="23" y="31" width="5" height="7" rx="2.5" /><rect x="36" y="31" width="5" height="7" rx="2.5" /></g>
    <path d="M28 42h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M27 53h10" stroke="white" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round" />
  </svg>
}
