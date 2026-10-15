import { test } from "node:test"
import assert from "node:assert/strict"
import { readNewsReviews, verificationKey } from "./news-verification.ts"
import { createOriginalSourceChecker, matchingSourceQuote } from "./original-source-checker.ts"
import { validateClassifications } from "./impact-review.ts"
import { reviewedEvidence } from "../src/impact-types.ts"
import type { FeedItem } from "../src/data-types"
import type { ReviewStore } from "./impact-review"

const at = () => new Date().toISOString()
const config = { apiKey: "test-only", model: "gemini-2.5-flash", bullAgentId: "", bearAgentId: "" }
const item = (patch: Partial<FeedItem> = {}): FeedItem => ({ id: "https://coindesk.com/news/etf", url: "https://coindesk.com/news/etf", title: "Bitcoin ETF records inflows", source: "CoinDesk", kind: "News", topics: [], publishedAt: at(), ...patch })
function memory(): ReviewStore {
  const values = new Map<string, unknown>()
  return { async get(key) { return values.get(key) }, async set(key, value) { values.set(key, value) }, async delete(key) { values.delete(key) } }
}
const signal = () => new AbortController().signal

test("reference worker matches actual original-link text, not an HTTP status or an RSS fallback", async () => {
  const story = item({ summary: "The publisher RSS summary describes reported ETF inflows in a complete sentence." })
  const store = memory(); const urls: unknown[] = []
  const check = createOriginalSourceChecker({ config, store, signal: signal(), read: async url => { urls.push(url); return { available: true, text: `${story.title}. Additional publisher article content.` } } })
  const good = await check(story)
  assert.equal(good.status, "approved"); assert.equal(good.method, "original-link-match")
  assert.equal(good.references[0].url, story.url); assert.equal(good.references[0].quote, story.title)
  assert.ok(good.excerpt.includes(good.references[0].quote))
  assert.deepEqual(urls, [story.url])
  const mismatch = createOriginalSourceChecker({ config, store: memory(), signal: signal(), read: async () => ({ available: true, text: "Access denied. Generic page with no matching news text." }) })
  assert.equal((await mismatch(story)).status, "unverified")
  const blocked = createOriginalSourceChecker({ config, store: memory(), signal: signal(), read: async () => ({ available: false }) })
  assert.equal((await blocked(story)).status, "unverified", "RSS text alone cannot approve an inaccessible original link")
  assert.equal(matchingSourceQuote("Unrelated Bitcoin mention with different details", story), null)
})

test("reference results are reused across models and assets, while changed news and explicit failures are rechecked", async () => {
  const store = memory(), story = item(); let reads = 0
  const read = async () => { reads++; return { available: true, text: story.title } }
  const check = createOriginalSourceChecker({ config, store, signal: signal(), read })
  await check(story)
  await createOriginalSourceChecker({ config: { ...config, model: "gemini-other", impactThinkingBudget: 2048 }, store, signal: signal(), read })(story)
  assert.equal(reads, 1)
  const changed = { ...story, title: "Bitcoin ETF records outflows" }
  assert.equal((await check(changed)).status, "unverified"); assert.equal(reads, 2)
  await check(changed, true); assert.equal(reads, 3)
  await check(story, true); assert.equal(reads, 3, "A pending impact retry reuses a successful source check")
})

test("unsafe original URLs are rejected without network access", async () => {
  let reads = 0
  const check = createOriginalSourceChecker({ config, store: memory(), signal: signal(), read: async () => { reads++; throw new Error("Must not fetch") } })
  for (const url of ["https://localhost/private", "https://user:secret@coindesk.com/private", "http://coindesk.com/news", "https://evil.example/news"]) {
    assert.equal((await check(item({ url, id: url }))).status, "unverified")
  }
  assert.equal(reads, 0)
})

test("reader fixes retry old unsupported checks while preserving successful evidence and AI completion", async () => {
  const store=memory(),story=item();let reads=0
  const key=verificationKey(config,story)
  const check=createOriginalSourceChecker({config,store,signal:signal(),read:async()=>{reads++;return {available:true,text:story.title}}})
  const matched=await check(story)
  await store.set(key,{...matched,status:"unverified",references:[],readerVersion:1},1800)
  assert.equal((await check(story)).status,"approved");assert.equal(reads,2)
  await store.set(key,{...matched,readerVersion:1,impactReviewedAt:at()},1800)
  assert.ok((await check(story)).impactReviewedAt);assert.equal(reads,2)
})

test("reference queue bounds simultaneous HTTP reads and aborts queued work", async () => {
  const controller = new AbortController(), waits: (() => void)[] = []
  let active = 0, peak = 0, reads = 0
  const check = createOriginalSourceChecker({ config: { ...config, referenceCheckConcurrency: 2 }, store: memory(), signal: controller.signal,
    read: async () => {
      reads++; active++; peak = Math.max(peak, active)
      try { return await new Promise((resolve, reject) => {
        const abort = () => reject(controller.signal.reason)
        controller.signal.addEventListener("abort", abort, { once: true })
        waits.push(() => { controller.signal.removeEventListener("abort", abort); resolve({ available: false }) })
      }) } finally { active-- }
    },
  })
  const jobs = Array.from({ length: 5 }, (_, index) => check(item({ id: `story-${index}`, url: `https://coindesk.com/news/${index}` })))
  const done = Promise.allSettled(jobs)
  const turn = () => new Promise<void>(resolve => setImmediate(resolve))
  for (let i = 0; i < 50 && reads < 2; i++) await turn()
  assert.equal(reads, 2); assert.equal(peak, 2)
  waits[0]()
  for (let i = 0; i < 50 && reads < 3; i++) await turn()
  assert.equal(reads, 3)
  controller.abort()
  const results = await done
  assert.equal(reads, 3); assert.equal(active, 0)
  assert.equal(results.filter(value => value.status === "rejected").length, 4)
})

test("unsupported originals stay visible as Inconclusive regardless of a supplied directional label", async () => {
  const story = item()
  const source = await createOriginalSourceChecker({ config, store: memory(), signal: signal(), read: async () => ({ available: false }) })(story)
  const row = { id: story.id, title: story.title, url: story.url, source: story.source, domain: "coindesk.com", at: story.publishedAt, scope: "coin" as const, tone: "positive" as const, reason: "Reported inflows" }
  for (const label of ["positive", "neutral"]) {
    const labels = validateClassifications({ labels: [{ id: story.id, label, reason: "The headline reports demand from ETF flows.", quote: story.title, basis: "headline" }] },
      [{ row, item: story, source, excerpt: "", structured: "" }], "bitcoin")
    assert.equal(labels[0].label, "unknown")
    const result = reviewedEvidence("bitcoin", [row], { coinId: "bitcoin", model: "test-model", labels, newlyReviewed: 1 }, true)
    assert.deepEqual(result.counts, { positive: 0, negative: 0, unknown: 1 }); assert.equal(result.evidence.length, 1)
    assert.match(result.evidence[0].reason, /No supporting evidence/)
  }
})

test("source match and AI completion are separate states; source-only results are not prematurely Approved", async () => {
  const store = memory(), story = item(), feed = { items: [story], fetchedAt: at(), stale: false, unavailableSources: [] }
  const key = verificationKey(config, story)
  assert.equal((await readNewsReviews(feed, config, store)).items[0].status, "pending")
  const source = await createOriginalSourceChecker({ config, store, signal: signal(), read: async () => ({ available: true, text: story.title }) })(story)
  const beforeAI = (await readNewsReviews(feed, config, store)).items[0]
  assert.equal(beforeAI.status, "source-checked"); assert.equal(beforeAI.references.length, 1)
  assert.equal("excerpt" in beforeAI, false, "Internal model context is not repeated in the public status feed")
  await store.set(`${key}:job:processing`, { expires: Date.now() + 10_000 }, 10)
  assert.equal((await readNewsReviews(feed, config, store)).items[0].status, "processing")
  await store.delete(`${key}:job:processing`)
  await store.set(`${key}:job:error`, true, 60)
  assert.equal((await readNewsReviews(feed, config, store)).items[0].status, "error")
  await store.delete(`${key}:job:error`)
  await store.set(key, { ...source, impactReviewedAt: at() }, 60)
  assert.equal((await readNewsReviews(feed, config, store)).items[0].status, "approved")
  const changed = { ...feed, items: [{ ...story, title: "Bitcoin ETF reverses inflows" }] }
  assert.equal((await readNewsReviews(changed, config, store)).items[0].status, "pending")
  assert.notEqual((await readNewsReviews({ ...feed, stale: true }, config, store)).items[0].status, "approved")
})
