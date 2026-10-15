import { test } from "node:test"
import assert from "node:assert/strict"
import type { FeedItem, FeedResponse, MarketCoin, MarketResponse } from "../src/data-types"
import type { ReviewStore } from "./impact-review"
import { createImpactReviewer } from "./impact-review.ts"
import { createSourceReviewService } from "./source-review-service.ts"
import { readNewsReviews, verificationKey } from "./news-verification.ts"

const config = { apiKey: "", model: "gemini-2.5-flash", bullAgentId: "", bearAgentId: "", impactAgentId: "agent_impact", referenceCheckConcurrency: 2 }
const at = () => new Date().toISOString()
const story = (id: number): FeedItem => ({ id: `story-${id}`, title: `Bitcoin ETF records inflows in report ${id}`, url: `https://decrypt.co/report-${id}`, source: "Decrypt", publishedAt: at(), kind: "News", topics: [] })
const feed = (items: FeedItem[]): FeedResponse => ({ items, fetchedAt: at(), stale: false, unavailableSources: [] })
function memory(): ReviewStore {
  const values = new Map<string, { value: unknown; until: number }>()
  return { async get(key) { const entry = values.get(key); return entry && entry.until > Date.now() ? entry.value : undefined }, async set(key, value, ttl) { values.set(key, { value, until: Date.now() + ttl * 1000 }) }, async delete(key) { values.delete(key) } }
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const signal = () => new AbortController().signal
const wait = async (condition: () => boolean) => { for (let i = 0; i < 100; i++) { if (condition()) return; await delay(5) } assert.fail("Condition did not complete") }

test("full-feed backfill checks older, unrelated and structured items with bounded workers and no AI key", async () => {
  const items = Array.from({ length: 18 }, (_, i) => story(i))
  items[3] = { ...items[3], title: "Ethereum research from an earlier month", publishedAt: "2026-09-01T00:00:00Z", source: "Tokenomist Research", url: "https://insights.unlocks.app/older" }
  items.push({ ...story(19), source: "Tokenomist", url: "https://tokenomist.ai/bitcoin", unlock: { amount: 10, valueUsd: null, symbol: "BTC", date: at(), checkedAt: at() } })
  const store = memory(); let reads = 0, active = 0, peak = 0
  const service = createSourceReviewService({ getConfig: () => config, store, getFeed: async () => feed(items), read: async url => {
    reads++; active++; peak = Math.max(peak, active)
    try { await delay(4); const item = items.find(item => item.url === url)!; return item.id === "story-7" ? { available: false } : { available: true, text: item.title } } finally { active-- }
  } })
  try {
    await service.runOnce()
    const status = await service.status()
    assert.equal(status.checked, 19); assert.equal(status.pending, 0); assert.equal(status.failed, 0)
    assert.equal(status.matched, 18); assert.equal(status.unverified, 1); assert.equal(peak, 2); assert.equal(reads, 18)
    const statuses = await readNewsReviews(feed(items), config, store)
    assert.equal(statuses.items[0].status, "source-checked")
    assert.equal(statuses.items[7].status, "unverified")
    assert.equal(statuses.items[18].method, "provider-data")
    assert.equal(statuses.items.some(item => item.impactReviewedAt), false, "HTTP checking does not masquerade as model analysis")
    await service.runOnce(); assert.equal(reads, 18, "Existing successes and failures use cache")
  } finally { await service.stop() }
})

test("queue, analyst and visitors share the same source check; leaving cannot cancel another consumer", async () => {
  const item = story(0), store = memory()
  let reads = 0, release!: () => void
  const service = createSourceReviewService({ getConfig: () => config, store, getFeed: async () => feed([item]), read: async () => { reads++; await new Promise<void>(resolve => { release = resolve }); return { available: true, text: item.title } } })
  const leaving = new AbortController()
  try {
    const background = service.runOnce()
    const first = service.check(item, leaving.signal)
    const second = service.check(item, signal())
    const rejected = assert.rejects(first, { name: "AbortError" })
    await wait(() => reads === 1)
    leaving.abort(); await rejected
    release()
    assert.equal((await second).status, "approved")
    await background; assert.equal(reads, 1)
    const restarted = createSourceReviewService({ getConfig: () => config, store, getFeed: async () => feed([item]), read: async () => { throw new Error("Must reuse shared source cache") } })
    try { assert.equal((await restarted.check(item, signal())).status, "approved") } finally { await restarted.stop() }
  } finally { await service.stop() }
})

test("changed story input is rechecked; source gating excludes failed news but retains it in the public feed", async () => {
  const items = [story(0), story(1)], store = memory(); let reads = 0
  const service = createSourceReviewService({ getConfig: () => config, store, getFeed: async () => feed(items), read: async url => { reads++; return url === items[0].url ? { available: true, text: items[0].title } : { available: false } } })
  try {
    const original = feed(items), checked = await service.verifiedFeed(original, signal())
    assert.deepEqual(checked.items.map(item => item.id), [items[0].id])
    assert.deepEqual(checked.sourceCoverage, { total: 2, supported: 1, excluded: 1 })
    assert.equal(original.items.length, 2)
    assert.equal(reads, 2)
    assert.equal((await service.check({ ...items[0], title: "Bitcoin report with changed details" }, signal())).status, "unverified")
    assert.equal(reads, 3)
    await assert.rejects(service.verifiedFeed({ ...original, stale: true }, signal()), /Fresh news/)
  } finally { await service.stop() }
})

test("background scan picks up new arrivals, reuses prior results, and stops with the server", async () => {
  const items = [story(0)]; let scans = 0, reads = 0
  const service = createSourceReviewService({ getConfig: () => config, store: memory(), intervalMs: 15, getFeed: async () => { scans++; return feed([...items]) }, read: async url => { reads++; return { available: true, text: items.find(item => item.url === url)!.title } } })
  service.start(); service.start()
  await wait(() => reads === 1)
  items.push(story(1))
  await wait(() => reads === 2)
  assert.ok(scans >= 2)
  await service.stop()
  const stopped = scans
  await delay(40)
  assert.equal(scans, stopped)
  assert.equal((await service.status()).enabled, false)
})

test("source errors do not become evidence verdicts or prevent remaining stories from completing", async () => {
  const items = [story(0), story(1), story(2)]
  const service = createSourceReviewService({ getConfig: () => config, store: memory(), getFeed: async () => feed(items), read: async url => { if (url === items[0].url) throw new Error("Source transport interrupted"); return { available: true, text: items.find(item => item.url === url)!.title } } })
  try { await service.runOnce(); const status = await service.status(); assert.equal(status.failed, 1); assert.equal(status.checked, 2); assert.equal(status.unverified, 0); assert.ok(status.error) } finally { await service.stop() }
})

test("stopping the queue aborts active reads and queued work without creating false verdicts", async () => {
  const items = Array.from({length:8}, (_,i)=>story(i)), store = memory(); let reads = 0
  const service = createSourceReviewService({ getConfig: () => config, store, getFeed: async () => feed(items), read: async (_, signal) => {
    reads++; return new Promise((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true}))
  } })
  service.start(); await wait(()=>reads===2); await service.stop()
  assert.equal(reads,2)
  for (const item of items) assert.equal(await store.get(verificationKey(config,item)),undefined)
})

test("asset inference starts only after shared source checks and never receives unsupported stories", async () => {
  const items=[story(0),story(1)], store=memory(), reviewed:string[]=[]
  const service=createSourceReviewService({getConfig:()=>config,store,getFeed:async()=>feed(items),read:async url=>url===items[0].url?{available:true,text:items[0].title}:{available:false}})
  const coin:MarketCoin={id:"bitcoin",name:"Bitcoin",symbol:"BTC",rank:1,image:"",price:1,marketCap:1,change24h:0,circulatingSupply:null,maxSupply:null,updatedAt:at()}
  const market:MarketResponse={coins:[coin],source:"CoinGecko",stale:false,fetchedAt:at()}
  const reviewer=createImpactReviewer({getConfig:()=>({...config,apiKey:"test-only"}),store,checkSource:service.check,runTask:async task=>{
    const supported=await store.get(verificationKey(config,items[0])) as {status:string}
    assert.equal(supported.status,"approved")
    assert.equal(task.prompt.includes(items[1].title),false)
    const inputs=JSON.parse(task.prompt.split("\n").at(-1)!) as {id:string;headline:string}[]
    reviewed.push(...inputs.map(item=>item.headline))
    return {labels:inputs.map(item=>({id:item.id,label:"positive",reason:"Reported fund inflows support demand in the supplied source.",basis:"headline",quote:item.headline}))}
  }})
  try {
    await service.runOnce()
    const result=await reviewer(coin,market,feed(items),signal())
    assert.deepEqual(reviewed,[items[0].title])
    assert.equal(result.labels.find(label=>label.id===items[1].id)?.label,"unknown")
    assert.equal((await readNewsReviews(feed(items),config,store)).items[0].status,"approved")
  } finally {await service.stop()}
})
