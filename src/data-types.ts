export type MarketCoin = {
  id: string
  symbol: string
  name: string
  image: string
  rank: number
  price: number
  marketCap: number
  change24h: number | null
  circulatingSupply: number | null
  maxSupply: number | null
  updatedAt: string
}
export type FeedItem = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  kind: "News" | "Tokenomics"
  topics: string[]
  unlock?: {
    date: string
    amount: number
    valueUsd: number | null
    symbol: string
    checkedAt: string
  }
  snapshot?: {
    circulating: number
    maximum: number | null
    symbol: string
  }
}
export type MarketResponse = {
  coins: MarketCoin[]
  fetchedAt: string
  stale: boolean
  source: "CoinGecko"
}
export type FeedResponse = {
  items: FeedItem[]
  fetchedAt: string
  stale: boolean
  unavailableSources: string[]
}
