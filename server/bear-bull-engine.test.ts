import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildDebateContext,
  parseOpening,
  parseRebuttal,
  runDebate,
  sourceUrl,
} from "./bear-bull-engine.ts"
import type { DebateContext } from "./bear-bull-engine.ts"
import type { DebateEvent } from "../src/bear-bull-types"

const url = "https://example.org/bitcoin-report"
const context: DebateContext = {
  coin: {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    priceUsd: 80_000,
    marketCapUsd: 1e12,
    circulatingSupply: 20e6,
    maxSupply: 21e6,
    providerUpdatedAt: "2026-10-15T06:00:00Z",
  },
  asOf: "2026-10-15T06:00:00Z",
  dataAt: "2026-10-15T06:00:00Z",
  feedAt: "2026-10-15T06:00:00Z",
  marketStale: false,
  feedStale: false,
  gaps: [],
  unavailableSources: [],
  evidence: [],
  coverage: "headlines only",
  sources: [{ url, title: "Market report", origin: "feed" }],
}
const config = {
  apiKey: "test-only-placeholder",
  model: "gemini-2.5-flash",
  bullAgentId: "agent_bull",
  bearAgentId: "agent_bear",
}
function opening(source = url) {
  return {
    summary: "ทดสอบข้อเสนอ",
    claims: [
      {
        title: "ข้อมูลที่ควรพิจารณา",
        argument: "ข้อเสนอพร้อมหลักฐาน",
        caveat: "ยังมีความไม่แน่นอน",
        source_urls: [source],
      },
    ],
    gaps: [],
  }
}
test("ElevenLabs roles research independently then answer every opposing claim", async () => {
 const tasks: import("./eleven-agent.ts").AgentTask[]=[]
 const events:DebateEvent[]=[]
 const result=await runDebate({config,context,signal:new AbortController().signal,emit:event=>events.push(event),taskRunner:async task=>{
  tasks.push(task)
  assert.equal(task.config.model,"gemini-2.5-flash")
  const side=task.agentId===config.bullAgentId?"bull":"bear"
  if(task.kind==="submit_opening") return opening()
  assert.equal(events.filter(event=>event.type==="opening").length,2)
  return {summary:"ตอบครบ",replies:[{claim_id:`${side==="bull"?"bear":"bull"}-1`,position:"challenge",argument:"หลักฐานอีกด้าน",source_urls:[url]}]}
 }})
 assert.equal(tasks.length,4)
 assert.deepEqual(tasks.map(task=>task.kind),["submit_opening","submit_opening","submit_rebuttal","submit_rebuttal"])
 assert.equal(result.rebuttals.bull.replies[0].claimId,"bear-1")
 assert.equal(result.rebuttals.bear.replies[0].claimId,"bull-1")
 assert.deepEqual(result.usage,{requests:4,inputTokens:null,outputTokens:null})
 assert.match(result.reportId,/^[a-f0-9-]{36}$/)
})

test("citation validation rejects invented URLs, empty evidence, credentials and scripts", () => {
  const registry = new Map(
    context.sources.map((source) => [source.url, source]),
  )
  assert.throws(
    () =>
      parseOpening(opening("https://invented.example/claim"), "bull", registry),
    { code: "unverified_citation" },
  )
  const uncited = opening()
  uncited.claims[0].source_urls = []
  assert.throws(() => parseOpening(uncited, "bull", registry), {
    code: "missing_citations",
  })
  assert.equal(sourceUrl("javascript:alert(1)"), null)
  assert.equal(sourceUrl("https://user:password@example.org/"), null)
  assert.equal(sourceUrl(`${url}?utm_source=a&id=5#heading`), `${url}?id=5`)
})

test("cross-examination cannot omit or duplicate an opponent argument", () => {
  const registry = new Map(
    context.sources.map((source) => [source.url, source]),
  )
  const opponent = parseOpening(
    { ...opening(), claims: [opening().claims[0], opening().claims[0]] },
    "bear",
    registry,
  )
  const reply = {
    claim_id: "bear-1",
    position: "uncertain",
    argument: "หลักฐานยังไม่พอ",
    source_urls: [],
  }
  assert.throws(
    () =>
      parseRebuttal(
        { summary: "summary", replies: [reply] },
        opponent,
        registry,
      ),
    { code: "incomplete_debate" },
  )
  assert.throws(
    () =>
      parseRebuttal(
        { summary: "summary", replies: [reply, reply] },
        opponent,
        registry,
      ),
    { code: "incomplete_debate" },
  )
  assert.equal(
    parseRebuttal(
      {
        summary: "summary",
        replies: [reply, { ...reply, claim_id: "bear-2" }],
      },
      opponent,
      registry,
    ).replies.length,
    2,
  )
})

test("invalid source submissions fail closed and aborted tasks never start paid work", async () => {
 await assert.rejects(runDebate({config,context,signal:new AbortController().signal,emit(){},taskRunner:async()=>opening("https://invented.example/claim")}),{code:"unverified_citation"})
 const controller=new AbortController();controller.abort()
 let calls=0
 await assert.rejects(runDebate({config,context,signal:controller.signal,emit(){},taskRunner:async()=>{calls++;return opening()}}),{name:"AbortError"})
 assert.equal(calls,0)
})

test("context excludes heuristic verdicts while retaining bounded evidence and timestamps", () => {
  const at = context.asOf
  const coin = {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    image: "",
    rank: 1,
    price: 80_000,
    marketCap: 1e12,
    change24h: null,
    circulatingSupply: 20e6,
    maxSupply: 21e6,
    updatedAt: at,
  }
  const data = buildDebateContext(
    coin,
    { coins: [coin], fetchedAt: at, stale: false, source: "CoinGecko" },
    {
      fetchedAt: at,
      stale: false,
      unavailableSources: [],
      items: [
        {
          id: "a",
          title: "Bitcoin ETF records net inflows",
          url,
          source: "Example",
          publishedAt: at,
          kind: "News",
          topics: ["BTC"],
        },
      ],
    },
    Date.parse(at),
  )
  assert.ok(data.evidence.some((item) => item.title.includes("inflows")))
  assert.ok(
    data.evidence.every((item) => !("tone" in item) && !("reason" in item)),
  )
  assert.equal(data.dataAt, at)
  assert.match(data.coverage, /partial sample/)
})
