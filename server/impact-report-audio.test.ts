import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { createAudioApi } from "./audio-api.ts"
import { createImpactApi } from "./impact-api.ts"
import { buildImpactAudio } from "./impact-report-audio.ts"
import { buildImpactReport } from "../src/impact-report.ts"
import { analyzeCoinImpact } from "../src/coin-impact.ts"
import { impactInput } from "../src/impact-types.ts"
import type { MarketCoin, FeedResponse, MarketResponse } from "../src/data-types"
import type { ImpactReview } from "../src/impact-types"

const at = new Date().toISOString()
const coin: MarketCoin = { id: "bitcoin", symbol: "BTC", name: "Bitcoin", image: "", rank: 1, price: 1, marketCap: 1, change24h: 0, circulatingSupply: null, maxSupply: null, updatedAt: at }
const market: MarketResponse = { coins: [coin], fetchedAt: at, stale: false, source: "CoinGecko" }
const feed: FeedResponse = { items: ["positive", "negative", "unsupported", "pending"].map(id => ({ id, title: `Bitcoin ${id} report`, url: `https://www.coindesk.com/${id}`, source: "CoinDesk", publishedAt: at, kind: "News", topics: [] })), fetchedAt: at, stale: false, unavailableSources: [] }
const review: ImpactReview = { coinId: coin.id, model: "fixture", newlyReviewed: 0,
  labels: analyzeCoinImpact({ coin, feed, now: Date.now() }).evidence.filter(row => row.id !== "pending").map(row => ({
    id: row.id, input: impactInput(coin.id, row), label: row.id === "negative" ? "negative" : "positive",
    reason: `Reviewed explanation for ${row.id}`, quote: row.title, basis: "headline", classifiedAt: at,
    verification: { id: row.id, input: "fixture", status: row.id === "unsupported" ? "unverified" : "approved", reason: "Matched source", checkedAt: at, impactReviewedAt: at,
      references: row.id === "unsupported" ? [] : [{ url: row.url, title: row.title, source: row.source, quote: row.title, kind: "publisher", retrievedAt: at }] },
  })) }

test("report narration covers both displayed columns, names sources, and excludes unsupported and pending claims", () => {
  const report = buildImpactReport(coin, feed, review, Date.now(), false)
  const manifest = buildImpactAudio(report)
  const text = manifest.turns.map(turn => turn.text).join(" ")
  assert.ok(text.includes("BTC report"))
  assert.ok(text.includes("Positive news. 1 signal"))
  assert.ok(text.includes("Negative news. 1 signal"))
  assert.ok(text.includes(report.positive[0].reason))
  assert.ok(text.includes(report.negative[0].reason))
  assert.ok(text.includes("Source: CoinDesk"))
  assert.ok(!text.includes("Reviewed explanation for unsupported"))
  assert.ok(!text.includes("Bitcoin pending report"))
  assert.ok(text.includes("1 inconclusive. 1 awaiting review"))
  assert.ok(!text.includes("https://"))
  assert.ok(manifest.turns.every(turn => Array.from(turn.text).length <= 1000))
  assert.equal(manifest.characters, Array.from(manifest.turns.map(turn => turn.text).join("")).length)
  const stale = buildImpactAudio(buildImpactReport(coin, feed, review, Date.now(), true))
  assert.ok(stale.turns[0].text.includes("Fresh market and news data are unavailable"))
  assert.ok(stale.turns.some(turn => turn.text.includes("No source-checked positive signals")))
})

test("Listen only reads cached reviews, signs server text, and generates cached speech only on explicit playback", async () => {
  const spoken: string[] = [], readOnly: boolean[] = []
  const audio = createAudioApi({ getConfig: () => ({ apiKey: "test-only-report-audio-secret", model: "eleven_v3", bullVoiceId: "", bearVoiceId: "" }),
    fetcher: async (url, init) => {
      if (String(url).includes("/voices")) return Response.json({ voices: [{ voice_id: "narrator", name: "Brian" }] })
      spoken.push(JSON.parse(String(init?.body)).text)
      return new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "Content-Type": "audio/mpeg" } })
    },
  })
  const impact = createImpactApi({ getConfig: () => ({ apiKey: "fixture", model: "gemini-2.5-flash", bullAgentId: "", bearAgentId: "" }), getData: async () => [market, feed],
    reviewer: async (_coin, _market, _feed, _signal, cached) => { readOnly.push(Boolean(cached)); return review },
    narrate: report => { const manifest = buildImpactAudio(report); return { manifest, audioToken: audio.registerManifest(manifest) } },
  })
  const server = createServer((req, res) => { void (req.url?.startsWith("/api/audio/") ? audio.handle(req, res) : impact(req, res)) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (path: string, body: unknown, origin?: string) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(base + "/api/impact/report")).status, 405)
    assert.equal((await post("/api/impact/report", { coinId: "bitcoin" }, "https://evil.example")).status, 403)
    assert.equal((await post("/api/impact/report", { coinId: "bitcoin", text: "invented speech" })).status, 400)
    assert.equal((await post("/api/impact/report", { coinId: "bitcoin", newsId: "positive" })).status, 400)
    assert.deepEqual(readOnly, [])
    const response = await post("/api/impact/report", { coinId: "bitcoin" })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(readOnly, [true])
    assert.equal(payload.report.positive.length, 1)
    assert.equal(payload.report.negative.length, 1)
    assert.equal(spoken.length, 0, "Preparing a narration incurs no speech call")
    assert.ok(payload.audioToken)
    const request = { reportId: payload.manifest.reportId, turnId: "0", audioToken: payload.audioToken }
    assert.equal((await post("/api/audio/speech", { ...request, text: "forged" })).status, 400)
    const first = await post("/api/audio/speech", request)
    assert.equal(first.status, 200)
    assert.equal(first.headers.get("content-type"), "audio/mpeg")
    await first.arrayBuffer()
    const secondPayload = await (await post("/api/impact/report", { coinId: "bitcoin" })).json()
    const second = await post("/api/audio/speech", { reportId: secondPayload.manifest.reportId, turnId: "0", audioToken: secondPayload.audioToken })
    assert.equal(second.status, 200)
    assert.equal(second.headers.get("x-audio-cached"), "true")
    await second.arrayBuffer()
    assert.equal(spoken.length, 1, "Identical text from another report uses the cached audio")
    assert.equal(spoken[0], payload.manifest.turns[0].text)
    assert.deepEqual(readOnly, [true, true])
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
