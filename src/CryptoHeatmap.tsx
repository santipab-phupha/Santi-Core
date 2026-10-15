import { useEffect, useMemo, useRef, useState } from "react"
import type { MarketCoin } from "./data-types"
import { heatmapColor, marketTreemap } from "./market-heatmap"
import "./crypto-heatmap.css"

const money = (value: number, compact = false) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: compact ? "compact" : "standard",
  maximumFractionDigits: compact ? 2 : value > 1 ? 2 : value > .01 ? 4 : 8,
}).format(value)
const changeLabel = (value: number | null) => value === null || !Number.isFinite(value) ? "N/A" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`

function HeatmapLogo({coin,size}:{coin:MarketCoin;size:number}) {
  const [failed,setFailed]=useState(false)
  return <span className="heatmap-logo" style={{width:size,height:size,fontSize:Math.max(6,Math.floor(size*.36))}} aria-hidden="true">
    {coin.image&&!failed ? <img src={coin.image} alt="" width={size} height={size} loading="lazy" onError={()=>setFailed(true)}/> : <span className="heatmap-logo-fallback">{coin.symbol.slice(0,2)}</span>}
  </span>
}

export default function CryptoHeatmap({ coins, selectedCoinId, onSelectCoin, onResearch }: {
  coins: MarketCoin[]; selectedCoinId?: string; onSelectCoin: (coin: MarketCoin) => void; onResearch: (question: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => {
    const target = container.current
    if (!target) return
    const update = () => setSize(current => current.width === target.clientWidth && current.height === target.clientHeight ? current : { width: target.clientWidth, height: target.clientHeight })
    const observer = new ResizeObserver(update)
    update(); observer.observe(target)
    return () => observer.disconnect()
  }, [])
  const tiles = useMemo(() => marketTreemap(coins, size.width, size.height), [coins, size.width, size.height])
  const active = coins.find(coin => coin.id === (hovered ?? selectedCoinId)) ?? coins[0]
  const totalCap = tiles.reduce((sum, tile) => sum + tile.coin.marketCap, 0)
  return <div className="crypto-heatmap">
    <header className="heatmap-heading">
      <div><h2>Crypto Heatmap <span>Top 50</span></h2><p>Size · market cap <span>Color · 24h change</span></p></div>
      <div className="heatmap-legend" aria-label="24-hour price change color scale, capped at minus and plus eight percent"><span>≤−8%</span><i aria-hidden="true"/><span>≥+8%</span></div>
    </header>
    <div ref={container} className="heatmap-canvas" role="group" aria-label="Top 50 cryptocurrencies by market capitalization. Select an asset to show its chart.">
      {tiles.map(tile => {
        const { coin, x, y, width, height } = tile
        const large = width >= 160 && height >= 280
        const medium = width >= 70 && height >= 96
        const logoSize = Math.floor(Math.max(0, Math.min(large ? 104 : medium ? 64 : 40, width*.68, height*(large ? .3 : medium ? .4 : .74), Math.min(width,height)-6)))
        const readable = width >= Math.max(38, coin.symbol.length * 6 + 8) && height >= logoSize+26
        const selected = coin.id === selectedCoinId
        const color = heatmapColor(coin.change24h)
        return <button key={coin.id} data-asset={coin.id} className={`heatmap-tile ${color.tone} ${large ? "large" : medium ? "medium" : "small"} ${selected ? "is-selected" : ""}`}
          style={{left:x,top:y,width,height,background:color.color}}
          aria-label={`${coin.name} (${coin.symbol}), rank ${coin.rank}, market cap ${money(coin.marketCap,true)}, price ${money(coin.price)}, 24h ${changeLabel(coin.change24h)}. Show chart.`}
          aria-pressed={selected} aria-controls="coin-detail"
          title={`${coin.name} · ${money(coin.price)} · ${changeLabel(coin.change24h)} in 24h · Market cap ${money(coin.marketCap,true)}`}
          onPointerEnter={()=>setHovered(coin.id)} onPointerLeave={()=>setHovered(null)} onFocus={()=>setHovered(coin.id)} onBlur={()=>setHovered(null)} onClick={()=>onSelectCoin(coin)}>
          <span className="heatmap-tile-content">
            {logoSize>=6 && <HeatmapLogo coin={coin} size={logoSize}/>}
            {readable && <span className="heatmap-ticker">{coin.symbol}</span>}
            {large && <span className="heatmap-coin-name">{coin.name}</span>}
            {large && <span className="heatmap-price">{money(coin.price)}</span>}
            {medium && <span className="heatmap-change">{changeLabel(coin.change24h)}</span>}
            {large && <span className="heatmap-cap">{money(coin.marketCap,true)} <span>market cap</span></span>}
          </span>
        </button>
      })}
      {!tiles.length && <p className="heatmap-empty">{coins.length ? "Preparing heatmap…" : "Market data is unavailable. Refresh to try again."}</p>}
    </div>
    {active && <div className="heatmap-inspector">
      <div className="heatmap-inspector-asset"><strong>{active.name}</strong><span>{active.symbol} · #{active.rank}</span></div>
      <div><small>Price</small><b>{money(active.price)}</b></div>
      <div className={`heatmap-inspector-change ${heatmapColor(active.change24h).tone}`}><small>24h</small><b>{changeLabel(active.change24h)}</b></div>
      <div><small>Market cap</small><b>{money(active.marketCap,true)}</b></div>
      <button onClick={()=>onResearch(`Research ${active.name} (${active.symbol})`)} aria-label={`Research ${active.name}`}>Research ↗</button>
    </div>}
    <div className="heatmap-caption"><span>{tiles.length || coins.length} assets · USD · including stablecoins</span>{totalCap > 0 && <span>Shown market cap {money(totalCap,true)}</span>}</div>
  </div>
}
