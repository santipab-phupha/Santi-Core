import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { FeedResponse, MarketResponse } from "../src/data-types"
import type { ResearchAnswer, ResearchEvent, ResearchMessage } from "../src/research-chat-types"
import { AgentError } from "./eleven-agent.ts"
import type { AgentsConfig, AgentTask } from "./eleven-agent.ts"
import { runResearch } from "./research-engine.ts"

class RequestError extends Error {
  readonly status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}
export function parseResearchRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid research request.")
  const body = value as Record<string, unknown>
  if (Object.keys(body).some(key => !["question", "history", "sessionId", "requestId"].includes(key))
    || typeof body.question !== "string" || !body.question.trim() || body.question.length > 4000
    || !Array.isArray(body.history) || body.history.length > 10
    || [body.sessionId, body.requestId].some(id => typeof id !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(id))) throw new RequestError("Enter a question of up to 4,000 characters and valid conversation context.")
  const history: ResearchMessage[] = body.history.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Invalid conversation context.")
    const item = value as Record<string, unknown>
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 3000
      || Object.keys(item).some(key => key !== "role" && key !== "content")) throw new RequestError("Invalid conversation context.")
    return { role: item.role, content: item.content }
  })
  if (history.reduce((size, item) => size + item.content.length, 0) > 30_000) throw new RequestError("Conversation context is too long.")
  return { question: body.question.trim(), history, sessionId: body.sessionId as string, requestId: body.requestId as string }
}

export function createResearchApi(options: {
  getConfig: () => AgentsConfig
  getData: (signal: AbortSignal) => Promise<[MarketResponse, FeedResponse]>
  taskRunner?: (task: AgentTask) => Promise<unknown>
  fetcher?: typeof fetch
}) {
  const active = new Set<string>()
  const cache = new Map<string, { fingerprint: string; answer: ResearchAnswer; expires: number }>()
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const route = req.url?.split("?")[0]
    if (route !== "/api/research" && route !== "/api/research/config") return false
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)])
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let lock: string | undefined
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    const emit = (event: ResearchEvent) => { if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + "\n") }
    const json = (status: number, value: unknown) => { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)) }
    res.setHeader("Cache-Control", "no-store")
    res.on("close", disconnect)
    try {
      const method = route.endsWith("/config") ? "GET" : "POST"
      if (req.method !== method) { res.setHeader("Allow", method); throw new RequestError(`${method} required.`, 405) }
      const config = options.getConfig()
      const configured = Boolean(config.apiKey && config.researchAgentId)
      if (method === "GET") { json(200, { configured, provider: "ElevenLabs Agents", model: config.model }); return true }
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw new RequestError("Ask research questions from this website.", 403)
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new RequestError("A JSON request is required.", 415)
      if (!configured) throw new RequestError("The ElevenLabs Research Agent is not configured yet.", 503)
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) { const part = Buffer.from(chunk); size += part.length; if (size > 65_536) throw new RequestError("The request exceeds the size limit.", 413); chunks.push(part) }
      let body: unknown
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new RequestError("Invalid JSON request.") }
      const input = parseResearchRequest(body)
      const owner = createHash("sha256").update(`${config.apiKey}:${config.model}:${config.researchAgentId}:${input.sessionId}`).digest("hex")
      const key = `${owner}:${input.requestId}`
      const fingerprint = createHash("sha256").update(JSON.stringify({ question: input.question, history: input.history })).digest("hex")
      for (const [key, entry] of cache) if (entry.expires < Date.now()) cache.delete(key)
      const saved = cache.get(key)
      if (saved && saved.fingerprint !== fingerprint) throw new RequestError("Use a new request ID for a different question.")
      if (!saved && (active.has(owner) || active.size >= 3)) { res.setHeader("Retry-After", "10"); throw new RequestError("Research is busy. Wait for the current answer or try again shortly.", 429) }
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
      res.setHeader("X-Accel-Buffering", "no")
      res.flushHeaders()
      if (saved) { emit({ type: "result", answer: saved.answer }); res.end(); return true }
      active.add(owner); lock = owner
      heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000)
      emit({ type: "phase", phase: "context", detail: "Loading shared news and market data" })
      const [market, feed] = await options.getData(signal)
      signal.throwIfAborted()
      const answer = await runResearch({ config, market, feed, question: input.question, history: input.history, signal, emit, taskRunner: options.taskRunner, fetcher: options.fetcher })
      signal.throwIfAborted()
      if (cache.size >= 32) cache.delete(cache.keys().next().value!)
      cache.set(key, { answer, fingerprint, expires: Date.now() + 600_000 })
      emit({ type: "result", answer }); res.end()
    } catch (cause) {
      controller.abort()
      const message = cause instanceof RequestError || cause instanceof AgentError ? cause.message
        : signal.aborted && signal.reason?.name === "TimeoutError" ? "Research timed out. Please try again."
        : "Research could not complete. Please try again later."
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) { emit({ type: "error", message }); res.end() }
        else json(cause instanceof RequestError ? cause.status : 503, { error: message })
      }
    } finally { controller.abort(); if (heartbeat) clearInterval(heartbeat); if (lock) active.delete(lock); res.removeListener("close", disconnect) }
    return true
  }
}
