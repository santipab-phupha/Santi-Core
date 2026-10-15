import { test } from "node:test"
import assert from "node:assert/strict"
import { parseTokenomist, tokenomistClient } from "./tokenomist.ts"

const now = Date.now()
function fixture() {
  return {
    metadata: { queryDate: new Date(now).toISOString(), credit: { used: 42 } },
    status: true,
    data: [{
      tokenId: "sei-network", tokenName: "Sei", tokenSymbol: "SEI",
      upcomingEvent: {
        unlockDate: new Date(now + 86400000).toISOString(),
        latestUpdateDate: new Date(now - 86400000).toISOString(),
        cliffUnlocks: { totalCliffAmount: 55555556, totalCliffValue: 3460666 },
      },
    }],
  }
}

test("Tokenomist retains real schedule dates and amounts, excludes unsafe or past events", () => {
  const raw = fixture()
  const [item] = parseTokenomist(raw, now)
  assert.equal(item.source, "Tokenomist")
  assert.equal(item.kind, "Tokenomics")
  assert.equal(item.unlock?.amount, 55555556)
  assert.equal(item.unlock?.date, raw.data[0].upcomingEvent.unlockDate)
  assert.equal(item.publishedAt, raw.data[0].upcomingEvent.latestUpdateDate)
  assert.ok(!JSON.stringify(item).includes("credit"))
  raw.data[0].tokenId = "../profile"
  assert.deepEqual(parseTokenomist(raw, now), [])
  raw.data[0].tokenId = "sei-network"
  raw.data[0].upcomingEvent.unlockDate = new Date(now - 1000).toISOString()
  assert.deepEqual(parseTokenomist(raw, now), [])
  assert.throws(() => parseTokenomist({ status: false, data: [] }))
})

test("Tokenomist uses server header, shares hourly requests and backs off without exposing provider errors", async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now
  let calls = 0, time = now, fail = false
  globalThis.fetch = async (url, init) => {
    calls++
    assert.equal(new URL(String(url)).origin, "https://api.tokenomist.ai")
    assert.equal(new Headers(init?.headers).get("x-api-key"), "test-only-secret")
    assert.equal(init?.redirect, "error")
    return fail ? new Response("provider-secret-error", { status: 401 })
      : Response.json(fixture())
  }
  Date.now = () => time
  try {
    const client = tokenomistClient(() => "test-only-secret")
    const [a, b] = await Promise.all([client.load(), client.load()])
    assert.deepEqual(a, b)
    await client.load()
    assert.equal(calls, 1)
    assert.equal(client.status().state, "connected")
    assert.ok(!JSON.stringify(client.status()).includes("test-only-secret"))
    time += 3600001
    fail = true
    assert.equal((await client.load()).stale, true)
    await client.load()
    assert.equal(calls, 2)
    assert.equal(client.status().state, "unavailable")
    const unavailable = tokenomistClient(() => "test-only-secret")
    await assert.rejects(unavailable.load(), { message: "Tokenomist unavailable" })
    const empty = tokenomistClient(() => "")
    assert.deepEqual(await empty.load(), { items: [], stale: false })
    assert.equal(empty.status().state, "not_configured")
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})
