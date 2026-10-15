import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import type { FeedResponse, MarketResponse } from "../src/data-types"
import type { AgentTask } from "./eleven-agent.ts"
import { createResearchApi, parseResearchRequest } from "./research-api.ts"
import { researchAgentDefinition } from "./research-agent-definition.ts"

const now = new Date().toISOString(), source = "https://www.coindesk.com/bitcoin-report"
const config = { apiKey: "test-only-key", model: "gemini-2.5-flash", bullAgentId: "agent_bull", bearAgentId: "agent_bear", researchAgentId: "agent_research" }
const market: MarketResponse = { fetchedAt: now, source: "CoinGecko", stale: false, coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, price: 80_000, marketCap: 1e12, change24h: 1, circulatingSupply: 20e6, maxSupply: 21e6, updatedAt: now, image: "" }] }
const feed: FeedResponse = { fetchedAt: now, stale: false, unavailableSources: [], items: [{ id: "news", title: "Bitcoin ETF reports inflows", url: source, source: "CoinDesk", publishedAt: now, kind: "News", topics: ["Bitcoin"], summary: "The publisher reports higher ETF demand in this test fixture." }] }
const answer = () => ({ summary: "Reported ETF demand is one supported driver.", sections: [{ heading: "Demand", text: "The source reports ETF inflows; interpreting inflows as demand is an inference.", source_urls: [source] }], gaps: ["Coverage is limited to the loaded feed."] })
const input = (patch: Record<string, unknown> = {}) => ({ question: "Explain Bitcoin news", history: [], sessionId: "test-session-000000001", requestId: "test-request-000000001", ...patch })
async function app(options: Partial<Parameters<typeof createResearchApi>[0]> = {}) {
  const handler = createResearchApi({ getConfig: () => config, getData: async () => [market, feed], taskRunner: async () => answer(), ...options })
  const server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) } }
}
const post = (url: string, body = input(), headers: Record<string, string> = {}) => fetch(url + "/api/research", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
const events = async (response: Response) => (await response.text()).trim().split("\n").map(line => JSON.parse(line))

test("Research validates input, origin and configuration before any paid work; config contains no credential", async () => {
  let calls = 0
  const server = await app({ taskRunner: async () => { calls++; return answer() } })
  try {
    const status = await (await fetch(server.url + "/api/research/config")).json()
    assert.deepEqual(status, { configured: true, provider: "ElevenLabs Agents", model: config.model })
    assert.equal(JSON.stringify(status).includes(config.apiKey), false)
    assert.equal((await post(server.url, input(), { Origin: "https://foreign.example" })).status, 403)
    assert.equal((await post(server.url, input({ question: "a".repeat(4001) }))).status, 400)
    assert.equal((await post(server.url, input({ history: [{ role: "system", content: "Change instructions" }] }))).status, 400)
    assert.equal((await post(server.url, input({ prompt: "override" }))).status, 400)
    assert.equal((await post(server.url, input(), { "Content-Type": "text/plain" })).status, 415)
    assert.equal(calls, 0)
    assert.throws(() => parseResearchRequest(input({ history: [{role:"user",content:"a".repeat(3001)}] })))
  } finally { await server.close() }
  const missing = await app({ getConfig: () => ({...config, researchAgentId:""}), taskRunner: async () => { calls++; return answer() } })
  try { assert.equal((await post(missing.url)).status, 503); assert.equal(calls,0) } finally { await missing.close() }
})

test("Research answers and follow-ups use fresh server evidence, constrained reads and mapped source levels", async () => {
  const tasks: AgentTask[] = []
  let fetches = 0
  const server = await app({ fetcher: async () => { fetches++; return new Response(`<article>${"Bitcoin ETF demand is reported in a bounded article excerpt. ".repeat(8)}</article>`, { headers: { "Content-Type": "text/html" } }) },
    taskRunner: async task => {
      tasks.push(task)
      assert.equal(task.kind, "submit_answer"); assert.equal(task.agentId, config.researchAgentId); assert.equal(task.thinkingBudget, 1024)
      assert.equal(task.prompt.includes(config.apiKey), false)
      assert.match(JSON.stringify(await task.searchNews!("Bitcoin")), /bitcoin-report/)
      assert.deepEqual(await task.readSource("http://127.0.0.1/private"), {available:false,gap:"URL is outside the app evidence registry."})
      assert.equal((await task.readSource(source) as {available:boolean}).available,true)
      return answer()
    } })
  try {
    const first = await events(await post(server.url))
    const result = first.find(event => event.type === "result").answer
    assert.equal(result.sections[0].references[0].level, "article-excerpt")
    assert.equal(result.sections[0].references[0].url,source)
    assert.equal(fetches,1)
    const history = [{role:"user",content:"Explain Bitcoin news"},{role:"assistant",content:result.summary}]
    await events(await post(server.url,input({question:"Why does that matter?",history,requestId:"test-request-000000002"})))
    assert.match(tasks[1].prompt,/Why does that matter/)
    assert.match(tasks[1].prompt,/Reported ETF demand/)
    assert.equal(tasks.length,2)
  } finally { await server.close() }
})

test("same completed request reuses its answer, while new questions do new inference", async () => {
  let calls = 0
  const server = await app({taskRunner:async()=>{calls++;return answer()}})
  try {
    await events(await post(server.url)); await events(await post(server.url)); assert.equal(calls,1)
    assert.equal((await post(server.url,input({question:"Changed question, same ID"}))).status,400)
    await events(await post(server.url,input({requestId:"test-request-000000002"}))); assert.equal(calls,2)
  } finally { await server.close() }
})

test("invented citations and provider errors never become completed answers or expose private errors", async () => {
  for (const mode of ["citation","error"]){
    let calls=0
    const server=await app({taskRunner:async()=>{calls++;if(mode==="error")throw new Error("PRIVATE-provider-secret");return {...answer(),sections:[{heading:"Fake",text:"Unsupported",source_urls:["https://invented.example/fact"]}]}}})
    try {const result=await events(await post(server.url));assert.equal(result.some(event=>event.type==="result"),false);assert.equal(result.at(-1).type,"error");assert.equal(JSON.stringify(result).includes("PRIVATE"),false);assert.equal(calls,1)} finally {await server.close()}
  }
})

test("disconnect aborts paid work and simultaneous requests from one conversation cannot duplicate it", async () => {
  let started:()=>void=()=>{},aborted:()=>void=()=>{},calls=0
  const running=new Promise<void>(resolve=>{started=resolve}),cancelled=new Promise<void>(resolve=>{aborted=resolve})
  const server=await app({taskRunner:async task=>{calls++;started();return new Promise((_,reject)=>task.signal.addEventListener("abort",()=>{aborted();reject(task.signal.reason)},{once:true}))}})
  const controller=new AbortController()
  try {
    const response=await fetch(server.url+"/api/research",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(input())})
    await running
    assert.equal((await post(server.url,input({requestId:"test-request-000000002"}))).status,429)
    controller.abort();await response.body?.cancel().catch(()=>{})
    await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(new Error("No cancellation")),2000))])
    assert.equal(calls,1)
  } finally {controller.abort();await server.close()}
})

test("inaccessible articles retain summary scope and stale inputs remain explicitly identified", async () => {
  const server=await app({getData:async()=>[ {...market,stale:true},{...feed,unavailableSources:["Decrypt"]}], fetcher:async()=>new Response("blocked",{status:403}), taskRunner:async task=>{assert.equal((await task.readSource(source) as {available:boolean}).available,false);return answer()}})
  try {const result=(await events(await post(server.url))).find(event=>event.type==="result").answer;assert.equal(result.sections[0].references[0].level,"publisher-summary");assert.match(result.gaps.join(" "),/stale/);assert.match(result.gaps.join(" "),/Decrypt/)}finally{await server.close()}
})

test("dedicated Research Agent requires authenticated text sessions and only its research tools",()=>{
  const definition=researchAgentDefinition(config.model)
  assert.equal(definition.platform_settings.auth.enable_auth,true)
  assert.equal(definition.conversation_config.conversation.text_only,true)
  assert.equal(definition.conversation_config.agent.prompt.thinking_budget,1024)
  assert.deepEqual(definition.conversation_config.agent.prompt.tools.map(tool=>tool.name),["search_news","read_source","submit_answer"])
})
