import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { createImpactApi } from "./impact-api.ts"

test("impact endpoint rejects foreign origins, arbitrary evidence, unknown assets and oversized input before paid work", async () => {
  let calls = 0
  const handler = createImpactApi({
    getConfig: () => ({ apiKey: "test-key", model: "gemini-2.5-flash", bullAgentId: "", bearAgentId: "" }),
    getData: async () => [{ coins: [], fetchedAt: new Date().toISOString(), stale: false, source: "CoinGecko" }, { items: [], fetchedAt: new Date().toISOString(), stale: false, unavailableSources: [] }],
    reviewer: async () => { calls++; throw new Error("should never run") },
  })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/impact/review`
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(url, { method: "PUT" })).status, 405)
    assert.equal((await fetch(url)).status, 400)
    assert.equal((await post({ coinId: "bitcoin" }, { Origin: "https://evil.example" })).status, 403)
    assert.equal((await post({ coinId: "bitcoin", evidence: "invented news" })).status, 400)
    assert.equal((await post({ coinId: "unknown" })).status, 400)
    assert.equal((await post({ coinId: "x".repeat(2000) })).status, 413)
    assert.equal(calls, 0)
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})
