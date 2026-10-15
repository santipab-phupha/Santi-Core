import { useEffect, useRef, useState } from "react"
import type { ImpactReview } from "./impact-types"

export default function useImpactReview(coinId: string, inputKey: string, enabled: boolean) {
  const [review, setReview] = useState<ImpactReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const previous = useRef(new Map<string, ImpactReview>())
  useEffect(() => {
    const controller = new AbortController()
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ coinId: string }>).detail?.coinId !== coinId) return
      void (async () => {
        try {
          const response = await fetch(`/api/impact/review?coinId=${encodeURIComponent(coinId)}`, { signal: controller.signal, cache: "no-store" })
          if (!response.ok) return
          const value = await response.json() as ImpactReview
          if (!controller.signal.aborted && value.coinId === coinId && Array.isArray(value.labels)) {
            previous.current.set(`${coinId}:${inputKey}`, value)
            setReview(value)
          }
        } catch { /* A manual review result remains saved on the server. */ }
      })()
    }
    window.addEventListener("news-review-complete", refresh)
    return () => { controller.abort(); window.removeEventListener("news-review-complete", refresh) }
  }, [coinId, inputKey])
  useEffect(() => {
    if (!enabled) { setBusy(false); return }
    const controller = new AbortController()
    const cacheKey = `${coinId}:${inputKey}`
    const cached = previous.current.get(cacheKey)
    if (cached) { setReview(cached); setBusy(false); setError(""); return }
    setBusy(true)
    setError("")
    const progressController = new AbortController()
    const progressSignal = AbortSignal.any([controller.signal, progressController.signal])
    let progressTimer: number | undefined
    const stopProgress = () => { window.clearTimeout(progressTimer); progressController.abort() }
    const showProgress = async () => {
      try {
        const response = await fetch(`/api/impact/review?coinId=${encodeURIComponent(coinId)}`, { signal: progressSignal, cache: "no-store" })
        if (response.ok) {
          const value = await response.json() as ImpactReview
          if (!progressSignal.aborted && value.coinId === coinId && Array.isArray(value.labels)) setReview(value)
        }
      } catch { /* Progress reads are optional; the original POST remains authoritative. */ }
      finally { if (!progressSignal.aborted) progressTimer = window.setTimeout(showProgress, 3000) }
    }
    // Scheduling past StrictMode's mount/unmount probe avoids starting a paid
    // request that is immediately cancelled by the development-only probe.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          // GET only reads results already saved by completed workers. It never
          // starts another paid task while this visitor's POST is running.
          progressTimer = window.setTimeout(showProgress, 3000)
          let response = await fetch("/api/impact/review", { method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coinId }) })
          stopProgress()
          let value = await response.json() as ImpactReview & { error?: string }
          if (response.status === 429) {
            // Other visitors may own the task. GET reads cached labels only;
            // polling never starts a new paid classification or retries POST.
            for (let poll = 0; poll < 48; poll++) {
              await new Promise<void>((resolve, reject) => {
                if (controller.signal.aborted) { reject(controller.signal.reason); return }
                const abort = () => { clearTimeout(timer); reject(controller.signal.reason) }
                const timer = window.setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve() }, 5000)
                controller.signal.addEventListener("abort", abort, { once: true })
              })
              response = await fetch(`/api/impact/review?coinId=${encodeURIComponent(coinId)}`, { signal: controller.signal, cache: "no-store" })
              value = await response.json()
              if (!response.ok) break
              if (value.coinId !== coinId || !Array.isArray(value.labels)) throw new Error("The agent returned an invalid review.")
              if (!controller.signal.aborted) setReview(value)
              if (!value.pending || value.running === false) break
            }
            if (response.ok && value.pending && value.running !== false) throw new Error("The review is still pending. Please retry shortly.")
          }
          if (!response.ok) throw new Error(value.error || "Could not review news impact.")
          if (value.coinId !== coinId || !Array.isArray(value.labels)) throw new Error("The agent returned an invalid review.")
          if (!controller.signal.aborted) {
            if (previous.current.size >= 20) previous.current.delete(previous.current.keys().next().value!)
            previous.current.set(cacheKey, value)
            setReview(value)
          }
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not review news impact.")
        } finally { stopProgress(); if (!controller.signal.aborted) setBusy(false) }
      })()
    }, 0)
    return () => { window.clearTimeout(timer); stopProgress(); controller.abort() }
  }, [coinId, inputKey, enabled, attempt])
  return { review, busy, error, retry: () => { previous.current.delete(`${coinId}:${inputKey}`); setAttempt((value) => value + 1) } }
}
