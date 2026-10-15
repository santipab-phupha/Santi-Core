import type { FeedResponse, MarketCoin } from "./data-types"

export type ImpactTone = "positive" | "negative" | "unknown"
export type ImpactEvidence = {
  id: string
  title: string
  url: string
  source: string
  domain: string
  at: string
  scope: "coin" | "market" | "tokenomics"
  tone: ImpactTone
  reason: string
}
export const impactLabels: Record<ImpactTone, string> = {
  positive: "Positive", negative: "Negative", unknown: "Inconclusive",
}
const HOUR = 3_600_000
const DAY = 24 * HOUR
const macroContext = /\b(?:crypto(?:currency)? markets?|digital asset markets?|federal reserve|fomc|fed (?:cuts?|hikes?|rates?|policy)|interest rates?|inflation|consumer price index|global liquidity|risk assets)\b/i
const uncertain = /\b(?:could|may|might|rumou?rs?|unconfirmed|alleged|propos(?:ed|al)|seeks?|plans?|considers?|expected|predicts?|forecast|whether|if|should|denies?|denied|no|not|never|without|avert(?:ed|s)?|despite|but|however|while)\b|\?/i
const positiveCues: [RegExp, string][] = [
  [/\b(?:net )?inflows?\b/i, "The headline reports inflows, a potential demand signal."],
  [/\b(?:sec|regulator|regulatory)\b.{0,60}\b(?:approves?|approved|approval)\b/i, "The headline reports regulatory approval."],
  [/\b(?:wins?|gets?|receives?)\b.{0,20}\bapproval\b.{0,20}\b(?:trade|offer|provide)\b/i, "The headline reports approval that expands access to the asset."],
  [/\b(?:launches|launched|opens|opened|starts|started)\b.{0,80}\b(?:trading|custody|payments)\b/i, "The headline reports a new trading or usage channel. Actual demand remains unverified."],
  [/\b(?:token|tokens|supply)\b.{0,35}\b(?:burned|burnt|reduced)\b|\b(?:burns?|burned)\b.{0,35}\b(?:tokens?|supply)\b/i, "The headline reports a supply reduction. Check its size and mechanism in the source."],
]
const negativeCues: [RegExp, string][] = [
  [/\b(?:net )?outflows?\b/i, "The headline reports outflows, a potential demand signal."],
  [/\b(?:hacked|exploited|hack|exploit|breach|insolvency|bankruptcy|bankrupt)\b/i, "The headline reports losses or risks involving a system or service provider."],
  [/\b(?:suspends?|suspended|halts?|halted)\b.{0,25}\bwithdrawals?\b/i, "The headline reports suspended withdrawals."],
  [/\b(?:delists?|delisted|delisting)\b/i, "The headline reports an exchange delisting."],
]
function recent(at: string, now: number, window: number) {
  const time = Date.parse(at)
  return Number.isFinite(time) && time <= now + 300_000 && now - time <= window
}
function boundary(term: string, flags = "i") {
  return new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, flags)
}
function mentionsCoin(text: string, coin: MarketCoin) {
  // Symbols are case-sensitive so ordinary words such as "near" do not match NEAR.
  const names = [coin.name, ...(coin.id.length > 4 ? [coin.id.replace(/-/g, " ")] : [])]
  return names.some((name) => boundary(name).test(text)) ||
    boundary(coin.symbol.toUpperCase(), "").test(text)
}
function canonicalUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:") return null
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key)
    }
    url.hash = ""
    return url
  } catch { return null }
}
export function headlineSignal(title: string): { tone: ImpactTone; reason: string } {
  // This is deliberately a small, auditable headline classifier, not an LLM forecast.
  if (uncertain.test(title) || (/\b(?:inflows?|outflows?)\b/i.test(title) && /\b(?:fall|falls|drop|drops|slows?|slowed|eases?|ends?|halts?|reverse[sd]?)\b/i.test(title)))
    return { tone: "unknown", reason: "The headline contains conditions, negation or ambiguous context." }
  const macroPressure = /\b(?:hot|high|rising|sticky)\b.{0,25}\b(?:inflation|cpi)\b|\b(?:inflation|cpi)\b.{0,25}\b(?:hot|surges?|spikes?|rises?|jumps?)\b|\b(?:fed|rate|interest)\b.{0,25}\b(?:hikes?|uncertainty)\b/i.test(title)
    && /\b(?:falls?|fell|slides?|slumps?|plunges?|lower|weighs|selloff|sell-off|dips?|wilts)\b/i.test(title)
    && /\b(?:as|after|amid|sending|weighs|drives?|triggers?)\b/i.test(title)
  const macroSupport = /\b(?:fed|interest|rate)\b.{0,20}\bcuts?\b|\b(?:inflation|cpi)\b.{0,20}\b(?:cools?|eases?)\b/i.test(title)
    && /\b(?:rises?|gains?|rallies|rally|climbs?|higher)\b/i.test(title)
    && /\b(?:as|after|amid|sending|drives?|triggers?)\b/i.test(title)
  const positive = positiveCues.find(([pattern]) => pattern.test(title)) ?? (macroSupport
    ? [null, "The headline links macro conditions to a positive response. It does not establish future direction."] as const : null)
  const negative = negativeCues.find(([pattern]) => pattern.test(title)) ?? (macroPressure
    ? [null, "The headline links inflation or interest-rate policy to pressure. It does not establish future direction."] as const : null)
  if (positive && negative)
    return { tone: "unknown", reason: "The headline contains both supportive factors and pressure." }
  if (positive) return { tone: "positive", reason: positive[1] }
  if (negative) return { tone: "negative", reason: negative[1] }
  return { tone: "unknown", reason: "The headline alone does not establish the impact on this asset." }
}
const compact = (value: number) => new Intl.NumberFormat("en-US", {
  notation: "compact", maximumFractionDigits: 2,
}).format(value)

export function analyzeCoinImpact({ coin, feed, now, marketStale = false, feedError = false }: {
  coin: MarketCoin
  feed: FeedResponse | null
  now: number
  marketStale?: boolean
  feedError?: boolean
}) {
  const feedCurrent = Boolean(feed && !feed.stale && !feedError && recent(feed.fetchedAt, now, HOUR / 6))
  const marketCurrent = !marketStale && recent(coin.updatedAt, now, HOUR / 6)
  const evidence: ImpactEvidence[] = []
  const urls = new Set<string>()
  const titles = new Set<string>()
  const limits = { coin: 12, market: 6, tokenomics: 6 }
  const scoped = { coin: 0, market: 0, tokenomics: 0 }
  let schedules = 0

  for (const item of [...(feed?.items ?? [])].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const url = canonicalUrl(item.url)
    const title = item.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
    if (!url || urls.has(url.href) || titles.has(title) || item.snapshot) continue
    let row: ImpactEvidence | null = null
    if (item.unlock) {
      const unlock = item.unlock
      // A ticker alone cannot safely disambiguate structured token schedules.
      const sameAsset = url.pathname.replace(/^\/|\/$/g, "") === coin.id ||
        (item.topics.some((topic) => topic.toLowerCase() === coin.name.toLowerCase()) &&
          unlock.symbol.toUpperCase() === coin.symbol.toUpperCase())
      const eventAt = Date.parse(unlock.date)
      if (!sameAsset || !Number.isFinite(eventAt) || eventAt < now || eventAt > now + 30 * DAY ||
        !Number.isFinite(unlock.amount) || unlock.amount <= 0) continue
      const supply = coin.circulatingSupply
      const ratio = supply !== null && Number.isFinite(supply) && supply > 0
        ? unlock.amount / supply * 100 : null
      const current = feedCurrent && marketCurrent && recent(unlock.checkedAt, now, 2 * HOUR)
      const pressure = current && eventAt <= now + 7 * DAY && ratio !== null && ratio >= 1
      schedules++
      row = {
        id: item.id, title: item.title, url: url.href, source: item.source,
        domain: url.hostname, at: unlock.checkedAt, scope: "tokenomics",
        tone: pressure ? "negative" : "unknown",
        reason: `${compact(unlock.amount)} ${unlock.symbol} unlocks on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(eventAt)}${ratio === null ? " · Supply baseline unavailable" : ` · ${ratio.toFixed(2)}% of circulating supply`}. ${!current ? "Data is stale or unavailable; no directional conclusion is drawn." : pressure ? "Potential supply pressure if tokens are sold; actual selling is unverified." : "An unlock schedule alone does not establish a price effect."}`,
      }
    } else {
      if (!recent(item.publishedAt, now, 3 * DAY)) continue
      const direct = mentionsCoin(item.title, coin)
      const macro = item.kind === "News" && macroContext.test(item.title)
      if (!direct && !macro) continue
      const scope = item.kind === "Tokenomics" ? "tokenomics" : direct ? "coin" : "market"
      const signal = headlineSignal(item.title)
      // Macro headlines are context; an event affecting one named asset is not
      // automatically a directional signal for every other asset in the market.
      const tone = !feedCurrent || scope === "market" ? "unknown" : signal.tone
      row = {
        id: item.id, title: item.title, url: url.href, source: item.source,
        domain: url.hostname, at: item.publishedAt, scope, tone,
        reason: !feedCurrent ? "The feed is stale or updates failed; no directional conclusion is drawn." : scope === "market"
          ? "Broad market context does not establish the impact on this specific asset." : signal.reason,
      }
    }
    if (row && scoped[row.scope] < limits[row.scope]) {
      evidence.push(row)
      scoped[row.scope]++
      urls.add(url.href)
      titles.add(title)
    }
  }
  if (coin.circulatingSupply !== null && Number.isFinite(coin.circulatingSupply) && coin.circulatingSupply > 0) {
    const validMax = coin.maxSupply !== null && Number.isFinite(coin.maxSupply) && coin.maxSupply >= coin.circulatingSupply
    evidence.push({
      id: `supply:${coin.id}`, title: `${coin.name} · Supply snapshot`,
      url: `https://www.coingecko.com/en/coins/${encodeURIComponent(coin.id)}`,
      source: "CoinGecko", domain: "www.coingecko.com", at: coin.updatedAt,
      scope: "tokenomics", tone: "unknown",
      reason: `Circulating ${compact(coin.circulatingSupply)} ${coin.symbol}${validMax ? ` / Max ${compact(coin.maxSupply!)}` : " · Max supply unavailable"}. ${marketCurrent ? "Remaining supply does not establish an issuance schedule or price direction." : "Market data is stale; no directional conclusion is drawn."}`,
    })
  }
  const counts: Record<ImpactTone, number> = { positive: 0, negative: 0, unknown: 0 }
  evidence.forEach((row) => counts[row.tone]++)
  const directional = evidence.filter((row) => row.tone !== "unknown")
  const domains = new Set(directional.map((row) => row.domain.replace(/^www\./, "")))
  const incomplete = !feedCurrent || !marketCurrent || Boolean(feed?.unavailableSources.length)
  let tone: ImpactTone = "unknown"
  let reason = "Directional evidence is insufficient or comes from only one source."
  if (incomplete) reason = "Some data is unavailable or stale; an overall conclusion cannot be drawn."
  else if (counts.positive && counts.negative) reason = "Evidence includes both support and pressure; the overall direction is inconclusive."
  else if (directional.length >= 2 && domains.size >= 2 && directional.length >= evidence.length / 2) {
    tone = counts.positive ? "positive" : "negative"
    reason = tone === "positive" ? "Feed evidence leans positive. Review the context and missing data." : "Feed evidence leans negative. Review the context and missing data."
  }
  const gaps: string[] = []
  if (!feed) gaps.push("News data is unavailable.")
  else if (feed.unavailableSources.length) gaps.push(`Unavailable sources: ${feed.unavailableSources.join(", ")}`)
  if (!scoped.coin) gaps.push("No asset-specific headlines in the loaded feed from the last 72 hours.")
  if (!schedules) gaps.push("No unlock for this asset within 30 days was found in the loaded dataset. This does not establish that no unlock exists.")
  if (!marketCurrent) gaps.push("Market data is not current enough.")
  return { tone, reason, counts, evidence, scoped, schedules, gaps, feedCurrent, marketCurrent }
}
