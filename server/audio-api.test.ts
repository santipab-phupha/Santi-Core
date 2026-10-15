import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { createAudioApi } from "./audio-api.ts"
import { buildAudioManifest, splitSpeech } from "./debate-audio.ts"
import type { DebateResult } from "../src/bear-bull-types"
const config = { apiKey: "test-only-eleven-secret", model: "eleven_v3", bullVoiceId: "", bearVoiceId: "" }
const source = { url: "https://example.org/report", title: "Original source", origin: "feed" as const }
const result: DebateResult = {
  reportId: "00000000-0000-4000-8000-000000000001", coinId: "bitcoin", coinName: "Bitcoin", symbol: "BTC", model: "gemini-2.5-flash", reasoning: "agent-managed", createdAt: "2026-10-15T06:00:00Z", dataAt: "2026-10-15T06:00:00Z",
  openings: {
    bull: { side: "bull", summary: "มีแรงสนับสนุน", gaps: ["ต้องตรวจขนาดเงินไหลเข้า"], claims: [{ id: "bull-1", title: "เงินไหลเข้า", argument: "รายงานเงินไหลเข้า", caveat: "ไม่รับรองทิศทางราคา", sources: [source] }] },
    bear: { side: "bear", summary: "ยังมีความเสี่ยง", gaps: [], claims: [{ id: "bear-1", title: "สภาพคล่อง", argument: "สภาพคล่องยังต้องตรวจสอบ", caveat: "ข้อมูลไม่ครบ", sources: [source] }] },
  },
  rebuttals: {
    bull: { side: "bull", summary: "ตอบแล้ว", replies: [{ claimId: "bear-1", position: "uncertain", argument: "ยังต้องตรวจตัวเลขเพิ่ม", sources: [] }] },
    bear: { side: "bear", summary: "ตอบแล้ว", replies: [{ claimId: "bull-1", position: "challenge", argument: "ต้องตรวจกรอบเวลา", sources: [source] }] },
  }, sources: [source], gaps: [], usage: { requests: 4, inputTokens: 0, outputTokens: 0 },
}
async function app(fetcher?: typeof fetch, settings = config) {
  const api = createAudioApi({ getConfig: () => settings, fetcher })
  const http = createServer((req, res) => { void api.handle(req, res) })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  return { api, url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => { http.close(() => resolve()); http.closeAllConnections() }) }
}
const voiceResponse = () => Response.json({ voices: [{ voice_id: "bullVoice", name: "Brian" }, { voice_id: "bearVoice", name: "George" }] })
const clipResponse = () => new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } })
const body = { reportId: result.reportId, turnId: "0" }
test("signed reports survive fresh instances and reject altered, expired or mismatched tokens", async () => {
  let speechCalls = 0
  const first = await app()
  const second = await app(async (url) => {
    if (String(url).includes("/v2/voices")) return voiceResponse()
    speechCalls++
    return clipResponse()
  })
  const originalNow = Date.now
  try {
    const audioToken = first.api.register(result)!
    assert.equal(typeof audioToken, "string")
    const data = { ...body, audioToken }
    assert.equal((await post(second.url, "manifest", data)).status, 200)
    assert.equal((await post(second.url, "speech", { ...data, audioToken: audioToken.replace(/^./, audioToken[0] === "a" ? "b" : "a") })).status, 404)
    assert.equal((await post(second.url, "speech", { ...data, reportId: "00000000-0000-4000-8000-000000000002" })).status, 404)
    assert.equal(speechCalls, 0)
    const audio = await post(second.url, "speech", data)
    assert.equal(audio.status, 200)
    await audio.arrayBuffer()
    assert.equal(speechCalls, 1)
    Date.now = () => originalNow() + 3_600_001
    assert.equal((await post(second.url, "manifest", data)).status, 404)
    assert.equal((await post(second.url, "speech", data)).status, 404)
    assert.equal(speechCalls, 1)
  } finally { Date.now = originalNow; await first.close(); await second.close() }
})
function post(url: string, route = "speech", data: unknown = body, extra: RequestInit = {}) {
  return fetch(`${url}/api/audio/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), ...extra })
}
test("narration covers every claim and opposing response in alternating voices, preserving sources and caveats", () => {
  const manifest = buildAudioManifest(result)
  assert.deepEqual(manifest.turns.map((turn) => turn.side), ["bull", "bear", "bull", "bear", "bear", "bull", "bear"])
  assert.ok(manifest.turns[2].text.includes("ไม่รับรองทิศทางราคา"))
  assert.ok(manifest.turns[3].text.includes("ต้องตรวจกรอบเวลา"))
  assert.deepEqual(manifest.turns[2].sources, [source])
  const long = "ข้อมูล🚀".repeat(700)
  const parts = splitSpeech(long)
  assert.equal(parts.join(""), long)
  assert.ok(parts.every((part) => Array.from(part).length <= 1_000))
  const incomplete = structuredClone(result); incomplete.rebuttals.bear.replies = []
  assert.throws(() => buildAudioManifest(incomplete), /incomplete debate/)
})
test("missing key never calls ElevenLabs and only completed registered reports have manifests", async () => {
  let calls = 0
  const server = await app(async () => { calls++; throw new Error("must not call") }, { ...config, apiKey: "" })
  try {
    const response = await fetch(`${server.url}/api/audio/config`).then((response) => response.json())
    assert.equal(response.configured, false)
    assert.equal(response.ready, false)
    assert.equal((await post(server.url)).status, 503)
    assert.equal((await fetch(`${server.url}/api/audio/reports/${result.reportId}`)).status, 404)
    server.api.register(result)
    const report = await fetch(`${server.url}/api/audio/reports/${result.reportId}`).then((response) => response.json())
    assert.equal(report.coinName, "Bitcoin")
    assert.equal(calls, 0)
  } finally { await server.close() }
})
test("account voices and exact report text use the server key; cached playback has no repeated generation", async () => {
  let voiceCalls = 0
  let speechCalls = 0
  const server = await app(async (url, init) => {
    assert.equal(new Headers(init?.headers).get("xi-api-key"), config.apiKey)
    assert.equal(init?.redirect, "error")
    if (String(url).includes("/v2/voices")) { voiceCalls++; return voiceResponse() }
    speechCalls++
    assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/bullVoice?output_format=mp3_44100_128")
    const payload = JSON.parse(String(init?.body))
    assert.equal(payload.text, buildAudioManifest(result).turns[0].text)
    assert.equal(payload.model_id, "eleven_v3")
    assert.equal(payload.language_code, "en")
    return clipResponse()
  })
  try {
    server.api.register(result)
    const status = await fetch(`${server.url}/api/audio/config`).then((response) => response.text())
    assert.equal(status.includes(config.apiKey), false)
    assert.equal(JSON.parse(status).bullVoiceId, "bullVoice")
    assert.equal(JSON.parse(status).bearVoiceId, "bearVoice")
    const first = await post(server.url)
    assert.equal(first.headers.get("Content-Type"), "audio/mpeg")
    assert.equal(first.headers.get("X-Audio-Cached"), "false")
    assert.equal((await first.arrayBuffer()).byteLength, 6)
    const second = await post(server.url)
    assert.equal(second.headers.get("X-Audio-Cached"), "true")
    await second.arrayBuffer()
    assert.equal(speechCalls, 1)
    assert.equal(voiceCalls, 1)
  } finally { await server.close() }
})
test("arbitrary speech, unknown reports, foreign origins and unlisted voices cannot spend credits", async () => {
  let speechCalls = 0
  const server = await app(async (url) => { if (String(url).includes("/v2/voices")) return voiceResponse(); speechCalls++; return clipResponse() })
  try {
    server.api.register(result)
    assert.equal((await post(server.url, "speech", { ...body, text: "arbitrary user content" })).status, 400)
    assert.equal((await post(server.url, "speech", { ...body, reportId: "unknown" })).status, 404)
    assert.equal((await post(server.url, "speech", body, { headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" } })).status, 403)
    assert.equal((await post(server.url, "speech", { ...body, voiceId: "unlistedVoice" })).status, 400)
    assert.equal(speechCalls, 0)
  } finally { await server.close() }
})
test("a disconnect cancels paid work and concurrent generation does not duplicate it", async () => {
  let started!: () => void
  let stopped!: () => void
  const began = new Promise<void>((resolve) => { started = resolve })
  const aborted = new Promise<void>((resolve) => { stopped = resolve })
  let speechCalls = 0
  const server = await app(async (url, init) => {
    if (String(url).includes("/v2/voices")) return voiceResponse()
    speechCalls++
    started()
    return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => { stopped(); reject(new DOMException("Aborted", "AbortError")) }, { once: true }))
  })
  try {
    server.api.register(result)
    const controller = new AbortController()
    const running = post(server.url, "speech", body, { signal: controller.signal })
    const rejection = assert.rejects(running, { name: "AbortError" })
    await began
    assert.equal((await post(server.url)).status, 429)
    assert.equal(speechCalls, 1)
    controller.abort()
    await rejection
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error("upstream not stopped")), 1_500))])
  } finally { await server.close() }
})
test("provider errors are sanitized, there is no automatic retry, and reports expire", async () => {
  let calls = 0
  const server = await app(async (url) => { if (String(url).includes("/v2/voices")) return voiceResponse(); calls++; return new Response("private provider account details", { status: 401 }) })
  const originalNow = Date.now
  try {
    server.api.register(result)
    const failure = await post(server.url).then((response) => response.text())
    assert.ok(!failure.includes("private provider"))
    assert.ok(!failure.includes(config.apiKey))
    assert.equal(calls, 1)
    Date.now = () => originalNow() + 3_600_001
    assert.equal((await fetch(`${server.url}/api/audio/reports/${result.reportId}`)).status, 404)
  } finally { Date.now = originalNow; await server.close() }
})
