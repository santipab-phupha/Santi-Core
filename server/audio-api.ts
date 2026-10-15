import type { IncomingMessage, ServerResponse } from "node:http"
import { createHash } from "node:crypto"
import type { DebateResult } from "../src/bear-bull-types"
import type { AudioConfig, AudioManifest, VoiceProfile } from "../src/audio-types"
import { buildAudioManifest } from "./debate-audio.ts"
import { audioTokens } from "./audio-token.ts"

export type ElevenConfig = {
  apiKey: string
  model: string
  bullVoiceId: string
  bearVoiceId: string
}
class AudioError extends Error {
  status: number
  constructor(message: string, status = 502) { super(message); this.status = status }
}
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex")
const voicePattern = /^[a-zA-Z0-9_-]{1,100}$/
const reportPattern = /^[a-f0-9-]{36}$/
const preview = {
  bull: "Hi, I'm Bull. I look for evidence of upside drivers and consider Bear's counterarguments.",
  bear: "Hi, I'm Bear. I examine risks, question the evidence and respond to each of Bull's claims.",
}
function providerFailure(status: number) {
  const messages: Record<number, string> = {
    401: "The ElevenLabs API key is invalid. Check the server configuration.",
    402: "Insufficient ElevenLabs credits. Check your account balance.",
    403: "The ElevenLabs key cannot read voices or generate the selected voice.",
    404: "The configured ElevenLabs voice or model was not found.",
    429: "ElevenLabs rate limit or quota reached. Please try again later.",
  }
  return new AudioError(messages[status] || "ElevenLabs could not generate audio. Please try again later.", status === 429 ? 429 : 502)
}
export function createAudioApi(options: { getConfig: () => ElevenConfig; fetcher?: typeof fetch }) {
  const tokens = audioTokens(() => options.getConfig().apiKey)
  const fetcher = options.fetcher ?? fetch
  const reports = new Map<string, { expires: number; manifest: AudioManifest }>()
  const clips = new Map<string, { expires: number; bytes: Buffer }>()
  let clipBytes = 0
  let busy = false
  let voiceCache: { key: string; expires: number; voices: VoiceProfile[] } | undefined
  let voicePending: { key: string; promise: Promise<VoiceProfile[]> } | undefined
  function prune() {
    for (const [id, report] of reports) if (report.expires <= Date.now()) reports.delete(id)
    for (const [key, clip] of clips) if (clip.expires <= Date.now()) { clips.delete(key); clipBytes -= clip.bytes.length }
  }
  function register(result: DebateResult) {
    prune()
    if (reports.has(result.reportId)) return options.getConfig().apiKey ? tokens.issue(reports.get(result.reportId)!.manifest) : undefined
    const manifest = buildAudioManifest(result)
    if (reports.size >= 10) reports.delete(reports.keys().next().value!)
    reports.set(result.reportId, { expires: Date.now() + 3_600_000, manifest })
    return options.getConfig().apiKey ? tokens.issue(manifest) : undefined
  }
  async function voices(config: ElevenConfig): Promise<VoiceProfile[]> {
    const key = fingerprint(config.apiKey)
    if (voiceCache?.key === key && voiceCache.expires > Date.now()) return voiceCache.voices
    if (voicePending?.key === key) return voicePending.promise
    const job = (async () => {
      const response = await fetcher("https://api.elevenlabs.io/v2/voices?page_size=100&include_total_count=false", {
        headers: { "xi-api-key": config.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw providerFailure(response.status)
      const payload = await response.json() as { voices?: { voice_id?: unknown; name?: unknown }[] }
      if (!Array.isArray(payload.voices)) throw new AudioError("ElevenLabs returned an invalid voice list.")
      const list: VoiceProfile[] = payload.voices.filter((voice) => typeof voice.voice_id === "string" && voicePattern.test(voice.voice_id) && typeof voice.name === "string")
        .slice(0, 100).map((voice) => ({ id: voice.voice_id as string, name: (voice.name as string).slice(0, 100) }))
      const available = [...new Map(list.map((voice) => [voice.id, voice])).values()]
      voiceCache = { key, expires: Date.now() + 600_000, voices: available }
      return available
    })()
    voicePending = { key, promise: job }
    try { return await job } finally { if (voicePending?.promise === job) voicePending = undefined }
  }
  async function configuration(config: ElevenConfig): Promise<AudioConfig> {
    const list = config.apiKey ? await voices(config) : []
    const bull = config.bullVoiceId || list.find((voice) => /^(brian|liam|charlie)$/i.test(voice.name))?.id || list[0]?.id || ""
    const bear = config.bearVoiceId || list.find((voice) => /^george$/i.test(voice.name) && voice.id !== bull)?.id || list.find((voice) => voice.id !== bull)?.id || ""
    return { configured: Boolean(config.apiKey), model: config.model, voices: list, bullVoiceId: bull, bearVoiceId: bear,
      ready: Boolean(config.apiKey && bull && bear && bull !== bear && [bull, bear].every((id) => list.some((voice) => voice.id === id))) }
  }
  function json(res: ServerResponse, status: number, value: unknown) {
    res.statusCode = status
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    res.end(JSON.stringify(value))
  }
  async function generate(config: ElevenConfig, voiceId: string, text: string, signal: AbortSignal) {
    const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: config.model, language_code: "en" }),
    })
    if (!response.ok) throw providerFailure(response.status)
    if (!response.headers.get("content-type")?.startsWith("audio/")) throw new AudioError("ElevenLabs did not return a valid audio file.")
    const reader = response.body?.getReader()
    if (!reader) throw new AudioError("No audio was received from ElevenLabs.")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.length
        if (size > 12_000_000) throw new AudioError("The audio file exceeds the size limit.")
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    if (!size) throw new AudioError("The returned audio file is empty.")
    return Buffer.concat(chunks)
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = req.url?.split("?")[0] || ""
    if (!path.startsWith("/api/audio/")) return false
    let controller: AbortController | undefined
    let ownsLock = false
    const disconnect = () => { if (!res.writableEnded) controller?.abort() }
    try {
      prune()
      if (path === "/api/audio/config" && req.method === "GET") {
        json(res, 200, await configuration(options.getConfig()))
        return true
      }
      if (path.startsWith("/api/audio/reports/") && req.method === "GET") {
        const id = path.slice("/api/audio/reports/".length)
        const report = reportPattern.test(id) ? reports.get(id) : undefined
        if (!report) throw new AudioError("The audio report has expired or the server restarted. Please create a new analysis.", 404)
        json(res, 200, report.manifest)
        return true
      }
      if (!["/api/audio/speech", "/api/audio/preview", "/api/audio/manifest"].includes(path)) throw new AudioError("Audio endpoint not found.", 404)
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); throw new AudioError("Use POST to generate audio.", 405) }
      if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) throw new AudioError("Audio must be requested from this website.", 403)
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new AudioError("A JSON audio request is required.", 415)
      const config = options.getConfig()
      if (!config.apiKey) throw new AudioError("Add ELEVENLABS_API_KEY to .local.env to enable Bull/Bear audio.", 503)
      let raw = ""
      for await (const chunk of req) { raw += chunk.toString(); if (Buffer.byteLength(raw) > 610_000) throw new AudioError("The request exceeds the size limit.", 413) }
      let body: Record<string, unknown>
      try { body = JSON.parse(raw) } catch { throw new AudioError("Invalid audio request.", 400) }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["reportId", "turnId", "voiceId", "side", "audioToken"].includes(key))) throw new AudioError("Audio can only be generated from a completed report or a predefined voice preview.", 400)
      const manifest = body.audioToken !== undefined ? tokens.read(body.audioToken, body.reportId) : typeof body.reportId === "string" ? reports.get(body.reportId)?.manifest : undefined
      if (path.endsWith("/manifest")) {
        if (!manifest) throw new AudioError("This audio report has expired. Please create a new analysis.", 404)
        json(res, 200, manifest)
        return true
      }
      let text: string
      let side: "bull" | "bear"
      if (path.endsWith("/preview")) {
        if (body.side !== "bull" && body.side !== "bear") throw new AudioError("Choose Bull or Bear.", 400)
        side = body.side
        text = preview[side]
      } else {
        const turn = manifest?.turns.find((turn) => turn.id === body.turnId)
        if (!turn) throw new AudioError("No text was found for this completed analysis.", 404)
        side = turn.side
        text = turn.text
      }
      controller = new AbortController()
      res.on("close", disconnect)
      const available = await configuration(config)
      controller.signal.throwIfAborted()
      const voiceId = body.voiceId ?? (side === "bull" ? available.bullVoiceId : available.bearVoiceId)
      if (typeof voiceId !== "string" || !available.voices.some((voice) => voice.id === voiceId)) throw new AudioError("Choose a voice available in this ElevenLabs account.", 400)
      const key = fingerprint(`${fingerprint(config.apiKey)}:${config.model}:${voiceId}:${text}`)
      let clip = clips.get(key)
      const cached = Boolean(clip)
      if (!clip) {
        if (busy) { res.setHeader("Retry-After", "3"); throw new AudioError("Another audio segment is being generated. Wait a moment, then press Play again.", 429) }
        busy = true
        ownsLock = true
        const bytes = await generate(config, voiceId, text, controller.signal)
        controller.signal.throwIfAborted()
        while (clips.size && (clips.size >= 40 || clipBytes + bytes.length > 48_000_000)) {
          const oldest = clips.keys().next().value!
          clipBytes -= clips.get(oldest)!.bytes.length
          clips.delete(oldest)
        }
        clip = { expires: Date.now() + 3_600_000, bytes }
        clips.set(key, clip)
        clipBytes += bytes.length
      }
      if (!res.destroyed) {
        res.setHeader("Content-Type", "audio/mpeg")
        res.setHeader("Cache-Control", "no-store")
        res.setHeader("Content-Length", clip.bytes.length)
        res.setHeader("X-Audio-Cached", String(cached))
        res.end(clip.bytes)
      }
    } catch (error) {
      controller?.abort()
      if (!res.destroyed && !res.writableEnded) json(res, error instanceof AudioError ? error.status : 503, {
        error: error instanceof AudioError ? error.message : "The audio connection failed or timed out. Please try again.",
      })
    } finally {
      res.removeListener("close", disconnect)
      if (ownsLock) busy = false
    }
    return true
  }
  return { register, handle }
}
