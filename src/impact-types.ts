import type { ImpactEvidence, ImpactTone } from "./coin-impact"

export type ImpactLabel = ImpactTone | "neutral"
export type ImpactClassification = {
  id: string
  input: string
  label: ImpactLabel
  reason: string
  quote: string
  basis: "headline" | "excerpt" | "structured"
  classifiedAt: string
}
export type ImpactReview = {
  coinId: string
  model: string
  labels: ImpactClassification[]
  newlyReviewed: number
  pending?: number
}
export const impactInput = (coinId: string, row: ImpactEvidence) =>
  JSON.stringify([coinId, row.id, row.url, row.title, row.at, row.scope, row.scope === "tokenomics" ? row.reason : ""])

export function reviewedEvidence(coinId: string, rows: ImpactEvidence[], review: ImpactReview | null, fresh: boolean) {
  const evidence: (ImpactEvidence & { agent?: ImpactClassification })[] = []
  const context: (ImpactEvidence & { agent?: ImpactClassification })[] = []
  const pending: ImpactEvidence[] = []
  const counts: Record<ImpactTone, number> = { positive: 0, negative: 0, unknown: 0 }
  for (const row of rows) {
    if (row.id.startsWith("supply:")) { context.push(row); continue }
    const label = fresh && review?.coinId === coinId
      ? review.labels.find((item) => item.id === row.id && item.input === impactInput(coinId, row)) : undefined
    if (!label) { pending.push(row); continue }
    const item = { ...row, tone: label.label === "neutral" ? "unknown" as const : label.label,
      reason: label.reason, agent: label }
    if (label.label === "neutral") context.push(item)
    else { evidence.push(item); counts[item.tone]++ }
  }
  return { evidence, context, pending, counts }
}
