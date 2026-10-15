import { useEffect, useRef, useState } from "react"
import type { DebateResult, DebateSide } from "./bear-bull-types"
import type { AudioConfig, AudioManifest } from "./audio-types"
import AgentAvatar from "./AgentAvatar"
import "./debate-audio.css"

type Playback = "idle" | "loading" | "ready" | "playing" | "paused" | "finished" | "error"
async function responseError(response: Response) {
  const body = await response.json().catch(() => ({})) as { error?: string }
  return new Error(body.error || "Could not connect to audio. Please try again.")
}
export default function DebateAudio({ report, onAnalyze, embedded = false }: { report?: DebateResult; onAnalyze?: () => void; embedded?: boolean }) {
  const [config, setConfig] = useState<AudioConfig | null>(null)
  const [manifest, setManifest] = useState<AudioManifest | null>(null)
  const [configError, setConfigError] = useState("")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Playback>("idle")
  const [voices, setVoices] = useState({ bull: "", bear: "" })
  const [index, setIndex] = useState(0)
  const [speaker, setSpeaker] = useState<DebateSide | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const request = useRef<AbortController | null>(null)
  const objectUrl = useRef("")
  const clip = useRef<{ kind: "turn" | "preview"; index: number; side: DebateSide } | null>(null)
  const playlist = useRef(false)
  const previewSide = clip.current?.kind === "preview" ? clip.current.side : null
  const setupReady = Boolean(config?.configured && voices.bull && voices.bear && voices.bull !== voices.bear && [voices.bull, voices.bear].every((id) => config.voices.some((voice) => voice.id === id)))
  const current = manifest?.turns[index]
  useEffect(() => {
    const controller = new AbortController()
    setConfigError("")
    setConfig(null)
    async function read() {
      try {
        const response = await fetch("/api/audio/config", { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw await responseError(response)
        const value = await response.json() as AudioConfig
        if (controller.signal.aborted) return
        setConfig(value)
        setVoices({ bull: value.bullVoiceId, bear: value.bearVoiceId })
      } catch (error) { if (!controller.signal.aborted) setConfigError(error instanceof Error ? error.message : "Could not check the ElevenLabs connection.") }
    }
    void read()
    return () => controller.abort()
  }, [attempt])
  useEffect(() => {
    const controller = new AbortController()
    playlist.current = false
    request.current?.abort()
    audio.current?.pause()
    setManifest(null)
    setIndex(0)
    setSpeaker(null)
    setStatus("idle")
    setError("")
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = "" }
    clip.current = null
    if (audio.current) { audio.current.removeAttribute("src"); audio.current.load() }
    if (report) void (async () => {
      try {
        const response = await fetch(report.audioToken ? "/api/audio/manifest" : `/api/audio/reports/${encodeURIComponent(report.reportId)}`, {
          signal: controller.signal, cache: "no-store",
          ...(report.audioToken ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId: report.reportId, audioToken: report.audioToken }) } : {}),
        })
        if (!response.ok) throw await responseError(response)
        const value = await response.json() as AudioManifest
        if (!controller.signal.aborted) setManifest(value)
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load the transcript.") }
    })()
    return () => {
      controller.abort()
      request.current?.abort()
      audio.current?.pause()
      if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = "" }
    }
  }, [report?.reportId])
  function stop() {
    playlist.current = false
    request.current?.abort()
    audio.current?.pause()
    setSpeaker(null)
    setStatus(objectUrl.current ? "paused" : "idle")
  }
  async function startClip(kind: "turn" | "preview", nextIndex = 0, side: DebateSide = "bull") {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setStatus("loading")
    setError("")
    setSpeaker(null)
    audio.current?.pause()
    clip.current = null
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = "" }
    if (audio.current) { audio.current.removeAttribute("src"); audio.current.load() }
    const turn = manifest?.turns[nextIndex]
    if (kind === "turn" && !turn) { setStatus("error"); setError("The selected audio segment was not found."); return }
    const selectedSide = turn && kind === "turn" ? turn.side : side
    setIndex(nextIndex)
    const body = kind === "turn" ? { reportId: manifest!.reportId, turnId: turn!.id, voiceId: voices[selectedSide], audioToken: report?.audioToken }
      : { side: selectedSide, voiceId: voices[selectedSide] }
    try {
      const response = await fetch(`/api/audio/${kind === "turn" ? "speech" : "preview"}`, {
        method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      })
      if (!response.ok) throw await responseError(response)
      const bytes = await response.blob()
      if (controller.signal.aborted) return
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(bytes)
      clip.current = { kind, side: selectedSide, index: nextIndex }
      if (!audio.current) return
      audio.current.src = objectUrl.current
      setStatus("ready")
      try { await audio.current.play() } catch {
        if (!controller.signal.aborted) { setStatus("ready"); setError("Audio is ready. Press Play to listen.") }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        playlist.current = false
        setStatus("error")
        setError(error instanceof Error ? error.message : "Could not generate audio.")
      }
    }
  }
  async function play() {
    playlist.current = true
    if (objectUrl.current && clip.current?.kind === "turn" && (status === "paused" || status === "ready")) {
      try { await audio.current?.play(); setError("") } catch { setError("Press Play on the audio controls below to listen.") }
    } else await startClip("turn", status === "finished" ? 0 : index)
  }
  function changeVoice(side: DebateSide, voiceId: string) {
    stop()
    clip.current = null
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = "" }
    if (audio.current) { audio.current.removeAttribute("src"); audio.current.load() }
    setStatus("idle")
    setVoices((current) => ({ ...current, [side]: voiceId }))
  }
  const progressLabel = status === "loading" ? "Generating audio…" : status === "playing" ? `${speaker === "bull" ? "Bull" : "Bear"} is speaking` : status === "paused" ? "Paused" : status === "finished" ? "Finished" : "Ready to play"
  return <section className={`debate-audio-zone ${embedded ? "is-embedded" : ""}`} id="audio" aria-labelledby="audio-title">
    <header className="audio-zone-heading"><div><span className="audio-eyebrow">ELEVENLABS VOICES</span><h2 id="audio-title">{embedded ? "Your debate is ready." : "Listen to both sides."}</h2><p>{report ? `${report.coinName} · ${report.symbol}` : "Bull and Bear voices with evidence from the analysis."}</p></div><span className="audio-provider-status">{setupReady ? "Voice connected" : config?.configured ? "Choose a voice" : "Voice setup"}</span></header>
    <div className="audio-speakers">{(["bull", "bear"] as const).map((side) => <div className={`audio-speaker ${side} ${status === "playing" && speaker === side ? "is-speaking" : ""}`} key={side}>
      <div className="audio-avatar"><AgentAvatar side={side} /></div><div><b>{side === "bull" ? "Bull" : "Bear"}</b><span>{status === "playing" && speaker === side ? "Speaking" : side === "bull" ? "Upside drivers" : "Downside risks"}</span></div><div className="speaker-wave" aria-hidden="true">{[1, 2, 3, 4, 5].map((value) => <i key={value} />)}</div>
    </div>)}</div>
    {(configError || config?.configured === false) && <div className="audio-setup" role="status"><p>{configError || "Add an ElevenLabs API key to enable Bull/Bear audio."}</p>{!configError && <code>ELEVENLABS_API_KEY=… · .local.env</code>}<button onClick={() => setAttempt((value) => value + 1)}>Check connection ↗</button></div>}
    {config?.configured && <details className="audio-voice-settings"><summary>Bull / Bear voices</summary><div>{(["bull", "bear"] as const).map((side) => <label key={side}>{side === "bull" ? "Bull voice" : "Bear voice"}<select aria-label={`${side} voice`} value={voices[side]} disabled={status === "loading" || status === "playing"} onChange={(event) => changeVoice(side, event.target.value)}><option value="">Choose a voice</option>{config.voices.map((voice) => <option value={voice.id} key={voice.id}>{voice.name}</option>)}</select><button disabled={!voices[side] || status === "loading"} onClick={() => { playlist.current = false; void startClip("preview", 0, side) }}>Preview voice</button></label>)}</div>{voices.bull === voices.bear && <p>Choose distinct voices for Bull and Bear.</p>}<p>Voice previews use ElevenLabs credits.</p></details>}
    {manifest ? <>
      <div className="audio-transcript" aria-live="polite">{previewSide ? <><span>VOICE PREVIEW</span><h3>Preview voice {previewSide === "bull" ? "Bull" : "Bear"}</h3><p>Press Listen to Bear / Bull to return to the analysis.</p></> : <><span>{current?.side.toUpperCase()} · {index + 1} / {manifest.turns.length}</span><h3>{current?.title}</h3><p>{current?.text}</p>{!!current?.sources.length && <div>{current.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{new URL(source.url).hostname.replace(/^www\./, "")} ↗</a>)}</div>}</>}</div>
      <div className="audio-playback"><button className="audio-play-main" disabled={!setupReady || status === "loading"} onClick={() => status === "playing" ? audio.current?.pause() : void play()}>{status === "playing" ? "Ⅱ Pause" : status === "loading" ? "Generating audio…" : status === "finished" ? "↻ Replay" : "▶ Listen to Bear / Bull"}</button><button onClick={stop} disabled={status === "idle"}>Stop</button><button disabled={!setupReady || index >= manifest.turns.length - 1 || status === "loading"} onClick={() => { playlist.current = true; void startClip("turn", index + 1) }}>Next →</button><span role="status">{progressLabel}</span></div>
      <p className="audio-cost-note">{manifest.characters.toLocaleString("en-US")} characters · Audio is generated one segment at a time when you press Play, using ElevenLabs credits. Cached audio can be replayed.</p>
    </> : <div className="audio-empty"><p>{report ? error ? "Transcript unavailable" : "Preparing transcript…" : "Create an analysis, then listen to both perspectives here."}</p>{onAnalyze && <button onClick={onAnalyze}>Analysis by Bear/Bull ↗</button>}</div>}
    <audio ref={audio} controls preload="none" className={objectUrl.current ? "audio-native has-audio" : "audio-native"}
      onPlay={() => { setStatus("playing"); setSpeaker(clip.current?.side ?? null) }}
      onPause={() => { setSpeaker(null); setStatus((value) => value === "playing" ? "paused" : value) }}
      onEnded={() => { setSpeaker(null); if (playlist.current && clip.current?.kind === "turn" && manifest && clip.current.index + 1 < manifest.turns.length) void startClip("turn", clip.current.index + 1); else { playlist.current = false; setStatus(clip.current?.kind === "preview" ? "idle" : "finished") } }}
      onError={() => { if (audio.current?.getAttribute("src")) { playlist.current = false; setStatus("error"); setSpeaker(null); setError("Could not play the audio. Press Play to try again.") } }} />
    {error && <p className="audio-error" role="alert">{error}</p>}
  </section>
}
