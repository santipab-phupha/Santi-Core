import { test } from "node:test"
import assert from "node:assert/strict"
import { mentionedCoins, researchMatches, supplySnapshots } from "./research.ts"
import type { MarketCoin, FeedItem } from "./data-types"
const coins = [
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC" },
  { id: "ethereum", name: "Ethereum", symbol: "ETH" },
] as MarketCoin[]
const items: FeedItem[] = [
  {
    id: "1",
    title: "Bitcoin demand grows",
    url: "https://example.com/1",
    source: "CoinDesk",
    publishedAt: "2026-10-14T05:00:00Z",
    kind: "News",
    topics: [],
  },
  {
    id: "2",
    title: "Ethereum supply falls",
    url: "https://example.com/2",
    source: "Decrypt",
    publishedAt: "2026-10-14T06:00:00Z",
    kind: "Tokenomics",
    topics: [],
  },
]
test("coin matching respects ticker boundaries and Thai aliases", () => {
  assert.equal(mentionedCoins("whether this matters", coins).length, 0)
  assert.equal(mentionedCoins("ETHข่าวล่าสุด", coins)[0].id, "ethereum")
  assert.equal(mentionedCoins("บิทคอยน์เป็นไง", coins)[0].id, "bitcoin")
})
test("research excludes unrelated stories and never substitutes news for missing supply evidence", () => {
  assert.deepEqual(
    researchMatches(
      "What is happening with Bitcoin?",
      coins,
      items,
    ).articles.map((item) => item.id),
    ["1"],
  )
  assert.equal(
    researchMatches("Bitcoin token unlocks", coins, items).articles.length,
    0,
  )
  assert.deepEqual(
    researchMatches("Token unlocks and supply", coins, items).articles.map(
      (item) => item.id,
    ),
    ["2"],
  )
  assert.equal(researchMatches("unobtainium", coins, items).articles.length, 0)
})
test("research from a headline keeps the clicked source first", () => {
  assert.equal(
    researchMatches(
      "Research this headline: Bitcoin demand grows",
      coins,
      items,
    ).articles[0].id,
    "1",
  )
})
test("Tokenomist research stays on the requested token even outside the top market coins", () => {
  const events: FeedItem[] = ["Cronos (CRO)", "Wormhole (W)"].map((name, i) => ({
    id: String(i), title: `${name} cliff unlock`,
    url: "https://tokenomist.ai/", source: "Tokenomist",
    publishedAt: "2026-10-14T05:00:00Z", kind: "Tokenomics", topics: [],
  }))
  assert.deepEqual(researchMatches("Research this headline: Cronos (CRO) cliff unlock", coins, events).articles.map(item => item.id), ["0"])
  assert.equal(researchMatches("Token unlocks and supply", coins, events).articles.length, 2)
})

test("supply snapshots preserve provider time and do not stand in for unlock schedules", () => {
  const coin = {
    ...coins[0],
    circulatingSupply: 20,
    maxSupply: null,
    updatedAt: "2026-10-15T05:00:00Z",
  } as MarketCoin
  const snapshots = supplySnapshots([coin])
  assert.equal(snapshots[0].snapshot?.maximum, null)
  assert.equal(snapshots[0].publishedAt, coin.updatedAt)
  assert.equal(snapshots[0].source, "CoinGecko")
  assert.equal(
    researchMatches("Bitcoin unlock schedule", [coin], snapshots).articles
      .length,
    0,
  )
  assert.equal(
    researchMatches("Bitcoin tokenomics", [coin], snapshots).articles.length,
    1,
  )
})
