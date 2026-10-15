import { test } from "node:test"
import assert from "node:assert/strict"
import { parseFeed, plainText, workspaceApi, createWorkspaceHandler } from "./workspace-api.ts"

test("RSS preserves dates and publishers, labels tokenomics and rejects unsafe links", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[ARB &amp; token unlock]]></title><link>https://example.com/arb</link><pubDate>Wed, 14 Oct 2026 06:00:00 GMT</pubDate><description>Vesting schedule</description></item>
    <item><title>Bitcoin market update</title><link>https://example.com/btc</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate></item>
    <item><title>Unsafe URL</title><link>javascript:alert(1)</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate></item>
    <item><title>Missing date</title><link>https://example.com/no-date</link></item>
    <item><title>Future item</title><link>https://example.com/future</link><pubDate>Fri, 14 Oct 2099 07:00:00 GMT</pubDate></item>
    <item><title>Bank unlocks direct trading</title><link>https://example.com/bank</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate></item>
  </channel></rss>`
  const items = parseFeed(xml, "CoinDesk")
  assert.equal(items.length, 3)
  assert.equal(items[0].title, "ARB & token unlock")
  assert.equal(items[0].kind, "Tokenomics")
  assert.equal(items[0].source, "CoinDesk")
  assert.equal(items[0].publishedAt, "2026-10-14T06:00:00.000Z")
  assert.equal(items[1].kind, "News")
  assert.equal(items[2].kind, "News")
})
test("Decrypt filters unrelated technology stories and keeps crypto coverage", () => {
  const xml =
    "<rss><channel><item><title>New AI image model</title><link>https://example.com/ai</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate><category>AI</category></item><item><title>Bitcoin wallets grow</title><link>https://example.com/btc</link><pubDate>Wed, 14 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>"
  assert.deepEqual(
    parseFeed(xml, "Decrypt").map((item) => item.title),
    ["Bitcoin wallets grow"],
  )
})

test("Tokenomist Research articles retain publisher dates and links, including new items without duplication", () => {
  const item = (title: string, link: string, at: string) => `<item><title>${title}</title><link>${link}</link><pubDate>${at}</pubDate></item>`
  const first = item("Tokenomics research", "https://insights.unlocks.app/research-a/", "Wed, 14 Oct 2026 06:00:00 GMT")
  const next = item("Governance update", "https://insights.unlocks.app/research-b/", "Wed, 14 Oct 2026 07:00:00 GMT")
  const initial = parseFeed(`<rss><channel>${first}</channel></rss>`, "Tokenomist Research")
  const updated = parseFeed(`<rss><channel>${next}${first}</channel></rss>`, "Tokenomist Research")
  assert.equal(initial.length, 1)
  assert.equal(updated.length, 2)
  assert.equal(updated[0].source, "Tokenomist Research")
  assert.equal(updated[0].kind, "Tokenomics")
  assert.equal(updated[0].publishedAt, "2026-10-14T07:00:00.000Z")
  assert.equal(updated[0].url, "https://insights.unlocks.app/research-b/")
  assert.equal(updated.filter((entry) => entry.id === initial[0].id).length, 1)
})
test("text sanitization strips markup without expanding unknown entities", () => {
  assert.equal(
    plainText("<b>Supply</b> &amp; &#39;vesting&#39;"),
    "Supply & 'vesting'",
  )
  assert.equal(plainText("&unknown; &#999999999;"), "&unknown; &#999999999;")
})
test("API cache shares in-flight requests and returns clearly marked stale data on failure", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow(),
    calls = 0,
    fail = false
  Date.now = () => now
  globalThis.fetch = async () => {
    calls++
    if (fail) throw new Error("offline")
    return new Response(
      JSON.stringify([
        {
          id: "bitcoin",
          name: "Bitcoin",
          symbol: "btc",
          current_price: 1,
          market_cap: 100,
          market_cap_rank: 1,
          last_updated: "2026-10-15T05:00:00Z",
        },
      ]),
    )
  }
  try {
    const plugin = workspaceApi()
    let middleware: (req: unknown, res: unknown, next: () => void) => void
    const install = plugin.configureServer as (server: unknown) => void
    install({
      middlewares: {
        use(fn: typeof middleware) {
          middleware = fn
        },
      },
    })
    const get = () =>
      new Promise<Record<string, unknown>>((resolve) =>
        middleware(
          { url: "/api/market", method: "GET" },
          {
            setHeader() {},
            end(value: string) {
              resolve(JSON.parse(value))
            },
          },
          () => assert.fail("API should handle route"),
        ),
      )
    const [first, second] = await Promise.all([get(), get()])
    assert.equal(calls, 1)
    assert.deepEqual(first, second)
    assert.equal(first.stale, false)
    now += 61_000
    fail = true
    const stale = await get()
    assert.equal(stale.stale, true)
    assert.equal(stale.fetchedAt, first.fetchedAt)
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})

test("one-minute feed checks share requests, bring in new Tokenomist articles and identify source failures", async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const inheritedKey = process.env.TOKENOMIST_API_KEY
  let now = Date.parse("2026-10-15T06:00:00Z")
  let calls = 0
  let tokenomistCalls = 0
  let version = 1
  let unavailable = false
  Date.now = () => now
  delete process.env.TOKENOMIST_API_KEY
  const old = `<item><title>Tokenomics research A</title><link>https://insights.unlocks.app/a/</link><pubDate>Wed, 14 Oct 2026 06:00:00 GMT</pubDate></item>`
  const recent = `<item><title>Tokenomics research B</title><link>https://insights.unlocks.app/b/</link><pubDate>Thu, 15 Oct 2026 05:00:00 GMT</pubDate></item>`
  globalThis.fetch = async (url) => {
    calls++
    const target = new URL(String(url))
    assert.notEqual(target.hostname, "api.tokenomist.ai", "RSS refresh must not use paid API calls")
    if (target.hostname === "insights.unlocks.app") {
      tokenomistCalls++
      if (unavailable) throw new Error("temporary source failure")
      return new Response(`<rss><channel>${version === 2 ? recent : ""}${old}${old}</channel></rss>`)
    }
    return new Response(`<rss><channel><item><title>Bitcoin update ${target.hostname}</title><link>https://${target.hostname}/article</link><pubDate>Wed, 14 Oct 2026 06:00:00 GMT</pubDate></item></channel></rss>`)
  }
  try {
    const plugin = workspaceApi()
    // A fixture root without any local credentials keeps this test isolated.
    ;(plugin.configResolved as (config: unknown) => void)({ root: `${process.cwd()}/test-fixtures-no-credentials` })
    let middleware!: (req: unknown, res: unknown, next: () => void) => void
    ;(plugin.configureServer as (server: unknown) => void)({ middlewares: { use(fn: typeof middleware) { middleware = fn } } })
    const get = () => new Promise<any>((resolve) => middleware({ url: "/api/feed", method: "GET" }, {
      setHeader() {}, end(value: string) { resolve(JSON.parse(value)) },
    }, () => assert.fail("API should handle the feed")))
    const [first, shared] = await Promise.all([get(), get()])
    assert.deepEqual(first, shared)
    assert.equal(calls, 4)
    assert.equal(tokenomistCalls, 1)
    assert.equal(first.items.filter((item: any) => item.source === "Tokenomist Research").length, 1)
    now += 59_000
    await get()
    assert.equal(calls, 4)
    now += 1_001
    version = 2
    const next = await get()
    const articles = next.items.filter((item: any) => item.source === "Tokenomist Research")
    assert.equal(calls, 8)
    assert.equal(tokenomistCalls, 2)
    assert.deepEqual(articles.map((item: any) => item.id), ["https://insights.unlocks.app/b/", "https://insights.unlocks.app/a/"])
    assert.equal(articles[1].publishedAt, first.items.find((item: any) => item.source === "Tokenomist Research").publishedAt)
    now += 60_001
    unavailable = true
    const partial = await get()
    assert.ok(partial.unavailableSources.includes("Tokenomist Research"))
    assert.ok(partial.items.some((item: any) => item.source === "CoinDesk"))
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
    if (inheritedKey === undefined) delete process.env.TOKENOMIST_API_KEY
    else process.env.TOKENOMIST_API_KEY = inheritedKey
  }
})


test("serverless handler awaits completion and unknown routes end with 404", async () => {
  const originalFetch = globalThis.fetch
  let release!: () => void
  let finished = false
  globalThis.fetch = async () => { await new Promise<void>((resolve) => { release = resolve }); return Response.json([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 1, market_cap: 100, market_cap_rank: 1 }]) }
  try {
    const handler = createWorkspaceHandler(`${process.cwd()}/test-fixtures-no-credentials`)
    const response: any = { setHeader() {}, end() { finished = true } }
    const pending = handler({ url: "/api/market", method: "GET" } as any, response)
    assert.equal(finished, false)
    release()
    await pending
    assert.equal(finished, true)
    finished = false
    await handler({ url: "/api/missing", method: "GET" } as any, response)
    assert.equal(response.statusCode, 404)
    assert.equal(finished, true)
  } finally { globalThis.fetch = originalFetch }
})
