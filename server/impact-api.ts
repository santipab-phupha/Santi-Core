import type { IncomingMessage, ServerResponse } from "node:http"
import type { FeedResponse, MarketResponse } from "../src/data-types"
import { createImpactReviewer, ReviewError } from "./impact-review.ts"
import type { AgentsConfig } from "./eleven-agent.ts"

export function createImpactApi(options: {
  getConfig: () => AgentsConfig
  getData: () => Promise<[MarketResponse, FeedResponse]>
  reviewer?: ReturnType<typeof createImpactReviewer>
}) {
  const review = options.reviewer ?? createImpactReviewer(options)
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.url?.split("?")[0] !== "/api/impact/review") return false
    const controller = new AbortController()
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.on("close", disconnect)
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    try {
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); throw new ReviewError("POST required.", 405) }
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw new ReviewError("Request impact reviews from this website.", 403)
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new ReviewError("A JSON request is required.", 415)
      let raw = ""
      for await (const part of req) { raw += part.toString(); if (Buffer.byteLength(raw) > 1024) throw new ReviewError("The request exceeds the size limit.", 413) }
      let body: { coinId?: unknown }
      try { body = JSON.parse(raw) } catch { throw new ReviewError("Invalid request.", 400) }
      if (!body || typeof body.coinId !== "string" || !/^[a-z0-9-]{1,80}$/.test(body.coinId) || Object.keys(body).some((key) => key !== "coinId")) throw new ReviewError("Select an asset from the market list.", 400)
      const [market, feed] = await options.getData()
      const coin = market.coins.find((item) => item.id === body.coinId)
      if (!coin) throw new ReviewError("The asset was not found in the market list.", 400)
      controller.signal.throwIfAborted()
      const result = await review(coin, market, feed, controller.signal)
      if (!res.destroyed) res.end(JSON.stringify(result))
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        res.statusCode = error instanceof ReviewError ? error.status : 503
        if (res.statusCode === 429) res.setHeader("Retry-After", "10")
        res.end(JSON.stringify({ error: error instanceof ReviewError ? error.message : "The impact agent could not complete this review. Please retry later." }))
      }
    } finally { res.removeListener("close", disconnect) }
    return true
  }
}
