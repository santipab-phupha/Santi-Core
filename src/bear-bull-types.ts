export type DebateSide = "bull" | "bear"
export type DebatePhase = "context" | "research" | "debate" | "complete"
export type DebateSource = {
  url: string
  title: string
  origin: "feed" | "web"
}
export type DebateClaim = {
  id: string
  title: string
  argument: string
  caveat: string
  sources: DebateSource[]
}
export type DebateOpening = {
  side: DebateSide
  summary: string
  claims: DebateClaim[]
  gaps: string[]
}
export type DebateReply = {
  claimId: string
  position: "challenge" | "concede" | "uncertain"
  argument: string
  sources: DebateSource[]
}
export type DebateRebuttal = {
  side: DebateSide
  summary: string
  replies: DebateReply[]
}
export type DebateResult = {
  audioToken?: string
  reportId: string
  coinId: string
  coinName: string
  symbol: string
  model: string
  reasoning: string
  createdAt: string
  dataAt: string
  openings: Record<DebateSide, DebateOpening>
  rebuttals: Record<DebateSide, DebateRebuttal>
  sources: DebateSource[]
  gaps: string[]
  usage: {
    requests: number
    inputTokens: number | null
    outputTokens: number | null
  }
}
export type DebateEvent = {
  type: "phase"
  phase: DebatePhase
} | {
  type: "agent"
  side: DebateSide
  task: "research" | "debate"
  status: "running" | "done"
} | {
  type: "opening"
  opening: DebateOpening
} | {
  type: "rebuttal"
  rebuttal: DebateRebuttal
} | {
  type: "result"
  result: DebateResult
  cached: boolean
} | {
  type: "error"
  message: string
  code: string
} | { type: "heartbeat" }
export type DebateConfig = {
  configured: boolean
  model: string
  reasoning: string
}
