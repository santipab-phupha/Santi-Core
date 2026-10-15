import type { DebateResult, DebateSide, DebateSource } from "../src/bear-bull-types"
import type { AudioManifest, AudioTurn } from "../src/audio-types"

function spoken(value: string) {
  return value.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "").replace(/[*#`]/g, "").trim()
}
// Split without dropping content. Thai often has no spaces between words.
export function splitSpeech(value: string, limit = 1_000): string[] {
  const points = Array.from(value)
  const parts: string[] = []
  while (points.length) {
    let end = Math.min(points.length, limit)
    if (points.length > limit) {
      for (let i = limit - 1; i > limit * .65; i--) if (/[\s.!?。]/u.test(points[i])) { end = i + 1; break }
    }
    const part = points.splice(0, end).join("").trim()
    if (part) parts.push(part)
  }
  return parts
}
export function buildAudioManifest(result: DebateResult): AudioManifest {
  const turns: AudioTurn[] = []
  const add = (side: DebateSide, title: string, text: string, sources: DebateSource[] = []) => {
    splitSpeech(spoken(text)).forEach((part) => turns.push({ id: String(turns.length), side, title, text: part, sources }))
  }
  add("bull", "Bull · Overview", `I'm Bull. Let's review ${result.coinName}, ${result.symbol}. ${result.openings.bull.summary}`)
  add("bear", "Bear · Overview", `I'm Bear. ${result.openings.bear.summary}`)
  const sides: DebateSide[] = ["bull", "bear"]
  const max = Math.max(...sides.map((side) => result.openings[side].claims.length))
  for (let i = 0; i < max; i++) for (const side of sides) {
    const claim = result.openings[side].claims[i]
    if (!claim) continue
    const other = side === "bull" ? "bear" : "bull"
    const reply = result.rebuttals[other].replies.find((reply) => reply.claimId === claim.id)
    if (!reply) throw new Error("Cannot narrate an incomplete debate")
    add(side, claim.title, `${claim.title} ${claim.argument} The caveat is: ${claim.caveat}`, claim.sources)
    const response = { challenge: "I challenge this claim.", concede: "I concede this specific claim based on the available evidence.", uncertain: "There is insufficient evidence on this point." }[reply.position]
    add(other, `Response: ${claim.title}`, `${response} ${reply.argument}`, reply.sources)
  }
  add("bear", "Open questions", `Evidence gaps: ${[...result.openings.bull.gaps, ...result.openings.bear.gaps, ...result.gaps].join(" ") || "Evidence should be reviewed as conditions change."} These two roles use the same model. Agreement is not independent verification and does not establish price direction.`)
  if (turns.length > 100 || turns.reduce((sum, turn) => sum + Array.from(turn.text).length, 0) > 60_000) throw new Error("Audio report exceeds limits")
  return { reportId: result.reportId, coinName: result.coinName, symbol: result.symbol, createdAt: result.createdAt,
    characters: turns.reduce((sum, turn) => sum + Array.from(turn.text).length, 0), turns }
}
