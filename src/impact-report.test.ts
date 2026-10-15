import { test } from "node:test"
import assert from "node:assert/strict"
import { buildImpactReport } from "./impact-report.ts"
import { analyzeCoinImpact } from "./coin-impact.ts"
import { impactInput } from "./impact-types.ts"
import type { FeedItem, FeedResponse, MarketCoin } from "./data-types"
import type { ImpactReview } from "./impact-types"

const now = Date.parse("2026-10-15T06:00:00Z")
const at = new Date(now).toISOString()
const coin: MarketCoin = { id: "bitcoin", symbol: "BTC", name: "Bitcoin", image: "", rank: 1, price: 1, marketCap: 1, change24h: 0, circulatingSupply: null, maxSupply: null, updatedAt: at }
const news = (id: string, title: string): FeedItem => ({ id, title, url: `https://coindesk.com/${id}`, source: "CoinDesk", publishedAt: at, kind: "News", topics: [] })
const items = [news("p", "Bitcoin ETF records inflows"), news("n", "Bitcoin fund records outflows"), news("u", "Bitcoin report lacks evidence"), news("waiting", "Bitcoin update awaits review"), news("other", "Ethereum ETF records inflows")]
const feed: FeedResponse = { items, fetchedAt: at, stale: false, unavailableSources: [] }
const rows = analyzeCoinImpact({ coin, feed, now }).evidence
const review: ImpactReview = { coinId: coin.id, model: "fixture", newlyReviewed: 0, labels: rows.filter(row => row.id !== "waiting").map(row => ({
  id: row.id, input: impactInput(coin.id, row), label: row.id === "n" ? "negative" : "positive",
  reason: `Reviewed impact for ${row.id}`, quote: row.title, basis: "headline", classifiedAt: at,
  verification: { id: row.id, input: "fixture", status: row.id === "u" ? "unverified" : "approved", reason: "Source match", checkedAt: at, impactReviewedAt: at,
    references: row.id === "u" ? [] : [{ url: row.url, title: row.title, source: row.source, quote: row.title, kind: "publisher", retrievedAt: at }] },
})) }

test("report only includes reviewed, supported, asset-scoped directions and preserves references", () => {
  const report = buildImpactReport(coin, feed, review, now, false)
  assert.deepEqual(report.positive.map(item => item.id), ["p"])
  assert.deepEqual(report.negative.map(item => item.id), ["n"])
  assert.equal(report.positive[0].reason, "Reviewed impact for p")
  assert.equal(report.positive[0].agent?.verification?.references[0].url, items[0].url)
  assert.equal(report.inconclusive, 1, "Unsupported directional claims remain inconclusive")
  assert.equal(report.pending, 1)
})

test("regeneration includes newly completed news and never mutates an earlier snapshot", () => {
  const first = buildImpactReport(coin, feed, review, now, false)
  const newItem = news("new", "Bitcoin custody opens to new clients")
  const nextFeed = { ...feed, items: [newItem, ...items] }
  const row = analyzeCoinImpact({ coin, feed: nextFeed, now }).evidence.find(item => item.id === newItem.id)!
  const updated: ImpactReview = { ...review, labels: [...review.labels, { ...review.labels[0], id: row.id, input: impactInput(coin.id, row), reason: "Newly reviewed demand channel" }] }
  const next = buildImpactReport(coin, nextFeed, updated, now + 1000, false)
  assert.equal(next.positive.length, 2)
  assert.equal(first.positive.length, 1)
  assert.notEqual(first.generatedAt, next.generatedAt)
})

test("stale data, mismatched classification, or missing source completion cannot enter report columns", () => {
  const stale = buildImpactReport(coin, { ...feed, stale: true }, review, now, false)
  assert.equal(stale.fresh, false)
  assert.equal(stale.positive.length + stale.negative.length, 0)
  assert.equal(buildImpactReport(coin, feed, review, now, true).positive.length, 0)
  const incomplete: ImpactReview = { ...review, labels: review.labels.map(label => ({ ...label, verification: undefined })) }
  assert.equal(buildImpactReport(coin, feed, incomplete, now, false).positive.length, 0)
  const changed = { ...feed, items: items.map(item => item.id === "p" ? { ...item, title: "Bitcoin reports changed evidence" } : item) }
  assert.equal(buildImpactReport(coin, changed, review, now, false).positive.length, 0)
  const wrongAsset = buildImpactReport(coin, feed, { ...review, coinId: "ethereum" }, now, false)
  assert.equal(wrongAsset.positive.length + wrongAsset.negative.length, 0)
})
