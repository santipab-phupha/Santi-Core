import type { FeedItem, MarketCoin } from "./data-types"

export type NewsAsset = {
  id: string
  name: string
  symbol: string
  image: string
}
const aliases: Record<string, string[]> = {
  bitcoin: ["บิทคอยน์"],
  ethereum: ["อีเธอเรียม", "อีเธอร์", "ether"],
  solana: ["โซลานา", "โซลาน่า"],
}
// These tickers are routinely written in lowercase by publishers. Other symbols
// must be uppercase, so words such as "near", "link" and "op" do not become tags.
const distinctTickers = new Set(["BTC", "ETH", "SOL", "XRP", "USDT", "USDC", "BNB", "DOGE", "ADA", "TRX", "WBTC"])
function contains(text: string, term: string, flags = "i") {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return Boolean(term) && new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, flags).test(text)
}
export function newsAssets(item: FeedItem, coins: MarketCoin[]): NewsAsset[] {
  const explicitSymbol = item.unlock?.symbol ?? item.snapshot?.symbol
  if (explicitSymbol) {
    const coin = coins.find((coin) => coin.symbol.toUpperCase() === explicitSymbol.toUpperCase())
    return coin ? [coin] : [{ id: `symbol:${explicitSymbol}`, name: item.topics[0] || explicitSymbol, symbol: explicitSymbol.toUpperCase(), image: "" }]
  }
  const text = `${item.title} ${item.topics.join(" ")}`
  return coins.filter((coin) => {
    const symbol = coin.symbol.toUpperCase()
    // A short/common project name needs an exact publisher topic or uppercase
    // ticker; a sentence containing "near" does not identify the NEAR asset.
    const commonName = ["near", "link", "optimism", "ton", "sui"].includes(coin.name.toLowerCase())
    const named = commonName ? item.topics.some((topic) => topic.toLowerCase() === coin.name.toLowerCase())
      : contains(text, coin.name)
    return named || (aliases[coin.id] ?? []).some((alias) => contains(text, alias)) ||
      contains(text, symbol, distinctTickers.has(symbol) ? "i" : "")
  })
}
