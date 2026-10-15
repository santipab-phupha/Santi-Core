export type ResearchMessage = { role: "user" | "assistant"; content: string }
export type ResearchReference = {
  url: string
  title: string
  source: string
  publishedAt: string
  level: "headline" | "publisher-summary" | "article-excerpt" | "structured-data"
}
export type ResearchAnswer = {
  summary: string
  sections: { heading: string; text: string; references: ResearchReference[] }[]
  gaps: string[]
  createdAt: string
  dataAt: string
  model: string
}
export type ResearchEvent = { type: "phase"; phase: "context" | "research" | "writing"; detail?: string }
  | { type: "result"; answer: ResearchAnswer }
  | { type: "error"; message: string }
  | { type: "heartbeat" }
