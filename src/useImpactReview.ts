import { useEffect, useRef, useState } from "react"
import type { ImpactReview } from "./impact-types"

export default function useImpactReview(coinId: string, inputKey: string, enabled: boolean) {
  const [review, setReview] = useState<ImpactReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const previous = useRef(new Map<string, ImpactReview>())
  useEffect(() => {
    if (!enabled) { setBusy(false); return }
    const controller = new AbortController()
    const cacheKey = `${coinId}:${inputKey}`
    const cached = previous.current.get(cacheKey)
    if (cached) { setReview(cached); setBusy(false); setError(""); return }
    setBusy(true)
    setError("")
    // Scheduling past StrictMode's mount/unmount probe avoids starting a paid
    // request that is immediately cancelled by the development-only probe.
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/impact/review", { method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coinId }) })
          const value = await response.json() as ImpactReview & { error?: string }
          if (!response.ok) throw new Error(value.error || "Could not review news impact.")
          if (value.coinId !== coinId || !Array.isArray(value.labels)) throw new Error("The agent returned an invalid review.")
          if (!controller.signal.aborted) {
            if (previous.current.size >= 20) previous.current.delete(previous.current.keys().next().value!)
            previous.current.set(cacheKey, value)
            setReview(value)
          }
        } catch (cause) {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not review news impact.")
        } finally { if (!controller.signal.aborted) setBusy(false) }
      })()
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [coinId, inputKey, enabled, attempt])
  return { review, busy, error, retry: () => { previous.current.delete(`${coinId}:${inputKey}`); setAttempt((value) => value + 1) } }
}
