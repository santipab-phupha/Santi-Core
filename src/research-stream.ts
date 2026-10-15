import type { ResearchEvent } from "./research-chat-types"

export async function readResearchStream(response: Response, onEvent: (event: ResearchEvent) => void) {
  if (!response.body) throw new Error("The research response was empty.")
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = "", completed = false, size = 0
  const line = (raw: string) => {
    if (!raw.trim()) return
    const event = JSON.parse(raw) as ResearchEvent
    if (!event || !["phase", "result", "error", "heartbeat"].includes(event.type)) throw new Error("Invalid research response.")
    if (event.type === "error") throw new Error(event.message)
    if (event.type === "result") {
      if (completed || !event.answer || !Array.isArray(event.answer.sections) || typeof event.answer.summary !== "string") throw new Error("Invalid research answer.")
      completed = true
    }
    onEvent(event)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      size += value?.length ?? 0
      if (size > 250_000) throw new Error("The research answer exceeds the size limit.")
      pending += decoder.decode(value, { stream: !done })
      let end: number
      while ((end = pending.indexOf("\n")) >= 0) { line(pending.slice(0, end)); pending = pending.slice(end + 1) }
      if (done) break
    }
    line(pending)
    if (!completed) throw new Error("Research was interrupted before the answer completed. Please retry.")
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
