import type {
  FeedResponse,
  MarketCoin,
  MarketResponse,
} from "../src/data-types"
import type {
  DebateClaim,
  DebateEvent,
  DebateOpening,
  DebateReply,
  DebateResult,
  DebateSide,
  DebateSource,
} from "../src/bear-bull-types"
import { analyzeCoinImpact } from "../src/coin-impact.ts"
import { randomUUID } from "node:crypto"
import { createAgentRunner } from "./eleven-agent.ts"
import type { AgentsConfig, AgentTask } from "./eleven-agent.ts"
import { createEvidenceReader } from "./evidence-reader.ts"
export type AnalysisConfig = AgentsConfig

export class AnalysisError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}
type Json = Record<string, unknown>
const object = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const text = (value: unknown, max = 1_200) => {
  if (typeof value !== "string" || !value.trim())
    throw new AnalysisError(
      "invalid_output",
      "The agent returned an incomplete response. Please run the analysis again.",
    )
  return value.trim().slice(0, max)
}
export function sourceUrl(value: unknown) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null
    url.hash = ""
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
    return url.href
  } catch {
    return null
  }
}
export function buildDebateContext(
  coin: MarketCoin,
  market: MarketResponse,
  feed: FeedResponse,
  now = Date.now(),
) {
  const analysis = analyzeCoinImpact({
    coin,
    feed,
    now,
    marketStale: market.stale,
  })
  const relevant = analysis.evidence.map((row) => {
    const original = feed.items.find((item) => item.id === row.id)
    return {
      title: row.title,
      url: row.url,
      publisher: row.source,
      at: row.at,
      kind: row.scope,
      ...(original?.unlock ? { scheduledUnlock: original.unlock } : {}),
    }
  })
  const sources: DebateSource[] = relevant.map((item) => ({
    url: item.url,
    title: item.title,
    origin: "feed",
  }))
  return {
    coin: {
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      priceUsd: coin.price,
      marketCapUsd: coin.marketCap,
      circulatingSupply: coin.circulatingSupply,
      maxSupply: coin.maxSupply,
      providerUpdatedAt: coin.updatedAt,
    },
    asOf: new Date(now).toISOString(),
    dataAt: market.fetchedAt,
    feedAt: feed.fetchedAt,
    marketStale: !analysis.marketCurrent,
    feedStale: !analysis.feedCurrent,
    gaps: analysis.gaps,
    unavailableSources: feed.unavailableSources,
    evidence: relevant,
    sources,
    coverage:
      "Loaded publisher headlines from the last 72 hours; a partial sample of up to 25 upcoming cliff unlocks, not a complete unlock calendar. No TradingView data is extracted.",
  }
}
export type DebateContext = ReturnType<typeof buildDebateContext>
function citedSources(
  value: unknown,
  registry: Map<string, DebateSource>,
  required: boolean,
) {
  if (!Array.isArray(value) || value.length > 6)
    throw new AnalysisError(
      "invalid_citations",
      "The agent returned an invalid source list.",
    )
  const citations: DebateSource[] = []
  for (const raw of value) {
    const url = sourceUrl(raw)
    const source = url ? registry.get(url) : undefined
    if (!source)
      throw new AnalysisError(
        "unverified_citation",
        "The agent cited a URL outside the verified evidence. Analysis stopped.",
      )
    if (!citations.some((item) => item.url === source.url))
      citations.push(source)
  }
  if (required && !citations.length)
    throw new AnalysisError(
      "missing_citations",
      "The agent did not provide evidence for its claim. Analysis stopped.",
    )
  return citations
}
export function parseOpening(
  raw: unknown,
  side: DebateSide,
  registry: Map<string, DebateSource>,
): DebateOpening {
  const data = object(raw)
  if (
    !Array.isArray(data.claims) ||
    data.claims.length > 5 ||
    !Array.isArray(data.gaps) ||
    data.gaps.length > 6
  )
    throw new AnalysisError("invalid_output", "The agent returned invalid opening claims.")
  return {
    side,
    summary: text(data.summary),
    gaps: data.gaps.map((gap) => text(gap, 500)),
    claims: data.claims.map((entry, index) => {
      const item = object(entry)
      return {
        id: `${side}-${index + 1}`,
        title: text(item.title, 180),
        argument: text(item.argument),
        caveat: text(item.caveat, 700),
        sources: citedSources(item.source_urls, registry, true),
      }
    }),
  }
}
export function parseRebuttal(
  raw: unknown,
  opponent: DebateOpening,
  registry: Map<string, DebateSource>,
) {
  const data = object(raw)
  if (
    !Array.isArray(data.replies) ||
    data.replies.length !== opponent.claims.length
  )
    throw new AnalysisError(
      "incomplete_debate",
      "The agent has not addressed every opposing claim. The analysis remains incomplete.",
    )
  const remaining = new Set(opponent.claims.map((claim) => claim.id))
  const replies: DebateReply[] = data.replies.map((entry) => {
    const item = object(entry)
    const claimId = text(item.claim_id, 30)
    if (
      !remaining.delete(claimId) ||
      !["challenge", "concede", "uncertain"].includes(String(item.position))
    )
      throw new AnalysisError(
        "incomplete_debate",
        "A response is duplicated or does not match an opposing claim.",
      )
    return {
      claimId,
      position: item.position as DebateReply["position"],
      argument: text(item.argument),
      sources: citedSources(
        item.source_urls,
        registry,
        item.position !== "uncertain",
      ),
    }
  })
  return { summary: text(data.summary), replies }
}

export async function runDebate({config, context, signal, emit, fetcher = fetch, taskRunner}: {
  config: AnalysisConfig
  context: DebateContext
  signal: AbortSignal
  emit: (event: DebateEvent) => void
  fetcher?: typeof fetch
  taskRunner?: (task: AgentTask) => Promise<unknown>
}): Promise<DebateResult> {
  const registry = new Map(context.sources.map((source) => [sourceUrl(source.url)!, source]))
  const read = createEvidenceReader(registry, signal, fetcher)
  const excerpts = new Map<string, unknown>()
  const readSource = async (url: unknown) => {
    const result = await read(sourceUrl(url) ?? url)
    if (typeof url === "string") excerpts.set(url, result)
    return result
  }
  const run = taskRunner || createAgentRunner({fetcher})
  let requests = 0
  const sides: DebateSide[] = ["bull", "bear"]
  const shared = JSON.stringify(context)
  async function request(side: DebateSide, kind: AgentTask["kind"], prompt: string) {
    signal.throwIfAborted()
    requests++
    return run({config, agentId: side === "bull" ? config.bullAgentId : config.bearAgentId, kind, prompt, signal, readSource})
  }
  emit({type:"phase", phase:"research"})
  const initial = await Promise.all(sides.map(async side => {
    emit({type:"agent",side,task:"research",status:"running"})
    const raw = await request(side,"submit_opening",`You are ${side.toUpperCase()}. Research supported ${side === "bull" ? "positive drivers" : "downside risks"} for ${context.coin.name} (${context.coin.symbol}). Use read_source on relevant supplied article URLs before discussing their contents (at most 3 sources). No general web-search tool is available; state this scope. Return 0-5 supported claims, caveats and gaps using submit_opening, exactly once. Do not call submit_rebuttal. Bounded shared evidence and timestamps: ${shared}`)
    const opening = parseOpening(raw,side,registry)
    emit({type:"opening",opening})
    emit({type:"agent",side,task:"research",status:"done"})
    return opening
  }))
  const openings = Object.fromEntries(initial.map(item=>[item.side,item])) as Record<DebateSide,DebateOpening>
  emit({type:"phase",phase:"debate"})
  const responses = await Promise.all(sides.map(async side => {
    emit({type:"agent",side,task:"debate",status:"running"})
    const opponent = openings[side === "bull" ? "bear" : "bull"]
    const raw = opponent.claims.length ? await request(side,"submit_rebuttal",`You are ${side.toUpperCase()}. Cross-examine EVERY opponent claim exactly once by claim_id. Challenge, concede the specific claim, or state uncertainty. Use only the supplied sources; no new reading/search in this stage. Call submit_rebuttal exactly once; do not call submit_opening. Shared context: ${shared}\nBoth openings: ${JSON.stringify(openings)}\nRetrieved excerpts (may be partial/unavailable): ${JSON.stringify([...excerpts.values()])}\nAvailable sources: ${JSON.stringify([...registry.values()])}`) : {summary:"The other side has no supported claims to address.",replies:[]}
    const rebuttal = {side,...parseRebuttal(raw,opponent,registry)}
    emit({type:"rebuttal",rebuttal})
    emit({type:"agent",side,task:"debate",status:"done"})
    return rebuttal
  }))
  signal.throwIfAborted()
  return {reportId:randomUUID(),coinId:context.coin.id,coinName:context.coin.name,symbol:context.coin.symbol,model:config.model,reasoning:"agent-managed",createdAt:new Date().toISOString(),dataAt:context.dataAt,openings,
    rebuttals:Object.fromEntries(responses.map(item=>[item.side,item])) as DebateResult["rebuttals"],sources:[...registry.values()],gaps:[...context.gaps,"Research covers the loaded news and tokenomics feed and accessible article excerpts, not a general web search."],usage:{requests,inputTokens:null,outputTokens:null}}
}
