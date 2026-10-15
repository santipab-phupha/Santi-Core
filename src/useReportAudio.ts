import { useEffect, useRef, useState } from "react"
import type { AudioManifest } from "./audio-types"
import type { ImpactReportSnapshot } from "./impact-report"

type Narration = { report: ImpactReportSnapshot; manifest: AudioManifest; audioToken?: string }
type Status = "idle" | "loading" | "playing" | "ready"
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string }
  return new Error(body.error || "Report audio is unavailable. Please try again.")
}

export default function useReportAudio(coinId: string, showReport: (report: ImpactReportSnapshot) => void) {
  const [status, setStatus] = useState<Status>("idle")
  const [detail, setDetail] = useState("")
  const [error, setError] = useState("")
  const [current, setCurrent] = useState<{ title: string; text: string; index: number; total: number } | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const request = useRef<AbortController | null>(null)
  const playlist = useRef<Narration | null>(null)
  const index = useRef(0)
  const objectUrl = useRef("")
  const active = status !== "idle"

  function releaseClip() {
    audio.current?.pause()
    audio.current?.removeAttribute("src")
    audio.current?.load()
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = "" }
  }
  function stop() {
    request.current?.abort()
    request.current = null
    playlist.current = null
    releaseClip()
    setStatus("idle")
    setDetail("")
    setError("")
  }
  useEffect(() => {
    const element = audio.current
    return () => {
      request.current?.abort()
      request.current = null
      element?.pause()
      element?.removeAttribute("src")
      element?.load()
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    }
  }, [coinId])

  function fail(cause: unknown, controller: AbortController) {
    if (request.current !== controller || controller.signal.aborted) return
    controller.abort()
    request.current = null
    releaseClip()
    setStatus("idle")
    setDetail("")
    setError(cause instanceof Error ? cause.message : "Could not play the report. Please try again.")
  }
  async function playReady(controller: AbortController) {
    try {
      await audio.current?.play()
      if (request.current === controller && !controller.signal.aborted) { setStatus("playing"); setError("") }
    } catch (cause) {
      if (request.current !== controller || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setStatus("ready")
        setDetail("Audio is ready. Press Play to listen.")
      } else fail(new Error("Your browser could not play this audio. Please try again."), controller)
    }
  }
  async function loadClip(next: number, controller: AbortController) {
    const payload = playlist.current
    if (!payload || request.current !== controller || controller.signal.aborted) return
    const turn = payload.manifest.turns[next]
    if (!turn) {
      request.current = null
      releaseClip()
      setStatus("idle")
      setDetail("Report finished")
      return
    }
    index.current = next
    setCurrent({ title: turn.title, text: turn.text, index: next + 1, total: payload.manifest.turns.length })
    releaseClip()
    setStatus("loading")
    setDetail(`${turn.title} · ${next + 1}/${payload.manifest.turns.length}`)
    try {
      const response = await fetch("/api/audio/speech", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: payload.manifest.reportId, turnId: turn.id, audioToken: payload.audioToken }),
      })
      if (!response.ok) throw await responseError(response)
      const clip = await response.blob()
      if (request.current !== controller || controller.signal.aborted || !audio.current) return
      if (!clip.size || !clip.type.startsWith("audio/")) throw new Error("No playable audio was received. Please try again.")
      objectUrl.current = URL.createObjectURL(clip)
      audio.current.src = objectUrl.current
      await playReady(controller)
    } catch (cause) { fail(cause, controller) }
  }
  async function listen() {
    if (status === "ready" && request.current) { await playReady(request.current); return }
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setError("")
    setCurrent(null)
    setStatus("loading")
    setDetail("Preparing report audio…")
    try {
      // The server signs a canonical snapshot from cached reviews, never client text.
      const response = await fetch("/api/impact/report", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coinId }),
      })
      if (!response.ok) throw await responseError(response)
      const payload = await response.json() as Narration
      if (request.current !== controller || controller.signal.aborted) return
      if (payload.report.coinId !== coinId || !payload.manifest.turns.length) throw new Error("The report audio does not match this asset. Please try again.")
      playlist.current = payload
      showReport(payload.report)
      await loadClip(0, controller)
    } catch (cause) { fail(cause, controller) }
  }
  const ended = () => { if (request.current) void loadClip(index.current + 1, request.current) }
  const mediaError = () => { if (request.current && objectUrl.current) fail(new Error("Your browser could not play this audio. Please try again."), request.current) }
  return { audio, status, active, detail, error, current, listen, stop, ended, mediaError }
}
