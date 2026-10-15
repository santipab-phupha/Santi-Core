import type { FeedItem, MarketCoin } from "./data-types"

const tokenomicsWords =
  /tokenomics|unlock|vesting|supply|burn|issuance|emission|airdrop|ปลดล็อก|โทเคโนมิกส์|อุปทาน/i
const aliases: Record<string, string[]> = {
  bitcoin: ["บิทคอยน์"],
  ethereum: ["อีเธอเรียม", "อีเธอร์"],
  solana: ["โซลาน่า", "โซลานา"],
}
export function supplySnapshots(coins: MarketCoin[]): FeedItem[] {
  return coins
    .slice(0, 5)
    .filter(
      (coin) =>
        coin.circulatingSupply !== null && coin.circulatingSupply !== undefined,
    )
    .map((coin) => ({
      id: `supply:${coin.id}`,
      title: `${coin.name} supply snapshot`,
      url: `https://www.coingecko.com/en/coins/${encodeURIComponent(coin.id)}`,
      source: "CoinGecko",
      publishedAt: coin.updatedAt,
      kind: "Tokenomics",
      topics: [coin.name, coin.symbol, "Circulating supply"],
      snapshot: {
        circulating: coin.circulatingSupply!,
        maximum: coin.maxSupply,
        symbol: coin.symbol,
      },
    }))
}
export function mentionedCoins(
  query: string,
  coins: MarketCoin[],
): MarketCoin[] {
  const lower = query.toLowerCase()
  return coins.filter((coin) => {
    const terms = [coin.name, coin.id, coin.symbol, ...(aliases[coin.id] ?? [])]
    return terms.some((term) => {
      const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(lower)
    })
  })
}
export function researchMatches(
  query: string,
  coins: MarketCoin[],
  items: FeedItem[],
) {
  const selectedCoins = mentionedCoins(query, coins)
  const terms =
    query
      .toLowerCase()
      .match(/[a-z0-9]{3,}/g)
      ?.filter(
        (term) =>
          ![
            "what",
            "about",
            "latest",
            "news",
            "research",
            "tell",
            "please",
            "market",
            "markets",
            "tokenomics",
            "supply",
            "unlock",
            "unlocks",
            "vesting",
            "cliff",
            "linear",
            "token",
            "tokens",
            "this",
            "headline",
            "happening",
            "with",
            "the",
            "and",
            "are",
            "for",
            "how",
            "does",
            "can",
            "you",
            "show",
            "today",
          ].includes(term),
      ) ?? []
  const clickedTitle = query
    .replace(/^research this headline:\s*/i, "")
    .toLowerCase()
  const supplyQuestion = tokenomicsWords.test(query)
  const eventQuestion = /unlock|vesting|airdrop|ปลดล็อก/i.test(query)
  const ranked = items
    .map((item) => {
      const text = `${item.title} ${item.topics.join(" ")}`.toLowerCase()
      const coinMatch = selectedCoins.some(
        (coin) => mentionedCoins(text, [coin]).length > 0,
      )
      const termMatch = terms.some((term) =>
        new RegExp(`(?<![a-z0-9])${term}(?![a-z0-9])`, "i").test(text),
      )
      const exact = clickedTitle === item.title.toLowerCase()
      const kindMatch = supplyQuestion && item.kind === "Tokenomics"
      const relevant =
        (exact ||
          (selectedCoins.length
            ? coinMatch && (!supplyQuestion || kindMatch)
            : supplyQuestion
              ? kindMatch && (!terms.length || termMatch)
              : terms.length
                ? termMatch
                : true)) &&
        !(eventQuestion && item.snapshot)
      return {
        item,
        relevant,
        score:
          (exact ? 100 : 0) +
          (coinMatch ? 4 : 0) +
          (kindMatch ? 2 : 0) +
          (termMatch ? 1 : 0),
      }
    })
    .filter((row) => row.relevant)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Date.parse(b.item.publishedAt) - Date.parse(a.item.publishedAt),
    )
  return {
    coins: selectedCoins.length
      ? selectedCoins
      : terms.length || supplyQuestion
        ? []
        : coins.slice(0, 3),
    articles: ranked.slice(0, 5).map((row) => row.item),
    specific: selectedCoins.length > 0 || supplyQuestion || terms.length > 0,
  }
}
