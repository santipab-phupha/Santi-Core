import { useEffect, useRef, useState } from "react"
import type { FeedResponse, MarketResponse } from "./data-types"
import type { ImpactReview } from "./impact-types"
import { buildImpactReport } from "./impact-report"
import type { ImpactReportSnapshot } from "./impact-report"

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" })
  if (!response.ok) throw new Error("Could not refresh the report. Please try again.")
  return response.json() as Promise<T>
}

export default function useImpactReport(coinId: string) {
  const [report, setReport] = useState<ImpactReportSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort(); request.current = null }, [coinId])

  const generate = async () => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 30_000)
    setBusy(true)
    setError("")
    try {
      // Read shared results; generating a report never repeats paid inference.
      // Pending reviews stay pending until their separate analysis completes.
      const [market, feed] = await Promise.all([
        read<MarketResponse>("/api/market", controller.signal),
        read<FeedResponse>("/api/feed", controller.signal),
      ])
      const review = await read<ImpactReview>(`/api/impact/review?coinId=${encodeURIComponent(coinId)}`, controller.signal)
      const coin = market.coins.find(item => item.id === coinId)
      if (!coin || review.coinId !== coinId || !Array.isArray(review.labels)) throw new Error("The latest asset review is unavailable. Please try again.")
      const snapshot = buildImpactReport(coin, feed, review, Date.now(), market.stale)
      if (!controller.signal.aborted) setReport(snapshot)
    } catch (cause) {
      if (request.current === controller) setError(controller.signal.aborted
        ? "The report request timed out. Please try again."
        : cause instanceof Error ? cause.message : "Could not generate the report.")
    } finally {
      window.clearTimeout(timeout)
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }
  const close = () => {
    const controller = request.current
    request.current = null
    controller?.abort()
    setReport(null)
    setError("")
    setBusy(false)
  }
  return { report, busy, error, generate, close }
}
