import type { IncomingMessage, ServerResponse } from "node:http"
import type { FeedResponse, MarketResponse } from "../src/data-types"
import { createImpactReviewer, createReviewStore, ReviewError } from "./impact-review.ts"
import { readNewsReviews } from "./news-verification.ts"
import type { AgentsConfig } from "./eleven-agent.ts"
import { AgentError } from "./eleven-agent.ts"
import type { ReviewStore } from "./impact-review"
import type { SourceCheck } from "./original-source-checker"
import type { FeedItem } from "../src/data-types"
import type { SourceQueueStatus } from "../src/news-review-types"
import { buildImpactReport } from "../src/impact-report.ts"
import type { ImpactReportSnapshot } from "../src/impact-report"
import type { AudioManifest } from "../src/audio-types"

export function createImpactApi(options: {
  getConfig: () => AgentsConfig
  getData: () => Promise<[MarketResponse, FeedResponse]>
  cacheFile?: string
  reviewer?: ReturnType<typeof createImpactReviewer>
  store?: ReviewStore
  checkSource?: (item: FeedItem, signal: AbortSignal, force?: boolean) => Promise<SourceCheck>
  sourceQueueStatus?: () => Promise<SourceQueueStatus>
  narrate?: (report: ImpactReportSnapshot) => { manifest: AudioManifest; audioToken?: string }
}) {
  const store = options.store ?? createReviewStore(options.cacheFile)
  const review = options.reviewer ?? createImpactReviewer({ ...options, store })
  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?")[0]
    const newsRoute = path === "/api/impact/news"
    const reportRoute = path === "/api/impact/report"
    if (!newsRoute && !reportRoute && path !== "/api/impact/review") return false
    const controller = new AbortController()
    const disconnect = () => { if (!res.writableEnded) controller.abort() }
    res.on("close", disconnect)
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    try {
      if (newsRoute) {
        if (req.method !== "GET") { res.setHeader("Allow", "GET"); throw new ReviewError("GET required.", 405) }
        const [, feed] = await options.getData()
        const result = await readNewsReviews(feed, options.getConfig(), store)
        if (options.sourceQueueStatus) result.sourceQueue = await options.sourceQueueStatus()
        if (!res.destroyed) res.end(JSON.stringify(result))
        return true
      }
      if (reportRoute && req.method !== "POST") { res.setHeader("Allow", "POST"); throw new ReviewError("POST required.", 405) }
      if (req.method !== "POST" && req.method !== "GET") { res.setHeader("Allow", "GET, POST"); throw new ReviewError("GET or POST required.", 405) }
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw new ReviewError("Request impact reviews from this website.", 403)
      let body: { coinId?: unknown; newsId?: unknown }
      if (req.method === "GET") {
        const query = new URL(req.url ?? "", "http://internal").searchParams
        // Rewrites may add platform parameters. GET only reads cached labels;
        // only the separately validated coinId influences the lookup.
        body = { coinId: query.get("coinId") }
      } else {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new ReviewError("A JSON request is required.", 415)
        let raw = ""
        for await (const part of req) { raw += part.toString(); if (Buffer.byteLength(raw) > 1024) throw new ReviewError("The request exceeds the size limit.", 413) }
        try { body = JSON.parse(raw) } catch { throw new ReviewError("Invalid request.", 400) }
      }
      if (!body || typeof body.coinId !== "string" || !/^[a-z0-9-]{1,80}$/.test(body.coinId) ||
        (reportRoute && body.newsId !== undefined) ||
        (body.newsId !== undefined && (typeof body.newsId !== "string" || body.newsId.length > 600)) ||
        Object.keys(body).some((key) => key !== "coinId" && key !== "newsId")) throw new ReviewError("Select an asset from the market list.", 400)
      const [market, feed] = await options.getData()
      const coin = market.coins.find((item) => item.id === body.coinId)
      if (!coin) throw new ReviewError("The asset was not found in the market list.", 400)
      if (typeof body.newsId === "string" && !feed.items.some(item => item.id === body.newsId)) throw new ReviewError("Select a story from the loaded feed.", 400)
      controller.signal.throwIfAborted()
      const result = await review(coin, market, feed, controller.signal, reportRoute || req.method === "GET", body.newsId as string | undefined)
      controller.signal.throwIfAborted()
      if (reportRoute) {
        if (!options.narrate) throw new ReviewError("Report audio is unavailable.", 503)
        const report = buildImpactReport(coin, feed, result, Date.now(), market.stale)
        if (!res.destroyed) res.end(JSON.stringify({ report, ...options.narrate(report) }))
      } else if (!res.destroyed) res.end(JSON.stringify(result))
    } catch (error) {
      if (!controller.signal.aborted && !(error instanceof ReviewError && error.status < 500))
        console.error("Impact review failed", { code: error instanceof AgentError ? error.code : error instanceof ReviewError ? "invalid_review" : "review_unavailable",
          ...(error instanceof ReviewError ? { reason: error.message } : {}),
        })
      if (!res.destroyed && !res.writableEnded) {
        res.statusCode = error instanceof ReviewError ? error.status : 503
        if (res.statusCode === 429) res.setHeader("Retry-After", "10")
        res.end(JSON.stringify({ error: error instanceof ReviewError ? error.message : "The impact agent could not complete this review. Please retry later." }))
      }
    } finally { res.removeListener("close", disconnect) }
    return true
  }
}
