import { test } from "node:test"
import assert from "node:assert/strict"
import { createImpactReviewer, validateClassifications, validatePartialClassifications, priceOnlyHeadline } from "./impact-review.ts"
import type { ReviewInput, ReviewStore } from "./impact-review.ts"
import { impactAgentDefinition, impactAgentName, impactAnalystDefinition } from "./impact-agent-definition.ts"
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
    readExcerpt: async row => { sources++; return row.title }, runTask: async (task) => {
      calls++
      assert.equal(task.kind, "submit_classification")
      assert.equal(task.prompt.includes(config.apiKey), false)
      const data = JSON.parse(task.prompt.slice(task.prompt.indexOf("\n") + 1))
      return { labels: data.map((i: any) => ({ id: i.id, label: "neutral", basis: "headline", quote: i.headline, reference_ids: [], reference_quotes: [], verification_reason: "No accessible article text was available to support this claim.", reason: "This is factual background with no supported directional impact on the target." })) }
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

test("read-only polling returns pending evidence without starting a paid task", async () => {
  let calls = 0
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), runTask: async () => { calls++; throw new Error("must not run") } })
  const value = await reviewer(coin(), market(), feed(), signal(), true)
  assert.equal(value.pending, 1)
  assert.equal(value.newlyReviewed, 0)
  assert.equal(calls, 0)
})

test("incomplete model output is not cached as a verdict and has a cooldown", async () => {
  let calls = 0
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), fetcher: discovery, readExcerpt: async row => row.title, runTask: async () => { calls++; return { labels: [] } } })
  const c = coin(), f = feed()
  await assert.rejects(reviewer(c, market(c), f, signal()), /verifiable classifications/)
  await assert.rejects(reviewer(c, market(c), f, signal()), /recent impact review failed/)
  assert.equal(calls, 1)
})

test("short task ids map to real news ids; invalid and duplicate evidence stays pending", () => {
  const first = inputs()[0]
  const data = [first, { ...first, row: { ...first.row, id: "second" } }, { ...first, row: { ...first.row, id: "third" } }]
    .map((input, index) => ({ ...input, taskId: `news_${index + 1}` }))
  const labels = data.map((input) => ({ ...output([input]).labels[0], id: input.taskId }))
  const valid = validatePartialClassifications({ labels: [labels[0], { ...labels[1], quote: "Invented evidence with no matching source" }] }, data, "bitcoin")
  assert.equal(valid.length, 1)
  assert.equal(valid[0].id, first.row.id)
  assert.equal(valid[0].input, JSON.stringify(["bitcoin", first.row.id, first.row.url, first.row.title, first.row.at, first.row.scope, ""]))
  assert.throws(() => validatePartialClassifications({ labels: [labels[0], labels[0]] }, data, "bitcoin"), /verifiable/)
})

test("partial successes survive a retry; only remaining news starts another task", async () => {
  const store = memory(); let calls = 0
  const c = coin(), f = feed([item(), item("Bitcoin ETF records net inflows", "https://coindesk.com/news/b")])
  const make = () => createImpactReviewer({ getConfig: () => config, store, fetcher: discovery, readExcerpt: async row => row.title,
    runTask: async (task) => {
      calls++
      const data = JSON.parse(task.prompt.slice(task.prompt.indexOf("\n") + 1))
      assert.equal(data.length, calls === 1 ? 2 : 1)
      if (calls === 2) assert.equal(data[0].url, f.items[1].url)
      return { labels: data.map((i: any, index: number) => ({ id: i.id, label: "neutral", basis: "headline",
        quote: calls === 1 && index === 1 ? "An invented quotation from nowhere" : i.headline,
        reference_ids: [], reference_quotes: [], verification_reason: "No accessible article text was available to support this claim.",
        reason: "This is factual background without a supported directional mechanism." })) }
    },
  })
  const first = await make()(c, market(c), f, signal())
  assert.equal(first.labels.length, 1); assert.equal(first.pending, 1)
  const polled = await make()(c, market(c), f, signal(), true)
  assert.equal(polled.labels.length, 1); assert.equal(polled.pending, 1); assert.equal(calls, 1)
  const second = await make()(c, market(c), f, signal())
  assert.equal(second.labels.length, 2); assert.equal(second.newlyReviewed, 1); assert.equal(second.pending, 0)
  const cached = await make()(c, market(c), f, signal())
  assert.equal(cached.newlyReviewed, 0); assert.equal(calls, 2)
})

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) { if (check()) return; await nextTurn() }
  assert.fail("Expected worker progress")
}
function taskOutput(task: { prompt: string }) {
  const data = JSON.parse(task.prompt.slice(task.prompt.indexOf("\n") + 1))
  return { labels: data.map((i: any) => ({ id: i.id, label: "neutral", basis: "headline", quote: i.headline, reference_ids: [], reference_quotes: [], verification_reason: "No accessible article text was available to support this claim.",
    reason: "The report is factual background without a supported directional mechanism." })) }
}

test("three workers split twelve news items, publish partial cache and retry only a failed batch", async () => {
  const c = coin(), f = feed(Array.from({ length: 12 }, (_, i) => item(`Bitcoin exchange event number ${i}`, `https://coindesk.com/news/${i}`)))
  let active = 0, peak = 0
  const tasks: { prompt: string; resolve: (value: unknown) => void; reject: (error: Error) => void }[] = []
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), fetcher: discovery, readExcerpt: async row => row.title,
    runTask: async task => {
      active++; peak = Math.max(peak, active)
      try { return await new Promise((resolve, reject) => tasks.push({ prompt: task.prompt, resolve, reject })) }
      finally { active-- }
    },
  })
  const pending = reviewer(c, market(c), f, signal())
  await until(() => tasks.length === 3)
  assert.equal(peak, 3)
  const ids = tasks.flatMap(task => taskOutput(task).labels.map((label: any) => label.id))
  assert.equal(ids.length, 12); assert.equal(new Set(ids).size, 12)
  assert.ok(tasks.every(task => taskOutput(task).labels.length === 4))
  tasks[0].resolve(taskOutput(tasks[0]))
  tasks[1].reject(new Error("Simulated provider failure"))
  await until(() => active === 1)
  const partial = await reviewer(c, market(c), f, signal(), true)
  assert.equal(partial.labels.length, 4); assert.equal(partial.pending, 8); assert.equal(partial.running, true)
  await assert.rejects(reviewer(c, market(c), f, signal()), /already running/)
  tasks[2].resolve(taskOutput(tasks[2]))
  const first = await pending
  assert.equal(first.labels.length, 8); assert.equal(first.pending, 4); assert.equal(first.running, false)
  const stopped = await reviewer(c, market(c), f, signal(), true)
  assert.equal(stopped.running, false); assert.equal(tasks.length, 3)
  const retry = reviewer(c, market(c), f, signal())
  await until(() => tasks.length === 4)
  const inputs = (task: { prompt: string }) => JSON.parse(task.prompt.slice(task.prompt.indexOf("\n") + 1)).map((row: any) => row.url).sort()
  assert.deepEqual(inputs(tasks[3]), inputs(tasks[1]))
  tasks[3].resolve(taskOutput(tasks[3]))
  const second = await retry
  assert.equal(second.labels.length, 12); assert.equal(second.newlyReviewed, 4); assert.equal(second.pending, 0)
  assert.equal((await reviewer(c, market(c), f, signal())).newlyReviewed, 0)
  assert.equal(tasks.length, 4)
})

test("a configured worker limit queues remaining batches and cancellation stops queued paid tasks", async () => {
  const c = coin(), f = feed(Array.from({ length: 5 }, (_, i) => item(`Bitcoin exchange event ${i}`, `https://coindesk.com/news/${i}`)))
  const controller = new AbortController()
  let calls = 0
  const tasks: { prompt: string; resolve: (value: unknown) => void }[] = []
  const reviewer = createImpactReviewer({ getConfig: () => ({ ...config, impactReviewConcurrency: 2, impactReviewBatchSize: 1 }),
    store: memory(), fetcher: discovery, readExcerpt: async row => row.title, runTask: task => {
      calls++
      return new Promise((resolve, reject) => {
        const abort = () => reject(task.signal.reason)
        task.signal.addEventListener("abort", abort, { once: true })
        tasks.push({ prompt: task.prompt, resolve: value => { task.signal.removeEventListener("abort", abort); resolve(value) } })
      })
    },
  })
  const work = reviewer(c, market(c), f, controller.signal)
  const rejected = assert.rejects(work, { name: "AbortError" })
  await until(() => tasks.length === 2)
  tasks[0].resolve(taskOutput(tasks[0]))
  await until(() => tasks.length === 3)
  controller.abort()
  await rejected
  assert.equal(calls, 3, "Remaining two batches were never started")
  const cached = await reviewer(c, market(c), f, signal(), true)
  assert.equal(cached.labels.length, 1); assert.equal(cached.pending, 4); assert.equal(cached.running, false)
})

test("unsupported original links skip inference; explicit retry reopens only that source", async () => {
  const c = coin(), f = feed([item(), item("Bitcoin ETF records net inflows", "https://coindesk.com/news/b")])
  let calls = 0, reads = 0
  const reviewer = createImpactReviewer({ getConfig: () => config, store: memory(), fetcher: discovery,
    readExcerpt: async () => { reads++; return "" }, runTask: async () => { calls++; throw new Error("No model needed") },
  })
  const first = await reviewer(c, market(c), f, signal())
  assert.ok(first.labels.every(value => value.label === "unknown"))
  assert.equal((await reviewer(c, market(c), f, signal())).newlyReviewed, 0)
  const retry = await reviewer(c, market(c), f, signal(), false, f.items[0].id)
  assert.equal(retry.newlyReviewed, 1); assert.equal(calls, 0); assert.equal(reads, 3); assert.equal(retry.labels.length, 2)
})

test("impact-only analyst has a bounded thinking budget and no reference assessment fields", () => {
  const d = impactAnalystDefinition(config.model, 1024)
  const prompt = d.conversation_config.agent.prompt
  const fields = prompt.tools[0].parameters.properties.labels.items.required
  for (const field of ["reference_ids", "reference_quotes", "verification_reason"]) assert.equal(fields.includes(field), false)
  assert.equal(prompt.thinking_budget, 1024)
  assert.deepEqual(prompt.tools.map(tool => tool.name), ["submit_classification"])
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
