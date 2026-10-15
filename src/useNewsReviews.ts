import { useCallback, useEffect, useRef, useState } from "react"
import type { NewsReviewResponse } from "./news-review-types"

export default function useNewsReviews(coinId: string | undefined) {
  const [data, setData] = useState<NewsReviewResponse>({ items: [] })
  const [error, setError] = useState("")
  const [loadError, setLoadError] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined
    const read = async () => {
      let processing = false
      try {
        const response = await fetch("/api/impact/news", { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("Source review statuses are temporarily unavailable.")
        const value = await response.json() as NewsReviewResponse
        if (!Array.isArray(value.items)) throw new Error("Invalid source review statuses.")
        processing = Boolean(value.sourceQueue?.running) || value.items.some(item => item.status === "processing")
        if (!controller.signal.aborted) { setData(value); setLoadError("") }
      } catch (cause) {
        if (!controller.signal.aborted) { setData({ items: [] }); setLoadError(cause instanceof Error ? cause.message : "Could not load source reviews.") }
      } finally {
        // Status reads never initiate AI work. Poll more often only during work.
        if (!controller.signal.aborted) timer = window.setTimeout(read, processing || activeId ? 3000 : 10_000)
      }
    }
    void read()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [revision, activeId])
  useEffect(() => () => { pending.current?.abort(); pending.current = null; setActiveId(null) }, [coinId])
  const review = useCallback(async (newsId: string) => {
    if (!coinId || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setActiveId(newsId)
    setError("")
    try {
      const response = await fetch("/api/impact/review", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coinId, newsId }) })
      const value = await response.json() as { error?: string }
      if (!response.ok && response.status !== 429) throw new Error(value.error || "Could not complete the source review.")
      if (response.ok) window.dispatchEvent(new CustomEvent("news-review-complete", { detail: { coinId } }))
      if (response.status === 429) setError("A review is already running or cooling down. Statuses will update; retry if this story remains pending.")
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not complete the source review.")
    } finally {
      if (pending.current === controller) { pending.current = null; setActiveId(null); setRevision(value => value + 1) }
    }
  }, [coinId])
  return { data, error: error || loadError, loadError, activeId, review }
}
