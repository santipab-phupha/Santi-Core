import { test } from "node:test"
import assert from "node:assert/strict"
import { analyzeCoinImpact, headlineSignal } from "./coin-impact.ts"
import type { FeedItem, FeedResponse, MarketCoin } from "./data-types"

const now = Date.parse("2026-10-15T06:00:00Z")
const at = (delta = 0) => new Date(now + delta).toISOString()
const coin: MarketCoin = {
  id: "bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, image: "",
  price: 80_000, marketCap: 1e12, change24h: 0,
  circulatingSupply: 1_000, maxSupply: 2_000, updatedAt: at(),
}
function article(title: string, url = "https://coindesk.com/news/a", patch: Partial<FeedItem> = {}): FeedItem {
  return { id: url, title, url, publishedAt: at(-3_600_000), source: new URL(url).hostname, kind: "News", topics: [], ...patch }
}
function feed(items: FeedItem[], patch: Partial<FeedResponse> = {}): FeedResponse {
  return { items, fetchedAt: at(), stale: false, unavailableSources: [], ...patch }
}
function unlock(patch: Partial<NonNullable<FeedItem["unlock"]>> = {}, itemPatch: Partial<FeedItem> = {}) {
  return article("Bitcoin (BTC) cliff unlock", "https://tokenomist.ai/bitcoin", {
    source: "Tokenomist", kind: "Tokenomics", topics: ["Bitcoin", "BTC"],
    unlock: { date: at(86_400_000), amount: 20, valueUsd: null, symbol: "BTC", checkedAt: at(), ...patch },
    ...itemPatch,
  })
}
const analyze = (items: FeedItem[], extra: Partial<Parameters<typeof analyzeCoinImpact>[0]> = {}) =>
  analyzeCoinImpact({ coin, feed: feed(items), now, ...extra })

test("ambiguous, speculative and negated headlines abstain", () => {
  for (const title of [
    "Bitcoin ETF could see inflows", "Bitcoin exchange denies hack", "Bitcoin was not hacked",
    "Will Bitcoin ETF see inflows?", "Bitcoin ETF inflows slow", "Bitcoin ETF outflows end",
    "Bitcoin ETF sees inflows but faces outflows", "Bitcoin ETF inflows drop",
    "Bitcoin rises 20%", "Fed cuts interest rates",
  ]) assert.equal(headlineSignal(title).tone, "unknown", title)
  assert.equal(headlineSignal("Bitcoin ETF records $100M net inflows").tone, "positive")
  assert.equal(headlineSignal("Bitcoin exchange halts withdrawals").tone, "negative")
  assert.equal(headlineSignal("Bitcoin exchange was hacked").tone, "negative")
  assert.equal(headlineSignal("Bitcoin Falls as Hot Inflation Puts a Fed Hike Back on the Table").tone, "negative")
  assert.equal(headlineSignal("U.S. CPI comes in hot, sending bitcoin sharply lower").tone, "negative")
  assert.equal(headlineSignal("Bitcoin climbs as Fed cuts interest rates").tone, "positive")
  assert.equal(headlineSignal("Bank wins approval to trade Bitcoin").tone, "positive")
  assert.equal(headlineSignal("Bank opens Bitcoin and Ethereum trading to clients").tone, "positive")
  assert.equal(headlineSignal("Bank may open Bitcoin trading after approval").tone, "unknown")
})

test("two current directional sources can lean positive; supply alone cannot", () => {
  const result = analyze([
    article("Bitcoin ETF records net inflows"),
    article("Bitcoin funds attract inflows", "https://decrypt.co/news/b"),
  ])
  assert.equal(result.tone, "positive")
  assert.deepEqual(result.counts, { positive: 2, negative: 0, unknown: 1 })
  assert.equal(analyze([]).tone, "unknown")
  assert.equal(analyze([]).counts.positive, 0)
})

test("opposing signals keep the combined result undecided", () => {
  const result = analyze([
    article("Bitcoin ETF records inflows"),
    article("Bitcoin fund records outflows", "https://decrypt.co/news/b"),
  ])
  assert.equal(result.tone, "unknown")
  assert.equal(result.counts.positive, 1)
  assert.equal(result.counts.negative, 1)
})

test("unrelated coins are excluded and broad market context stays unconfirmed", () => {
  const result = analyze([
    article("Ethereum ETF sees record inflows"),
    article("Crypto markets face inflation concerns", "https://decrypt.co/news/b"),
    article("Bitcoin price outlook", "https://cointelegraph.com/news/c"),
  ])
  assert.equal(result.scoped.coin, 1)
  assert.equal(result.scoped.market, 1)
  assert.equal(result.counts.positive, 0)
  assert.equal(result.evidence.some((row) => row.title.includes("Ethereum")), false)
})

test("ordinary words do not match an uppercase coin ticker", () => {
  const near = { ...coin, id: "near", name: "NEAR Protocol", symbol: "NEAR" }
  const result = analyze([article("Bitcoin ETF inflows near record")], { coin: near })
  assert.equal(result.scoped.coin, 0)
})

test("duplicate titles and tracking URLs cannot manufacture source support", () => {
  const result = analyze([
    article("Bitcoin ETF records inflows", "https://coindesk.com/news/a?utm_source=rss"),
    article("Bitcoin ETF records inflows", "https://decrypt.co/news/b"),
    article("Bitcoin ETF reports inflows", "https://coindesk.com/news/a?utm_source=web"),
  ])
  assert.equal(result.scoped.coin, 1)
  assert.equal(result.tone, "unknown")
})

test("stale feeds, missing sources, and stale markets cannot produce a combined verdict", () => {
  const items = [article("Bitcoin ETF inflows"), article("Bitcoin exchange hacked", "https://decrypt.co/news/b")]
  for (const patch of [{ stale: true }, { fetchedAt: at(-3_600_000) }]) {
    const result = analyze(items, { feed: feed(items, patch) })
    assert.equal(result.counts.positive + result.counts.negative, 0)
    assert.equal(result.tone, "unknown")
  }
  const positive = [article("Bitcoin ETF inflows"), article("Bitcoin fund inflows", "https://decrypt.co/news/b")]
  assert.equal(analyze(positive, { marketStale: true }).tone, "unknown")
  assert.equal(analyze(positive, { feed: feed(positive, { unavailableSources: ["Tokenomist"] }) }).tone, "unknown")
  assert.equal(analyze(positive, { feedError: true }).counts.positive, 0)
})

test("unlock pressure needs a matching coin, fresh retrieval, near event and valid denominator", () => {
  const result = analyze([unlock()])
  assert.equal(result.counts.negative, 1)
  assert.match(result.evidence[0].reason, /2\.00%/)
  assert.match(result.evidence[0].reason, /actual selling is unverified/)
  assert.equal(result.tone, "unknown") // A single schedule is insufficient support.
  for (const supply of [null, 0, NaN]) {
    assert.equal(analyze([unlock()], { coin: { ...coin, circulatingSupply: supply } }).counts.negative, 0)
  }
  assert.equal(analyze([unlock({ amount: 1 })]).counts.negative, 0)
  assert.equal(analyze([unlock({ checkedAt: at(-3 * 3_600_000) })]).counts.negative, 0)
  assert.equal(analyze([unlock({ date: at(9 * 86_400_000) })]).counts.negative, 0)
  assert.equal(analyze([unlock({ date: at(-86_400_000) })]).schedules, 0)
  assert.equal(analyze([unlock({ date: at(31 * 86_400_000) })]).schedules, 0)
  assert.equal(analyze([unlock({ amount: -20 })]).schedules, 0)
})

test("unlocks from other assets and missing schedules do not imply safety", () => {
  const other = unlock({ symbol: "ETH" }, { url: "https://tokenomist.ai/ethereum", topics: ["Ethereum", "ETH"], title: "Ethereum cliff unlock" })
  const result = analyze([other])
  assert.equal(result.schedules, 0)
  assert.equal(result.counts.negative, 0)
  assert.ok(result.gaps.some((text) => text.includes("does not establish that no unlock exists")))
})

test("old/future news and unsafe links are excluded; price changes never become signals", () => {
  const items = [
    article("Bitcoin ETF inflows", "https://coindesk.com/news/a", { publishedAt: at(-4 * 86_400_000) }),
    article("Bitcoin fund inflows", "https://decrypt.co/news/b", { publishedAt: at(86_400_000) }),
    article("Bitcoin exchange hacked", "https://example.com", { url: "javascript:alert(1)" }),
  ]
  const result = analyze(items, { coin: { ...coin, change24h: 100 } })
  assert.deepEqual(result.counts, { positive: 0, negative: 0, unknown: 1 })
  assert.equal(result.tone, "unknown")
})
