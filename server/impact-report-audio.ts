import { randomUUID } from "node:crypto"
import type { AudioManifest, AudioTurn } from "../src/audio-types"
import type { ImpactReportSnapshot } from "../src/impact-report"
import { splitSpeech } from "./debate-audio.ts"

// Narrate the same source-checked snapshot shown in Report, without a new model call.
export function buildImpactAudio(report: ImpactReportSnapshot): AudioManifest {
  const turns: AudioTurn[] = []
  const add = (title: string, text: string) => {
    const spoken = text.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "").replace(/[*#`]/g, "").trim()
    for (const part of splitSpeech(spoken)) turns.push({ id: String(turns.length), side: "bull", title, text: part, sources: [] })
  }
  add(`${report.symbol} Report`, `${report.symbol} report. Completed, source-checked news reviews.${report.fresh ? "" : " Fresh market and news data are unavailable. This report may be incomplete."}`)
  for (const tone of ["positive", "negative"] as const) {
    const items = report[tone]
    const title = tone === "positive" ? "Positive news" : "Negative news"
    add(title, `${title}. ${items.length} ${items.length === 1 ? "signal" : "signals"}.${items.length ? "" : ` No source-checked ${tone} signals yet.`}`)
    items.forEach((item, index) => {
      const sources = [...new Set(item.agent?.verification?.references.map(ref => ref.source) ?? [])]
      add(`${title} · ${index + 1}`, `${index + 1}. ${item.title}. ${item.reason} Source: ${sources.join(", ")}.`)
    })
  }
  add("Coverage", `${report.inconclusive} inconclusive. ${report.pending} awaiting review. ${report.context} context. These are excluded from the two columns. News within 72 hours and upcoming unlocks. End of report.`)
  const characters = turns.reduce((sum, turn) => sum + Array.from(turn.text).length, 0)
  if (turns.length > 100 || characters > 60_000) throw new Error("Audio report exceeds limits")
  return { reportId: randomUUID(), coinName: report.symbol, symbol: report.symbol, createdAt: report.generatedAt, characters, turns }
}
