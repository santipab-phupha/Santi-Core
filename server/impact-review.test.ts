import { test } from "node:test"
import assert from "node:assert/strict"
import { createImpactReviewer, validateClassifications, priceOnlyHeadline } from "./impact-review.ts"
import type { ReviewInput, ReviewStore } from "./impact-review.ts"
import { impactAgentDefinition, impactAgentName } from "./impact-agent-definition.ts"
import type { MarketCoin, MarketResponse, FeedResponse, FeedItem } from "../src/data-types"
import { analyzeCoinImpact } from "../src/coin-impact.ts"
import { reviewedEvidence } from "../src/impact-types.ts"

const config = { apiKey: "test-only-impact-key", model: "gemini-2.5-flash", bullAgentId: "agent_bull", bearAgentId: "agent_bear" }
const at = () => new Date().toISOString()
const coin = (): MarketCoin => ({ id: "bitcoin", symbol: "BTC", name: "Bitcoin", rank: 1, image: "", price: 100, marketCap: 1e9, change24h: null, circulatingSupply: 1000, maxSupply: 2000, updatedAt: at() })
const item = (title = "Bitcoin exchange denies hack", url = "https://coindesk.com/news/a"): FeedItem => ({ id: url, title, url, source: "CoinDesk", kind: "News", topics: [], publishedAt: at() })
const feed = (items = [item()]): FeedResponse => ({ items, fetchedAt: at(), stale: false, unavailableSources: [] })
const market = (asset = coin()): MarketResponse => ({ coins: [asset], fetchedAt: at(), source: "CoinGecko", stale: false })
function memory(): ReviewStore {
  const map = new Map<string, { value: unknown; expires: number }>()
  return { async get(key) { const e = map.get(key); return e && e.expires > Date.now() ? e.value : undefined }, async set(key, value, ttl) { map.set(key, { value, expires: Date.now() + ttl * 1000 }) }, async delete(key) { map.delete(key) } }
}
const discovery: typeof fetch = async () => Response.json({ agents: [{ name: impactAgentName, agent_id: "agent_impact" }] })
const signal = () => new AbortController().signal
function inputs(): ReviewInput[] { const f = feed(); return analyzeCoinImpact({ coin: coin(), feed: f, now: Date.now() }).evidence.filter((r) => !r.id.startsWith("supply:")).map((row) => ({ row, excerpt: "The exchange provided evidence that no customer funds were compromised.", structured: "" })) }
function output(data: ReviewInput[]) { return { labels: data.map(({ row }) => ({ id: row.id, label: "neutral", basis: "headline", quote: row.title, reason: "The report denies the alleged incident; no new directional mechanism is established." })) } }

test("classifications must cover exact ids and quote actual available evidence", () => {
  const data = inputs()
  const good = output(data)
  assert.equal(validateClassifications(good, data, "bitcoin")[0].label, "neutral")
  for (const patch of [ { labels: [] }, { labels: [...good.labels, ...good.labels] }, { labels: [{ ...good.labels[0], id: "invented" }] }, { labels: [{ ...good.labels[0], label: "bullish" }] }, { labels: [{ ...good.labels[0], quote: "An invented quotation from a source" }] }, { labels: [{ ...good.labels[0], basis: "structured" }] } ]) assert.throws(() => validateClassifications(patch, data, "bitcoin"))
})

test("neutral context, supply snapshots and unreviewed rows never inflate Inconclusive", () => {
  const c = coin(); const f = feed(); const rows = analyzeCoinImpact({ coin: c, feed: f, now: Date.now() }).evidence
  const labels = validateClassifications(output(inputs()), inputs(), c.id)
  // Use the exact live candidate signature in this fixture.
  labels[0].input = JSON.stringify([c.id, rows[0].id, rows[0].url, rows[0].title, rows[0].at, rows[0].scope, ""])
  const value = reviewedEvidence(c.id, rows, { coinId: c.id, model: config.model, labels, newlyReviewed: 1 }, true)
  assert.equal(value.context.length, 2)
  assert.deepEqual(value.counts, { positive: 0, negative: 0, unknown: 0 })
  assert.equal(reviewedEvidence(c.id, rows, null, true).pending.length, 1)
  assert.equal(reviewedEvidence("ethereum", rows, { coinId: c.id, model: config.model, labels, newlyReviewed: 1 }, true).evidence.length, 0)
  assert.equal(reviewedEvidence(c.id, rows, { coinId: c.id, model: config.model, labels, newlyReviewed: 1 }, false).evidence.length, 0)
})

test("fresh instances share item results; changed content and different assets require new reviews", async () => {
  const store = memory(); let calls = 0; let sources = 0
  const make = () => createImpactReviewer({ getConfig: () => config, store, fetcher: discovery,
    readExcerpt: async () => { sources++; return "" }, runTask: async (task) => {
      calls++
      assert.equal(task.kind, "submit_classification")
      assert.equal(task.prompt.includes(config.apiKey), false)
      const data = JSON.parse(task.prompt.slice(task.prompt.indexOf("\n") + 1))
      return { labels: data.map((i: any) => ({ id: i.id, label: "neutral", basis: "headline", quote: i.headline, reason: "This is factual background with no supported directional impact on the target." })) }
    },
  })
  const c = coin(); const f = feed()
  await make()(c, market(c), f, signal())
  const cached = await make()(c, market(c), f, signal())
  assert.equal(calls, 1); assert.equal(sources, 1); assert.equal(cached.newlyReviewed, 0)
  const changed = structuredClone(f); changed.items[0].title = "Bitcoin exchange confirms withdrawals are open"
  await make()(c, market(c), changed, signal())
  assert.equal(calls, 2)
  const eth = { ...c, id: "ethereum", symbol: "ETH", name: "Ethereum" }
  const macro = feed([item("Federal Reserve cuts interest rates", "https://coindesk.com/news/macro")])
  await make()(c, market(c), macro, signal()); await make()(eth, market(eth), macro, signal())
  assert.equal(calls, 4)
})

test("stale inputs and unavailable shared cache do not start paid work", async () => {
  let calls = 0
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), runTask: async () => { calls++; return {} } })
  await assert.rejects(reviewer(coin(), market(), { ...feed(), stale: true }, signal()), /Fresh/)
  const broken = createImpactReviewer({ getConfig: () => config, store: { async get() { throw new Error("cache down") }, async set() {}, async delete() {} }, runTask: async () => { calls++; return {} } })
  await assert.rejects(broken(coin(), market(), feed(), signal()), /cache down/)
  assert.equal(calls, 0)
})

test("incomplete model output is not cached as a verdict and has a cooldown", async () => {
  let calls = 0
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), fetcher: discovery, readExcerpt: async () => "", runTask: async () => { calls++; return { labels: [] } } })
  const c = coin(), f = feed()
  await assert.rejects(reviewer(c, market(c), f, signal()), /every supplied/)
  await assert.rejects(reviewer(c, market(c), f, signal()), /recent impact review failed/)
  assert.equal(calls, 1)
})

test("impact agent uses one bounded submission tool with authenticated English Gemini and no backup", () => {
  const d = impactAgentDefinition(config.model)
  assert.equal(d.conversation_config.agent.prompt.llm, config.model)
  assert.equal(d.conversation_config.agent.prompt.backup_llm_config.preference, "disabled")
  assert.equal(d.platform_settings.auth.enable_auth, true)
  assert.equal(d.conversation_config.conversation.text_only, true)
  assert.deepEqual(d.conversation_config.agent.prompt.tools.map((tool) => tool.name), ["submit_classification"])
})

test("price-only headlines cannot become directional signals without a reported event", () => {
  assert.equal(priceOnlyHeadline("Bitcoin falls alongside risk assets in market rout"), true)
  assert.equal(priceOnlyHeadline("Bitcoin falls as Fed raises interest rates"), false)
  assert.equal(priceOnlyHeadline("Bitcoin ETF records net inflows"), false)
  const data = inputs(); data[0].row.title = "Bitcoin falls below support in market rout"
  const raw = { labels: [{ ...output(data).labels[0], label: "negative" }] }
  assert.equal(validateClassifications(raw, data, "bitcoin")[0].label, "neutral")
})
