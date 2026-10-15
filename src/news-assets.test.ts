import { test } from "node:test"
import assert from "node:assert/strict"
import { newsAssets } from "./news-assets.ts"
import type { MarketCoin, FeedItem } from "./data-types"
const coins = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC", image: "https://example.org/btc.png" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH", image: "https://example.org/eth.png" },
  { id: "near", name: "NEAR", symbol: "NEAR", image: "https://example.org/near.png" },
  { id: "chainlink", name: "Chainlink", symbol: "LINK", image: "https://example.org/link.png" },
] as MarketCoin[]
const story = (title: string, extra: Partial<FeedItem> = {}): FeedItem => ({
  id: "a", title, topics: [], source: "Example", url: "https://example.org/story", kind: "News", publishedAt: "2026-10-15T00:00:00Z", ...extra,
})
test("asset badges preserve multiple actual mentions and their provider logos", () => {
  assert.deepEqual(newsAssets(story("Bitcoin and ether ETF updates"), coins).map((coin) => coin.symbol), ["BTC", "ETH"])
  assert.equal(newsAssets(story("btc demand rises"), coins)[0].image, coins[0].image)
  assert.equal(newsAssets(story("อีเธอร์อัปเดตล่าสุด"), coins)[0].id, "ethereum")
  assert.deepEqual(newsAssets(story("Market update", { topics: ["Bitcoin"] }), coins).map((coin) => coin.id), ["bitcoin"])
})
test("broad headlines and ordinary words do not acquire invented coin associations", () => {
  assert.deepEqual(newsAssets(story("Inflation nears a peak; investors link concerns to rates"), coins), [])
  assert.deepEqual(newsAssets(story("Whether this matters to markets"), coins), [])
  assert.deepEqual(newsAssets(story("NEAR and LINK market update"), coins).map((coin) => coin.symbol), ["NEAR", "LINK"])
})
test("structured tokenomics tags use the exact asset, with a ticker fallback outside the loaded market", () => {
  const unlock = { symbol: "ARB", date: "2026-10-16T00:00:00Z", amount: 50, valueUsd: null, checkedAt: "2026-10-15T00:00:00Z" }
  const asset = newsAssets(story("Arbitrum cliff unlock", { topics: ["Arbitrum", "ARB"], kind: "Tokenomics", unlock }), coins)[0]
  assert.deepEqual(asset, { id: "symbol:ARB", name: "Arbitrum", symbol: "ARB", image: "" })
  const snapshot = { circulating: 20e6, maximum: 21e6, symbol: "BTC" }
  assert.equal(newsAssets(story("Supply snapshot", { snapshot }), coins)[0].id, "bitcoin")
})
