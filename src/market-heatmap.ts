import type { MarketCoin } from "./data-types"

export type HeatmapTile = { coin: MarketCoin; x: number; y: number; width: number; height: number }

// A binary treemap divides the longest side in proportion to each group's cap.
// The entire area is preserved; small assets are never given invented weight.
export function marketTreemap(coins: MarketCoin[], width: number, height: number): HeatmapTile[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  const seen = new Set<string>()
  const values = coins.filter(coin => {
    if (seen.has(coin.id) || !Number.isFinite(coin.marketCap) || coin.marketCap <= 0) return false
    seen.add(coin.id); return true
  }).sort((a, b) => b.marketCap - a.marketCap).slice(0, 50)
  const total = values.reduce((sum, coin) => sum + coin.marketCap, 0)
  if (!Number.isFinite(total) || !total) return []
  const tiles: HeatmapTile[] = []
  function divide(items: MarketCoin[], x: number, y: number, w: number, h: number) {
    if (!items.length) return
    if (items.length === 1) { tiles.push({ coin: items[0], x, y, width: w, height: h }); return }
    const sum = items.reduce((sum, coin) => sum + coin.marketCap, 0)
    let split = 1, subtotal = items[0].marketCap
    while (split < items.length - 1 && Math.abs(subtotal + items[split].marketCap - sum / 2) < Math.abs(subtotal - sum / 2)) subtotal += items[split++].marketCap
    const fraction = subtotal / sum
    if (w >= h) { const cut = w * fraction; divide(items.slice(0, split), x, y, cut, h); divide(items.slice(split), x + cut, y, w - cut, h) }
    else { const cut = h * fraction; divide(items.slice(0, split), x, y, w, cut); divide(items.slice(split), x, y + cut, w, h - cut) }
  }
  divide(values, 0, 0, width, height)
  return tiles
}

export function heatmapColor(change: number | null) {
  if (change === null || !Number.isFinite(change)) return { tone: "unavailable", color: "#292536" }
  if (Math.abs(change) < .01) return { tone: "neutral", color: "#353344" }
  const strength = Math.min(Math.abs(change) / 8, 1)
  return { tone: change > 0 ? "positive" : "negative", color: `hsl(${change > 0 ? 157 : 346} ${32 + strength * 27}% ${19 + strength * 14}%)` }
}
