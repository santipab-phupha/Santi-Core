import type { Plugin, Connect } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import { XMLParser } from "fast-xml-parser"
import { elevenlabsConfig, agentsConfig, tokenomistKey } from "./local-env.ts"
import { createAudioApi } from "./audio-api.ts"
import { createBearBullApi } from "./bear-bull-api.ts"
import { AnalysisError, buildDebateContext } from "./bear-bull-engine.ts"
import { tokenomistClient } from "./tokenomist.ts"
import { createImpactApi } from "./impact-api.ts"
import type {
  FeedItem,
  FeedResponse,
  MarketCoin,
  MarketResponse,
} from "../src/data-types"

const sources = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "Tokenomist Research", url: "https://insights.unlocks.app/rss/" },
]
const marketUrl =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false"
const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: false,
})
const tokenomicsPattern =
  /\b(tokenomics|vesting|circulating supply|token supply|token burns?|burns? tokens?|token issuance|stablecoin issuance|token allocation|token emissions?|airdrops?|token buybacks?|token unlocks?|unlock schedules?|unlocks? \d[\d.,]*\s*(?:million|billion|tokens?))\b/i
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  "#x27": "'",
}
export function plainText(value: unknown): string {
  const raw =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)["#text"]
      : value
  return String(raw ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&([#\w]+);/g, (full, entity: string) => {
      if (entities[entity]) return entities[entity]
      if (/^#(?:x[\da-f]+|\d+)$/i.test(entity)) {
        const code =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10)
        if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))
          return String.fromCodePoint(code)
      }
      return full
    })
    .replace(/\s+/g, " ")
    .trim()
}
function safeUrl(value: unknown): string | null {
  try {
    const url = new URL(plainText(value))
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}
export function parseFeed(xml: string, source: string): FeedItem[] {
  const parsed = parser.parse(xml)
  const entries = parsed?.rss?.channel?.item
  if (!entries) throw new Error("Invalid RSS feed")
  return (Array.isArray(entries) ? entries : [entries])
    .flatMap((item: Record<string, unknown>) => {
      const title = plainText(item.title)
      const url = safeUrl(item.link)
      const date = new Date(plainText(item.pubDate))
      if (
        !title ||
        !url ||
        !Number.isFinite(date.getTime()) ||
        date.getTime() > Date.now() + 300_000
      )
        return []
      const categories = (
        Array.isArray(item.category) ? item.category : [item.category]
      )
        .map(plainText)
        .filter(Boolean)
      if (
        source === "Decrypt" &&
        !/crypto|bitcoin|ethereum|blockchain|tokens?|web3|stablecoins?|wallet|defi|\bbtc\b|\beth\b|solana|\bxrp\b|binance|coinbase|\bnfts?\b/i.test(
          `${title} ${categories.join(" ")}`,
        )
      )
        return []
      // This is a topic label; the publisher remains the attributed source.
      const kind = source === "Tokenomist Research" || tokenomicsPattern.test(
        `${title} ${categories.join(" ")} ${plainText(item.description)}`,
      )
        ? "Tokenomics"
        : "News"
      return [
        {
          id: url,
          title: title.slice(0, 300),
          url,
          source,
          publishedAt: date.toISOString(),
          kind,
          topics: categories.slice(0, 3),
        } satisfies FeedItem,
      ]
    })
    .slice(0, 25)
}
async function fetchUpstream(url: string): Promise<Response> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      "User-Agent": "SantiCore/1.0 (local research workspace)",
      Accept: "application/json, application/xml, text/xml",
    },
  })
  if (!response.ok) throw new Error(`Upstream status ${response.status}`)
  return response
}
function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
async function loadMarket(): Promise<MarketResponse> {
  const raw: unknown = await (await fetchUpstream(marketUrl)).json()
  if (!Array.isArray(raw)) throw new Error("Invalid market response")
  const coins: MarketCoin[] = raw
    .flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return []
      const coin = value as Record<string, unknown>
      const price = nullableNumber(coin.current_price),
        marketCap = nullableNumber(coin.market_cap)
      if (
        typeof coin.id !== "string" ||
        typeof coin.name !== "string" ||
        typeof coin.symbol !== "string" ||
        price === null ||
        price < 0 ||
        marketCap === null ||
        marketCap <= 0 ||
        !Number.isInteger(coin.market_cap_rank) ||
        Number(coin.market_cap_rank) < 1 ||
        !Number.isFinite(Date.parse(String(coin.last_updated)))
      )
        return []
      return [
        {
          id: coin.id,
          name: coin.name,
          symbol: coin.symbol.toUpperCase(),
          image: safeUrl(coin.image) ?? "",
          rank: Number(coin.market_cap_rank),
          price,
          marketCap,
          change24h: nullableNumber(coin.price_change_percentage_24h),
          circulatingSupply: nullableNumber(coin.circulating_supply),
          maxSupply: nullableNumber(coin.max_supply),
          updatedAt: String(coin.last_updated),
        },
      ]
    })
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 10)
  if (!coins.length) throw new Error("No market data")
  return {
    coins,
    fetchedAt: new Date().toISOString(),
    stale: false,
    source: "CoinGecko",
  }
}
async function loadFeed(tokenomist: ReturnType<typeof tokenomistClient>): Promise<FeedResponse> {
  let tokenomistStale = false
  const results = await Promise.allSettled(
    [...sources.map(async (source) =>
      parseFeed(await (await fetchUpstream(source.url)).text(), source.name),
    ), tokenomist.load().then((data) => {
      tokenomistStale = data.stale
      return data.items.filter((item) => !item.unlock || Date.parse(item.unlock.date) >= Date.now())
    })],
  )
  const seen = new Set<string>()
  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((item) => {
      const key = item.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  if (!items.length) throw new Error("No news sources available")
  return {
    items,
    fetchedAt: new Date().toISOString(),
    stale: false,
    unavailableSources: [...sources, { name: "Tokenomist" }]
      .filter((_, i) => results[i].status === "rejected" || (i === sources.length && tokenomistStale))
      .map((source) => source.name),
  }
}
type CacheEntry = {
  data?: MarketResponse | FeedResponse
  expires: number
  pending?: Promise<MarketResponse | FeedResponse>
}
export function createWorkspaceHandler(root = process.cwd()) {
  const tokenomist = tokenomistClient(() => tokenomistKey(root))
  const cache = new Map<string, CacheEntry>()
  async function getData(key: string) {
    let entry = cache.get(key)
    if (!entry) {
      entry = { expires: 0 }
      cache.set(key, entry)
    }
    if (entry.data && Date.now() < entry.expires) return entry.data
    if (entry.pending) return entry.pending
    const current = entry
    current.pending = (key === "/api/market" ? loadMarket() : loadFeed(tokenomist))
      .then((data) => {
        current.data = data
        current.expires =
          Date.now() + 60_000
        return data
      })
      .catch((error) => {
        if (current.data) {
          current.expires = Date.now() + 15_000
          current.data = { ...current.data, stale: true }
          return current.data
        }
        throw error
      })
      .finally(() => {
        current.pending = undefined
      })
    return current.pending
  }
  const audioApi = createAudioApi({ getConfig: () => elevenlabsConfig(root) })
  const impactApi = createImpactApi({ getConfig: () => agentsConfig(root),
    getData: async () => await Promise.all([getData("/api/market"), getData("/api/feed")]) as [MarketResponse, FeedResponse],
  })
  const analysisApi = createBearBullApi({
    getConfig: () => agentsConfig(root),
    onResult: audioApi.register,
    async getContext(coinId) {
      const [market, feed] = await Promise.all([getData("/api/market"), getData("/api/feed")]) as [MarketResponse, FeedResponse]
      const coin = market.coins.find((item) => item.id === coinId)
      if (!coin) throw new AnalysisError("unknown_coin", "This asset was not found in the loaded market list. Refresh and select it again.", 400)
      return buildDebateContext(coin, market, feed)
    },
  })
  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void = () => { res.statusCode = 404; res.end("Not found") }) {
    const route = req.url?.split("?")[0] ?? ""
    if (route === "/api/impact/review") { await impactApi(req, res); return }
    if (route.startsWith("/api/audio/")) { await audioApi.handle(req, res); return }
    if (route === "/api/analysis" || route === "/api/analysis/config") {
      await analysisApi(req, res)
      return
    }
    if (route === "/api/tokenomist/status") {
      res.setHeader("Content-Type", "application/json; charset=utf-8")
      res.setHeader("Cache-Control", "no-store")
      if (req.method !== "GET") {
        res.statusCode = 405
        res.setHeader("Allow", "GET")
        res.end(JSON.stringify({ error: "GET required" }))
        return
      }
      try {
        res.end(JSON.stringify(tokenomist.status()))
      } catch {
        res.statusCode = 503
        res.end(JSON.stringify({ error: "Local API configuration unavailable" }))
      }
      return
    }
    if (route !== "/api/market" && route !== "/api/feed") return next()
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.setHeader("Cache-Control", "no-store")
    if (req.method !== "GET") {
      res.statusCode = 405
      res.setHeader("Allow", "GET")
      res.end(JSON.stringify({ error: "GET required" }))
      return
    }
    await getData(route)
      .then((data) => {
        res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=60")
        res.end(JSON.stringify(data))
      })
      .catch(() => {
        res.statusCode = 503
        res.end(
          JSON.stringify({
            error:
              route === "/api/market"
                ? "Market data is temporarily unavailable. Please retry."
                : "News sources are temporarily unavailable. Please retry.",
          }),
        )
      })
  }
}
export function workspaceApi(): Plugin {
  let handler = createWorkspaceHandler()
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handler(req, res, next).catch(next)
  }
  return {
    name: "santi-workspace-api",
    configResolved(config) {
      handler = createWorkspaceHandler(config.root)
    },
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
