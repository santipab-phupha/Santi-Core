import type { IncomingMessage, ServerResponse } from "node:http"
import type { DebateEvent, DebateResult } from "../src/bear-bull-types"
import { AnalysisError, runDebate } from "./bear-bull-engine.ts"
import { createHash } from "node:crypto"
import { AgentError } from "./eleven-agent.ts"
import type { AgentTask } from "./eleven-agent.ts"
import type { AnalysisConfig, DebateContext } from "./bear-bull-engine.ts"

function failure(error: unknown) {
  if (error instanceof AnalysisError) return error
  if (error instanceof AgentError) return new AnalysisError(error.code, error.message)
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return new AnalysisError(
      "timeout",
      "The analysis timed out or was cancelled. Please try again later.",
      504,
    )
  return new AnalysisError(
    "analysis_unavailable",
    "Could not connect to sources or ElevenLabs Agents. Please try again later.",
    503,
  )
}
export function createBearBullApi(options: {
  getConfig: () => AnalysisConfig
  getContext: (coinId: string) => Promise<DebateContext>
  fetcher?: typeof fetch
  taskRunner?: (task: AgentTask) => Promise<unknown>
  onResult?: (result: DebateResult) => unknown
}) {
  const cache = new Map<string, {
    expires: number
    result: DebateResult
  }>()
  let busy = false
  let retryAt = 0
  function json(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(body))
  }
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const route = req.url?.split("?")[0]
    if (route !== "/api/analysis/config" && route !== "/api/analysis")
      return false
    let controller: AbortController | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let ownsLock = false
    const emit = (event: DebateEvent) => {
      if (!res.destroyed && !res.writableEnded)
        res.write(`${JSON.stringify(event)}\n`)
    }
    const disconnected = () => {
      if (!res.writableEnded) controller?.abort()
    }
    try {
      const expected = route === "/api/analysis/config" ? "GET" : "POST"
      if (req.method !== expected) {
        res.setHeader("Allow", expected)
        json(res, 405, {
          code: "method_not_allowed",
          error: `${expected} required`,
        })
        return true
      }
      const config = options.getConfig()
      if (route === "/api/analysis/config") {
        json(res, 200, {
          configured: Boolean(config.apiKey && config.bullAgentId && config.bearAgentId && config.bullAgentId !== config.bearAgentId),
          model: config.model,
          reasoning: "agent-managed",
        })
        return true
      }
      // Prevent a different website from spending the local API credential.
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        throw new AnalysisError(
          "invalid_origin",
          "Analysis must be requested from this website.",
          403,
        )
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AnalysisError("invalid_request", "A JSON request is required.", 415)
      if (!config.apiKey || !config.bullAgentId || !config.bearAgentId || config.bullAgentId === config.bearAgentId)
        throw new AnalysisError(
          "not_configured",
          "Configure the ElevenLabs Agents API key and both Bull/Bear agent IDs before starting an analysis.",
          503,
        )
      let body = ""
      for await (const chunk of req) {
        body += chunk.toString()
        if (Buffer.byteLength(body) > 1_024)
          throw new AnalysisError("invalid_request", "The request exceeds the size limit.", 413)
      }
      let coinId: unknown
      try {
        coinId = (JSON.parse(body) as { coinId?: unknown }).coinId
      } catch {
        /* validated below */
      }
      if (typeof coinId !== "string" || !/^[a-z0-9-]{1,80}$/.test(coinId))
        throw new AnalysisError(
          "invalid_request",
          "Select an asset from the market list first.",
          400,
        )
      for (const [key, entry] of cache)
        if (entry.expires <= Date.now()) cache.delete(key)
      const key = `en:${createHash("sha256").update(config.apiKey).digest("hex")}:${config.model}:${config.bullAgentId}:${config.bearAgentId}:${coinId}`
      const cached = cache.get(key)
      if (cached) {
        const audioToken = options.onResult?.(cached.result)
        if (typeof audioToken === "string") cached.result.audioToken = audioToken
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
        res.setHeader("Cache-Control", "no-store")
        emit({ type: "result", result: cached.result, cached: true })
        res.end()
        return true
      }
      if (busy || Date.now() < retryAt) {
        res.setHeader("Retry-After", "15")
        throw new AnalysisError(
          "busy",
          "An analysis is running or has just finished. Please wait a moment and try again.",
          429,
        )
      }
      busy = true
      ownsLock = true
      controller = new AbortController()
      res.on("close", disconnected)
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("X-Accel-Buffering", "no")
      res.flushHeaders()
      heartbeat = setInterval(() => emit({ type: "heartbeat" }), 15_000)
      emit({ type: "phase", phase: "context" })
      const context = await options.getContext(coinId)
      controller.signal.throwIfAborted()
      const result = await runDebate({
        config,
        context,
        signal: controller.signal,
        emit,
        fetcher: options.fetcher,
        taskRunner: options.taskRunner,
      })
      controller.signal.throwIfAborted()
      // The local server shares reports for five minutes; no automatic paid reruns.
      const audioToken = options.onResult?.(result)
      if (typeof audioToken === "string") result.audioToken = audioToken
      if (cache.size >= 10) cache.delete(cache.keys().next().value!)
      cache.set(key, { expires: Date.now() + 300_000, result })
      emit({ type: "phase", phase: "complete" })
      emit({ type: "result", result, cached: false })
      res.end()
    } catch (cause) {
      const error = failure(cause)
      controller?.abort() // Also cancels the other agent if a parallel call failed.
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) {
          emit({ type: "error", code: error.code, message: error.message })
          res.end()
        } else
          json(res, error.status, { code: error.code, error: error.message })
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      res.removeListener("close", disconnected)
      if (ownsLock) {
        busy = false
        retryAt = Date.now() + 15_000
      }
    }
    return true
  }
}
