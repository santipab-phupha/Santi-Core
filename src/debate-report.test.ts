import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDebateReportHtml, debateReportFilename } from "./debate-report.ts"
import type { DebateResult } from "./bear-bull-types"

const source = { url: "https://example.org/research?asset=BTC&lang=en", title: "Original research", origin: "feed" as const }
const result: DebateResult = {
  reportId: "fixture-report", coinId: "bitcoin", coinName: "Bitcoin", symbol: "BTC", model: "gemini-2.5-flash", reasoning: "agent-managed", createdAt: "2026-10-16T06:30:00Z", dataAt: "2026-10-16T06:29:00Z", audioToken: "must-not-be-in-download",
  openings: {
    bull: { side: "bull", summary: "Bull overview", gaps: ["Bull evidence gap"], claims: [{ id: "b1", title: "Demand channel", argument: "Bull evidence and explanation", caveat: "Demand is not guaranteed", sources: [source] }] },
    bear: { side: "bear", summary: "Bear overview", gaps: ["Bear evidence gap"], claims: [{ id: "r1", title: "Supply risk", argument: "Bear evidence and explanation", caveat: "Timing is uncertain", sources: [source] }] },
  },
  rebuttals: {
    bull: { side: "bull", summary: "Bull after debate", replies: [{ claimId: "r1", position: "uncertain", argument: "Bull reply to supply risk", sources: [source] }] },
    bear: { side: "bear", summary: "Bear after debate", replies: [{ claimId: "b1", position: "challenge", argument: "Bear challenges the demand claim", sources: [source] }] },
  }, sources: [source], gaps: ["Shared coverage gap"], usage: { requests: 4, inputTokens: null, outputTokens: null },
}

test("download preserves every claim, response, caveat, perspective, gap and source without audio credentials", () => {
  const html = buildDebateReportHtml(result)
  for (const text of ["Demand channel", "Supply risk", "Bull evidence and explanation", "Bear evidence and explanation", "Bull reply to supply risk", "Bear challenges the demand claim", "Demand is not guaranteed", "Timing is uncertain", "Bull overview", "Bear overview", "Bull after debate", "Bear after debate", "Bull evidence gap", "Bear evidence gap", "Shared coverage gap", "Challenged", "Insufficient evidence", "13:30:00", "Asia/Bangkok"])
    assert.ok(html.includes(text), `Missing ${text}`)
  assert.equal((html.match(/class="dispute"/g) ?? []).length, 2)
  assert.equal((html.match(/class="bull"/g) ?? []).length, 4)
  assert.equal((html.match(/class="bear"/g) ?? []).length, 4)
  assert.ok(html.includes("https://example.org/research?asset=BTC&amp;lang=en"))
  assert.ok(!html.includes(result.audioToken!))
  assert.ok(!html.includes("audioToken"))
  assert.equal(debateReportFilename(result), "Santi-Core-BTC-Bear-Bull-2026-10-16-06-30-00.html")
})

test("untrusted report text cannot create active HTML, scripts or unsafe source links", () => {
  const unsafe = structuredClone(result)
  unsafe.coinName = '<img src=x onerror="alert(1)">'
  unsafe.openings.bull.claims[0].argument = "</p><script>alert('x')</script>"
  unsafe.sources = [{ url: 'javascript:alert("x")', title: "Bad destination", origin: "web" }, { url: "https://user:secret@example.org", title: "Credentials", origin: "web" }]
  unsafe.symbol = "../../BTC<script>"
  const html = buildDebateReportHtml(unsafe)
  assert.ok(!html.includes("<img"))
  assert.ok(!html.includes("<script>"))
  assert.ok(html.includes("&lt;script&gt;"))
  assert.ok(!html.includes('href="javascript:'))
  assert.ok(!html.includes("user:secret"))
  assert.ok(!debateReportFilename(unsafe).includes("/"))
  assert.ok(html.includes("default-src 'none'"))
})
