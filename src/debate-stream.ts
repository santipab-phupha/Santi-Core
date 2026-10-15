import type { DebateEvent } from "./bear-bull-types"

export async function readDebateStream(
  response: Response,
  onEvent: (event: DebateEvent) => void,
) {
  if (!response.body) throw new Error("The browser did not receive an analysis stream.")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let completed = false
  const line = (raw: string) => {
    if (!raw.trim()) return
    let event: DebateEvent
    try {
      event = (JSON.parse(raw) as DebateEvent)
    } catch {
      throw new Error("The analysis stream was interrupted. Please try again.")
    }
    if (
      !event ||
      typeof event !== "object" ||
      ![
        "phase",
        "agent",
        "opening",
        "rebuttal",
        "result",
        "error",
        "heartbeat",
      ].includes(event.type)
    )
      throw new Error("Invalid analysis stream format.")
    if (event.type === "error") throw new Error(event.message)
    if (event.type === "result") completed = true
    onEvent(event)
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      if (pending.length > 1_000_000)
        throw new Error("The analysis exceeds the size limit.")
      let end: number
      while ((end = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, end))
        pending = pending.slice(end + 1)
      }
      if (done) break
    }
    line(pending)
    if (!completed) throw new Error("The connection ended before the agents completed their responses. Please try again.")
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
