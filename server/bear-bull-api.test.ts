import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { createBearBullApi } from "./bear-bull-api.ts"
import type { AnalysisConfig, DebateContext } from "./bear-bull-engine.ts"

const source = "https://example.org/report"
const context: DebateContext = {
  coin: {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    priceUsd: 80_000,
    marketCapUsd: 1e12,
    circulatingSupply: 20e6,
    maxSupply: 21e6,
    providerUpdatedAt: "2026-10-15T06:00:00Z",
  },
  asOf: "2026-10-15T06:00:00Z",
  dataAt: "2026-10-15T06:00:00Z",
  feedAt: "2026-10-15T06:00:00Z",
  marketStale: false,
  feedStale: false,
  gaps: [],
  unavailableSources: [],
  evidence: [],
  coverage: "headlines only",
  sources: [{ url: source, title: "Market report", origin: "feed" }],
}
const config: AnalysisConfig = {
  apiKey: "test-only-credential",
  model: "gemini-2.5-flash",
  bullAgentId: "agent_bull",
  bearAgentId: "agent_bear",
}
async function server(options: Parameters<typeof createBearBullApi>[0]) {
  const api = createBearBullApi(options)
  const http = createServer((req, res) => {
    void api(req, res)
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()))
        http.closeAllConnections()
      }),
  }
}
function post(url: string, coinId = "bitcoin", extra: RequestInit = {}) {
  return fetch(`${url}/api/analysis`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coinId }),
    ...extra,
  })
}
function mockProvider(task: import("./eleven-agent.ts").AgentTask) {
 const side = task.agentId === config.bullAgentId ? "bull" : "bear"
 return task.kind === "submit_opening" ? {summary:"Research",claims:[{title:"Claim",argument:"Evidence",caveat:"Uncertain",source_urls:[source]}],gaps:[]}
 : {summary:"Response",replies:[{claim_id:`${side === "bull" ? "bear" : "bull"}-1`,position:"challenge",argument:"Alternative evidence",source_urls:[source]}]}
}
test("missing key is explicit, config never leaks it, and no provider request is made", async () => {
  let calls = 0
  const app = await server({
    getConfig: () => ({ ...config, apiKey: "" }),
    getContext: async () => context,
    fetcher: async () => {
      calls++
      throw new Error("not allowed")
    },
  })
  try {
    const status = await fetch(`${app.url}/api/analysis/config`).then(
      (response) => response.json(),
    )
    assert.deepEqual(status, {
      configured: false,
      model: "gemini-2.5-flash",
      reasoning: "agent-managed",
    })
    const response = await post(app.url)
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, "not_configured")
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})
test("same-origin and input guards prevent untrusted paid requests", async () => {
  let calls = 0
  const app = await server({
    getConfig: () => config,
    getContext: async () => {
      calls++
      return context
    },
  })
  try {
    assert.equal(
      (
        await post(app.url, "bitcoin", {
          headers: {
            "Content-Type": "application/json",
            Origin: "https://elsewhere.example",
          },
        })
      ).status,
      403,
    )
    assert.equal((await post(app.url, "../../private")).status, 400)
    assert.equal(
      (await post(app.url, "x", { headers: { "Content-Type": "text/plain" } }))
        .status,
      415,
    )
    assert.equal((await fetch(`${app.url}/api/analysis`)).status, 405)
    const safe = await fetch(`${app.url}/api/analysis/config`).then(
      (response) => response.text(),
    )
    assert.equal(safe.includes(config.apiKey), false)
    assert.equal(calls, 0)
  } finally {
    await app.close()
  }
})
test("complete report is cached with timestamp and no repeated provider cost", async () => {
  let calls = 0
  const registered: string[] = []
  const app = await server({
    getConfig: () => config,
    getContext: async () => context,
    onResult: (result) => registered.push(result.reportId),
    taskRunner: async (task) => {
      calls++
      return mockProvider(task)
    },
  })
  try {
    const events = (await (await post(app.url)).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    const first = events.find((event) => event.type === "result")
    assert.ok(first)
    assert.equal(first.cached, false)
    assert.equal(calls, 4)
    const second = await (await post(app.url)).text()
    const cached = JSON.parse(second)
    assert.equal(cached.cached, true)
    assert.equal(cached.result.createdAt, first.result.createdAt)
    assert.equal(calls, 4)
    assert.deepEqual(registered, [first.result.reportId, first.result.reportId])
    assert.equal((await post(app.url, "ethereum")).status, 429)
  } finally {
    await app.close()
  }
})
test("active jobs reject duplicates, and disconnect aborts both upstream requests", async () => {
  let started = 0
  let aborted = 0
  let ready: () => void
  let allAborted: () => void
  const startedBoth = new Promise<void>((resolve) => {
    ready = resolve
  })
  const stoppedBoth = new Promise<void>((resolve) => {
    allAborted = resolve
  })
  const app = await server({
    getConfig: () => config,
    getContext: async () => context,
    taskRunner: async (task) =>
      new Promise((_resolve, reject) => {
        started++
        if (started === 2) ready()
        task.signal.addEventListener(
          "abort",
          () => {
            aborted++
            if (aborted === 2) allAborted()
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      }),
  })
  try {
    const controller = new AbortController()
    const response = await post(app.url, "bitcoin", {
      signal: controller.signal,
    })
    await startedBoth
    assert.equal((await post(app.url)).status, 429)
    controller.abort()
    await assert.rejects(response.text(), { name: "AbortError" })
    await Promise.race([
      stoppedBoth,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("requests not aborted")), 2_000),
      ),
    ])
    assert.equal(aborted, 2)
  } finally {
    await app.close()
  }
})
test("provider failure streams a sanitized error without a completed result", async () => {
  const app = await server({
    getConfig: () => config,
    getContext: async () => context,
    fetcher: async () =>
      new Response("private-key-and-provider-body", { status: 401 }),
  })
  try {
    const text = await (await post(app.url)).text()
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(events.at(-1).type, "error")
    assert.equal(
      events.some((event) => event.type === "result"),
      false,
    )
    assert.equal(text.includes("private-key-and-provider-body"), false)
    assert.equal(text.includes(config.apiKey), false)
  } finally {
    await app.close()
  }
})
