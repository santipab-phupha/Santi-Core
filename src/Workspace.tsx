import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import type {
  FeedItem,
  FeedResponse,
  MarketCoin,
  MarketResponse,
} from "./data-types"
import { supplySnapshots } from "./research"
import ResearchPanel from "./ResearchPanel"
import FinanceBackdrop from "./FinanceBackdrop"
import CryptoHeatmap from "./CryptoHeatmap"
import SourceQueueStatus from "./SourceQueueStatus"
import { startResourcePoller } from "./resource-poller"
import CoinImpact from "./CoinImpact"
import BearBullModal from "./BearBullModal"
import NewsAssetBadges from "./NewsAssetBadges"
import NewsReviewDetails, { newsReviewClass } from "./NewsReviewDetails"
import type { NewsReviews } from "./NewsReviewDetails"
import useNewsReviews from "./useNewsReviews"
import AgentPipeline from "./AgentPipeline"
import type { ImpactActivity } from "./pipeline-status"
import "./news-layout.css"

type Glyph = "search" | "arrow" | "refresh" | "spark" | "close" | "send" | "audio" | "news" | "token" | "check" | "chevron" | "external"
const glyphs: Record<Glyph, string> = {
  search: "M21 21l-5-5M18 10.5a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0112-1l2 6M4 12l2 6a7 7 0 0012-1",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3",
  close: "m6 6 12 12M6 18 18 6",
  send: "m3 11 18-8-8 18-2-7-8-3Zm8 3 5-5",
  audio: "M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4",
  news: "M4 4h16v16H4V4Zm4 4h8m-8 4h8m-8 4h5",
  token: "M12 3v18m5-14H9a3 3 0 000 6h6a3 3 0 010 6H7",
  check: "m5 12 4 4L19 6",
  chevron: "m8 10 4 4 4-4",
  external: "M14 4h6v6m0-6L10 14m8-1v7H4V6h7",
}
function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: Glyph
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={glyphs[name]} />
    </svg>
  )
}
function Brand() {
  return (
    <a className="brand" href="#market" aria-label="Santi-Core home">
      <img src="/santi-core-mark.svg" width="36" height="36" alt="" />
      <span>
        Santi<span className="brand-purple">-Core</span>
      </span>
    </a>
  )
}
const usd = (value: number, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 2 : value < 1 ? 5 : 2,
  }).format(value)
const number = (value: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value)
function dateLabel(value: string) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    }).format(new Date(value)) + " ICT"
  )
}
function age(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000))
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value))
}
function Change({ value }: { value: number | null }) {
  return value === null ? (
    <span className="change neutral">—</span>
  ) : (
    <span className={`change ${value < 0 ? "down" : "up"}`}>
      {value < 0 ? "↘" : "↗"} {Math.abs(value).toFixed(2)}%
      <span className="sr-only"> over 24 hours</span>
    </span>
  )
}
async function readApi<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(20_000)
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.error || "Connection unavailable. Please retry.")
  return data as T
}
function useResource<T>(url: string, interval: number) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const active = useRef<ReturnType<typeof startResourcePoller> | null>(null)
  const refresh = useCallback(() => active.current?.refresh(), [])
  useEffect(() => {
    const poller = startResourcePoller({
      interval,
      now: Date.now,
      online: () => navigator.onLine,
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer as number),
      onOffline: (value) => {
        setOffline(value)
        if (value) setLoading(false)
      },
      async run(signal) {
        setLoading(true)
        try {
          const result = await readApi<T>(url, signal)
          if (signal.aborted) return
          setData(result)
          setError("")
          setCheckedAt(Date.now())
        } catch (cause) {
          if (!signal.aborted)
            setError(cause instanceof Error ? cause.message : "Connection unavailable.")
        } finally {
          if (!signal.aborted) setLoading(false)
        }
      },
    })
    active.current = poller
    const online = () => poller.resume(true)
    const offline = () => poller.offline()
    const focus = () => poller.resume()
    const visible = () => {
      if (document.visibilityState === "visible") poller.resume()
    }
    window.addEventListener("online", online)
    window.addEventListener("offline", offline)
    window.addEventListener("focus", focus)
    document.addEventListener("visibilitychange", visible)
    return () => {
      active.current = null
      poller.stop()
      window.removeEventListener("online", online)
      window.removeEventListener("offline", offline)
      window.removeEventListener("focus", focus)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [url, interval])
  return { data, error, loading, refresh, offline, checkedAt }
}
function AutoRefresh({ resource, period }: {
  resource: { loading: boolean; offline: boolean; checkedAt: number | null; error: string }
  period: string
}) {
  return (
    <div className={`auto-refresh ${resource.offline || resource.error ? "interrupted" : ""}`}>
      <span role="status">
        <i aria-hidden="true" />
        {resource.offline ? "Offline · reconnecting" : resource.loading ? "Checking…" : resource.error ? "Retrying automatically" : `Auto · ${period}`}
      </span>
      {resource.checkedAt && (
        <time dateTime={new Date(resource.checkedAt).toISOString()}>
          Checked {new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Bangkok",
          }).format(resource.checkedAt)} ICT
        </time>
      )}
    </div>
  )
}
function ErrorNotice({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="error-notice" role="status">
      <span>{message}</span>
      <button onClick={onRetry}>
        Retry <Icon name="refresh" size={14} />
      </button>
    </div>
  )
}
function CoinImage({ coin }: { coin: MarketCoin }) {
  const [failed, setFailed] = useState(false)
  return coin.image && !failed ? (
    <img
      className="coin-image"
      src={coin.image}
      width="36"
      height="36"
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="coin-image coin-fallback">{coin.symbol[0]}</span>
  )
}
const chartIntervals = [
  { label: "1m", value: "1" },
  { label: "5m", value: "5" },
  { label: "15m", value: "15" },
  { label: "1h", value: "60" },
  { label: "4h", value: "240" },
  { label: "1D", value: "1D" },
] as const
function chartSymbol(coin: MarketCoin) {
  const knownPairs: Record<string, string> = {
    tether: "KRAKEN:USDTUSD",
    "usd-coin": "BINANCE:USDCUSDT",
  }
  if (knownPairs[coin.id]) return knownPairs[coin.id]
  const base = coin.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "")
  return base ? `BINANCE:${base}USDT` : "BINANCE:BTCUSDT"
}
function CoinChart({ coin, feed, now, marketStale, onAnalyze, news, onReviewActivity }: {
  coin: MarketCoin
  feed: ReturnType<typeof useResource<FeedResponse>>
  now: number
  marketStale: boolean
  onAnalyze: () => void
  news: ReactNode
  onReviewActivity: (activity: ImpactActivity) => void
}) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [interval, setInterval] = useState("1")
  const [chartError, setChartError] = useState(false)
  const symbol = chartSymbol(coin)

  useEffect(() => {
    const target = chartRef.current
    if (!target) return
    setChartError(false)
    target.replaceChildren()

    const container = document.createElement("div")
    container.className = "tradingview-widget-container"
    const widget = document.createElement("div")
    widget.className = "tradingview-widget-container__widget"
    const attribution = document.createElement("div")
    attribution.className = "tradingview-widget-copyright"
    const credit = document.createElement("a")
    credit.href = "https://www.tradingview.com/"
    credit.target = "_blank"
    credit.rel = "noopener noreferrer"
    credit.textContent = "Chart by TradingView"
    attribution.append(credit)
    const script = document.createElement("script")
    script.type = "text/javascript"
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
    script.async = true
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Asia/Bangkok",
      theme: "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      hide_side_toolbar: true,
      calendar: false,
      backgroundColor: "#16131f",
      gridColor: "rgba(187, 169, 211, 0.06)",
      support_host: "https://www.tradingview.com",
    })
    let active = true
    script.onerror = () => { if (active) setChartError(true) }
    container.append(widget, attribution, script)
    target.append(container)
    return () => {
      active = false
      target.replaceChildren()
    }
  }, [interval, symbol])

  return (
      <section id="coin-detail" className="market-detail" aria-labelledby="chart-title">
        <CoinImpact key={coin.id} coin={coin} feed={feed.data} now={now} marketStale={marketStale} feedError={Boolean(feed.error) || feed.offline} loading={feed.loading} onAnalyze={onAnalyze} onReviewActivity={onReviewActivity} />
        <div className="market-columns">
        <div className="market-chart-column">
        <header className="chart-head">
          <div className="chart-asset">
            <CoinImage coin={coin} />
            <div>
              <h2 id="chart-title">{coin.name} <span>{coin.symbol}</span></h2>
              <p>{usd(coin.price)} <span>·</span> CoinGecko</p>
            </div>
          </div>
        <div className="chart-toolbar">
          <span>Timeframe</span>
          <div role="group" aria-label="Chart timeframe">
            {chartIntervals.map((item) => (
              <button
                key={item.value}
                className={interval === item.value ? "active" : ""}
                aria-pressed={interval === item.value}
                onClick={() => setInterval(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        </header>
          <div className="chart-pane">
            {chartError && <p className="chart-error" role="status">The chart could not load. Check your connection and try again.</p>}
            <div className="chart-widget" ref={chartRef} role="region" aria-label={`${coin.name} price chart`} />
          </div>
        </div>
        {news}
        </div>
      </section>
  )
}
function MarketSection({
  resource,
  onResearch,
  onSelectCoin,
  selectedCoinId,
  pipeline,
}: {
  resource: ReturnType<typeof useResource<MarketResponse>>
  onResearch: (question: string) => void
  onSelectCoin: (coin: MarketCoin) => void
  selectedCoinId?: string
  pipeline: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<"cards" | "heatmap">("cards")
  const coins = resource.data?.coins ?? []
  return (
    <section
      className="market-section"
      id="market"
      aria-label="Crypto assets by market capitalization"
    >
      {resource.error && (
        <ErrorNotice message={resource.error} onRetry={resource.refresh} />
      )}
      {resource.data?.stale && !resource.error && (
        <ErrorNotice
          message="Showing the last available market snapshot."
          onRetry={resource.refresh}
        />
      )}
      <div className="market-topbar">
      {pipeline}
      <div className="market-view-switch" role="group" aria-label="Market view">
        <button type="button" aria-pressed={view === "cards"} aria-controls="market-visualization" onClick={() => setView("cards")}><span aria-hidden="true">▤</span> Cards</button>
        <button type="button" aria-pressed={view === "heatmap"} aria-controls="market-visualization" onClick={() => setView("heatmap")}><span aria-hidden="true">▦</span> Heatmap</button>
      </div>
      </div>
      <div id="market-visualization">
        {view === "heatmap" ? resource.loading && !coins.length
          ? <div className="heatmap-loading" role="status" aria-busy="true">Loading crypto heatmap…</div>
          : <CryptoHeatmap coins={coins} selectedCoinId={selectedCoinId} onSelectCoin={onSelectCoin} onResearch={onResearch} />
          : resource.loading && !coins.length ? <div className="market-cards" aria-label="Loading market data" aria-busy="true">{Array.from({length:5},(_,i)=><div className="coin-card skeleton" key={i}><span/><b/><span/></div>)}</div>
          : <div className="market-cards">
            {coins.slice(0,5).map((coin,i)=><article className={`coin-card ${coin.id === selectedCoinId ? "is-selected" : ""}`} key={coin.id} style={{animationDelay:`${i*55}ms`}}
              onPointerMove={event=>{
                if(event.pointerType==="touch")return
                const bounds=event.currentTarget.getBoundingClientRect()
                const x=(event.clientX-bounds.left)/bounds.width,y=(event.clientY-bounds.top)/bounds.height
                event.currentTarget.style.setProperty("--spot-x",`${x*100}%`)
                event.currentTarget.style.setProperty("--spot-y",`${y*100}%`)
                event.currentTarget.style.setProperty("--tilt-x",`${((x-.5)*2).toFixed(2)}deg`)
                event.currentTarget.style.setProperty("--tilt-y",`${((.5-y)*2).toFixed(2)}deg`)
              }} onPointerLeave={event=>{event.currentTarget.style.setProperty("--tilt-x","0deg");event.currentTarget.style.setProperty("--tilt-y","0deg")}}>
              <button className="coin-chart-trigger" onClick={()=>onSelectCoin(coin)} aria-label={`Show ${coin.name} chart, 1 minute`} aria-pressed={coin.id===selectedCoinId} aria-controls="coin-detail">
                <div className="coin-top"><CoinImage coin={coin}/><div><h2>{coin.name}</h2><span>{coin.symbol}</span></div><span className="rank">#{coin.rank}</span></div>
                <div className="coin-price">{usd(coin.price)}</div>
                <div className="coin-change"><Change value={coin.change24h}/><span>24h</span></div>
                <div className="coin-bottom"><span>Market cap <b>{usd(coin.marketCap,true)}</b></span></div>
              </button>
              <button className="coin-research" onClick={()=>onResearch(`Research ${coin.name} (${coin.symbol})`)} aria-label={`Research ${coin.name}`}><Icon name="spark" size={16}/></button>
            </article>)}
            {!coins.length && <p className="heatmap-empty">Market data is unavailable. Refresh to try again.</p>}
          </div>}
      </div>
      <div className="market-foot">
        <a
          href="https://www.coingecko.com/en/api"
          target="_blank"
          rel="noreferrer"
        >
          Data by CoinGecko <Icon name="external" size={12} />
        </a>
        {coins.length > 0 && (
          <button
            className="text-button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls="market-table"
          >
            {expanded ? "Hide rankings" : "View rankings"}{" "}
            <Icon
              name="chevron"
              size={15}
              className={expanded ? "rotate" : ""}
            />
          </button>
        )}
      </div>
      {expanded && (
        <div className="market-table-wrap" id="market-table">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Asset</th>
                <th>Price</th>
                <th>24h</th>
                <th>Market cap</th>
                <th>
                  <span className="sr-only">Research</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {coins.map((coin) => (
                <tr key={coin.id}>
                  <td className="table-rank">{coin.rank}</td>
                  <td>
                    <button className="chart-table-trigger" onClick={() => onSelectCoin(coin)} aria-label={`Show ${coin.name} chart, 1 minute`} aria-pressed={coin.id === selectedCoinId} aria-controls="coin-detail">
                      <span className="table-asset">
                        <CoinImage coin={coin} />
                        <span>
                          {coin.name}
                          <small>{coin.symbol}</small>
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="numeric">{usd(coin.price)}</td>
                  <td>
                    <Change value={coin.change24h} />
                  </td>
                  <td className="numeric">{usd(coin.marketCap, true)}</td>
                  <td>
                    <button
                      className="icon-button"
                      onClick={() => onResearch(`Research ${coin.name}`)}
                      aria-label={`Research ${coin.name}`}
                    >
                      <Icon name="spark" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
function NewsPreview({ resource, coins, now, reviews }: {
  resource: ReturnType<typeof useResource<FeedResponse>>
  coins: MarketCoin[]
  now: number
  reviews: NewsReviews
}) {
  const items = [...(resource.data?.items ?? [])]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 3)
  return <aside className="news-preview" aria-labelledby="preview-heading">
    <header className="news-preview-head"><h2 id="preview-heading">Latest News</h2><a href="#news" aria-label="More news">More <Icon name="arrow" size={14} /></a></header>
    <SourceQueueStatus queue={reviews.data.sourceQueue} />
    {(resource.error || resource.data?.stale) && <p className="news-preview-notice" role="status">{resource.data ? "Showing saved news · refresh unavailable" : "News unavailable"} <button onClick={resource.refresh}>Retry</button></p>}
    {!!resource.data?.unavailableSources.length && <p className="news-preview-notice">{resource.data.unavailableSources.join(", ")} unavailable</p>}
    {reviews.error && <p className="news-reviews-notice" role="status">{reviews.error}</p>}
    <div className="news-preview-list" aria-busy={resource.loading && !resource.data}>
      {resource.loading && !resource.data ? <p className="news-preview-empty">Loading headlines…</p>
        : items.length ? items.map((item) => <article className={`news-preview-item ${newsReviewClass(item, reviews.data)}`} key={item.id}>
          <div className="news-asset-column"><NewsAssetBadges item={item} coins={coins} /></div>
          <div className="news-preview-copy">
            <div className="news-preview-meta"><span className={`kind-badge ${item.kind.toLowerCase()}`}>{item.kind}</span><time dateTime={item.publishedAt} title={dateLabel(item.publishedAt)}>{age(item.publishedAt, now)}</time></div>
            <h3><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a></h3>
            <div className="news-preview-bottom"><span className="news-preview-source">{item.source}</span></div>
            <NewsReviewDetails item={item} reviews={reviews} />
          </div>
        </article>) : <p className="news-preview-empty">No headlines yet.</p>}
    </div>
    <a className="news-preview-more" href="#news">View all news <Icon name="arrow" size={15} /></a>
  </aside>
}
function FeedSection({
  resource,
  coins,
  query,
  now,
  onResearch,
  reviews,
}: {
  resource: ReturnType<typeof useResource<FeedResponse>>
  coins: MarketCoin[]
  query: string
  now: number
  onResearch: (question: string) => void
  reviews: NewsReviews
}) {
  const [kind, setKind] = useState<"All" | FeedItem["kind"]>("All")
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest")
  const [visible, setVisible] = useState(9)
  const filtered = useMemo(
    () =>
      [...(resource.data?.items ?? []), ...supplySnapshots(coins)]
        .sort((a, b) => sortOrder === "newest"
          ? Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
          : Date.parse(a.publishedAt) - Date.parse(b.publishedAt))
        .filter(
          (item) =>
            (kind === "All" || item.kind === kind) &&
            `${item.title} ${item.source} ${item.topics.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
    [resource.data, coins, kind, query, sortOrder],
  )
  useEffect(() => setVisible(9), [query, kind, sortOrder])
  const latest = resource.data?.items[0]?.publishedAt
  return (
    <section className="feed-section" id="feed" aria-labelledby="feed-heading">
      <div className="section-head feed-head">
        <div>
          <h2 id="feed-heading">Latest News</h2>
        </div>
        <div className="feed-refresh">
        <button
          className="refresh-button"
          onClick={resource.refresh}
          disabled={resource.loading}
          aria-label="Refresh latest news"
        >
          <Icon
            name="refresh"
            size={16}
            className={resource.loading ? "spin" : ""}
          />
          <span>Refresh</span>
        </button>
        <AutoRefresh resource={resource} period="1 min" />
        </div>
      </div>
      <SourceQueueStatus queue={reviews.data.sourceQueue} />
      <div className="feed-toolbar">
        <div className="feed-tabs" aria-label="Filter feed">
          {(["All", "News", "Tokenomics"] as const).map((label) => (
            <button
              key={label}
              onClick={() => setKind(label)}
              aria-pressed={kind === label}
              className={kind === label ? "active" : ""}
            >
              {label !== "All" && (
                <Icon name={label === "News" ? "news" : "token"} size={15} />
              )}
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="feed-sort"
          onClick={() => setSortOrder(order => order === "newest" ? "oldest" : "newest")}
          title={sortOrder === "newest" ? "Switch to oldest first" : "Switch to newest first"}
        >
          {sortOrder === "newest" ? "Newest first" : "Oldest first"}
          <span aria-hidden="true">{sortOrder === "newest" ? "↓" : "↑"}</span>
        </button>
      </div>
      {resource.error && (
        <ErrorNotice message={resource.error} onRetry={resource.refresh} />
      )}
      {resource.data?.stale && (
        <ErrorNotice
          message="Showing cached headlines. The latest refresh failed."
          onRetry={resource.refresh}
        />
      )}
      {!!resource.data?.unavailableSources.length && (
        <p className="source-note">
          {resource.data.unavailableSources.join(", ")} temporarily unavailable.
          Other publishers are shown.
        </p>
      )}
      {latest && now - Date.parse(latest) > 172_800_000 && (
        <p className="source-note">
          Latest available publisher updates · {dateLabel(latest)}
        </p>
      )}
      {resource.loading && !resource.data ? (
        <div
          className="news-grid"
          aria-busy="true"
          aria-label="Loading headlines"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div className="news-card skeleton" key={i}>
              <span />
              <b />
              <b />
              <span />
            </div>
          ))}
        </div>
      ) : filtered.length ? (
        <div className="news-grid">
          {filtered.slice(0, visible).map((item) => (
            <article className={`news-card ${newsReviewClass(item, reviews.data)}`} key={item.id}>
              <div className="news-asset-column"><NewsAssetBadges item={item} coins={coins} /></div>
              <div className="news-card-copy">
                <div className="news-top">
                  <span className={`kind-badge ${item.kind.toLowerCase()}`}>
                    <Icon
                      name={item.kind === "News" ? "news" : "token"}
                      size={13}
                    />
                    {item.kind}
                  </span>
                  <time
                    dateTime={item.publishedAt}
                    title={dateLabel(item.publishedAt)}
                  >
                    {age(item.publishedAt, now)}
                  </time>
                </div>
                <h3>
                  <a href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                </h3>
                <NewsReviewDetails item={item} reviews={reviews} />
                {item.snapshot && (
                  <div className="supply-numbers">
                    <span>
                      Circulating
                      <b>
                        {number(item.snapshot.circulating)} {item.snapshot.symbol}
                      </b>
                    </span>
                    <span>
                      Max supply
                      <b>
                        {item.snapshot.maximum === null
                          ? "Not specified"
                          : `${number(item.snapshot.maximum)} ${item.snapshot.symbol}`}
                      </b>
                    </span>
                  </div>
                )}
                {item.unlock && (
                  <div className="supply-numbers">
                    <span>
                      Scheduled unlock
                      <b>{dateLabel(item.unlock.date)}</b>
                    </span>
                    <span>
                      Cliff release
                      <b>{number(item.unlock.amount)} {item.unlock.symbol}</b>
                    </span>
                  </div>
                )}
                <div className="news-bottom">
                  <a
                    className="publisher"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span
                      className={`publisher-mark ${item.source.toLowerCase()}`}
                    >
                      {item.source.startsWith("Tokenomist")
                        ? "T"
                        : item.source === "CoinGecko"
                        ? "G"
                        : item.source === "CoinDesk"
                          ? "C"
                          : item.source === "Decrypt"
                            ? "D"
                            : "CT"}
                    </span>
                    {item.source}
                    <Icon name="external" size={12} />
                  </a>
                  <button
                    className="research-link"
                    aria-label={`Research: ${item.title}`}
                    onClick={() =>
                      onResearch(
                        item.snapshot
                          ? `Research ${item.snapshot.symbol} tokenomics`
                          : `Research this headline: ${item.title}`,
                      )
                    }
                  >
                    <Icon name="spark" size={15} />
                    Research
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" size={28} />
          <h3>
            {query ? "No matching headlines" : "No updates in this category"}
          </h3>
          <p>
            {query
              ? "Try a coin name or a different keyword."
              : "New items will appear when publishers cover this topic."}
          </p>
        </div>
      )}
      {filtered.length > visible && (
        <button className="load-more" onClick={() => setVisible((v) => v + 9)}>
          Load more <span>{filtered.length - visible}</span>
          <Icon name="arrow" size={16} />
        </button>
      )}
      <p className="feed-note">
        Publisher & provider timestamps · Tokenomics includes supply snapshots,
        up to 25 upcoming Tokenomist cliff unlocks and related reporting.
      </p>
    </section>
  )
}
export default function Workspace() {
  const market = useResource<MarketResponse>("/api/market", 60_000)
  const feed = useResource<FeedResponse>("/api/feed", 60_000)
  const [query, setQuery] = useState("")
  const [now, setNow] = useState(Date.now())
  const [researchOpen, setResearchOpen] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<MarketCoin | null>(null)
  const [impactActivity, setImpactActivity] = useState<ImpactActivity | null>(null)
  const [route, setRoute] = useState(() => window.location.hash)
  const backgroundRoute = useRef(route.startsWith("#analysis/") ? "#market" : route)
  const previousRoute = useRef(route)
  const analysisId = /^#analysis\/([a-z0-9-]{1,80})$/.exec(route)?.[1]
  const pageRoute = analysisId ? backgroundRoute.current : route
  const newsPage = pageRoute === "#news" || pageRoute === "#feed"
  const analysisCoin = market.data?.coins.find((coin) => coin.id === analysisId) ?? (selectedAsset?.id === analysisId ? selectedAsset : null)
  useEffect(() => {
    const change = () => {
      const next = window.location.hash
      if (!next.startsWith("#analysis/")) backgroundRoute.current = next
      setRoute(next)
    }
    window.addEventListener("hashchange", change)
    return () => window.removeEventListener("hashchange", change)
  }, [])
  useEffect(() => {
    const previous = previousRoute.current
    previousRoute.current = route
    if (analysisId || previous.startsWith("#analysis/")) return
    if (newsPage) window.scrollTo({ top: 0 })
    else if (["#market", "#feed"].includes(route)) document.getElementById(route.slice(1))?.scrollIntoView()
  }, [route, analysisId, newsPage])
  const selectedCoin = market.data?.coins.find((coin) => coin.id === (selectedAsset?.id ?? "bitcoin")) ?? selectedAsset ?? market.data?.coins[0] ?? null
  const newsReviews = useNewsReviews(selectedCoin?.id)
  const openAnalysis = (coin: MarketCoin) => {
    setSelectedAsset(coin)
    setResearchOpen(false)
    if (!analysisId) backgroundRoute.current = route || "#market"
    window.location.hash = `analysis/${coin.id}`
  }
  const closeAnalysis = useCallback(() => {
    const next = backgroundRoute.current || "#market"
    window.history.replaceState(window.history.state, "", next)
    setRoute(next)
  }, [])
  const [seed, setSeed] = useState<{ id: number; question: string } | null>(null)
  const closeResearch = useCallback(() => setResearchOpen(false), [])
  const openResearch = (question: string) => {
    setSeed({ id: Date.now(), question })
    setResearchOpen(true)
  }
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className="workspace">
      <FinanceBackdrop />
      <a className="skip-link" href="#market">
        Skip to market
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Page sections">
            <a href="#market">Market</a>
            <a href="#news">News</a>
          </nav>
          <div className="header-search">
            <Icon name="search" size={16} />
            <input
              aria-label="Search latest headlines"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  window.location.hash = "news"
                  document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" })
                }
              }}
              placeholder="Search the feed…"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        </div>
      </header>
      <button
        className={`research-launcher ${researchOpen ? "is-open" : ""}`}
        onClick={() => setResearchOpen(!researchOpen)}
        aria-label={
          researchOpen ? "Close research assistant" : "Open research assistant"
        }
        aria-expanded={researchOpen}
      >
        <Icon name={researchOpen ? "close" : "spark"} size={18} />
        <span>Research</span>
        <kbd>↗</kbd>
      </button>
      <main className="workspace-content">
        {newsPage ? <div className="news-page"><a className="news-back" href="#market">← Back to Market</a>{newsReviews.error && <p className="news-reviews-notice" role="status">{newsReviews.error}</p>}<FeedSection resource={feed} coins={market.data?.coins ?? []} query={query} now={now} onResearch={openResearch} reviews={newsReviews} /></div> : <>
        <MarketSection resource={market} onResearch={openResearch} onSelectCoin={setSelectedAsset} selectedCoinId={selectedCoin?.id} pipeline={<AgentPipeline feed={{ loading: feed.loading, offline: feed.offline, error: feed.error, checkedAt: feed.checkedAt, count: feed.data?.items.length ?? 0, stale: Boolean(feed.data?.stale) }} queue={newsReviews.data.sourceQueue} sourceError={newsReviews.loadError} impact={impactActivity?.coinId === selectedCoin?.id ? impactActivity : null} symbol={selectedCoin?.symbol ?? "asset"} />} />
        {selectedCoin ? <CoinChart key={selectedCoin.id} coin={selectedCoin} feed={feed} now={now} marketStale={Boolean(market.error) || market.offline || Boolean(market.data?.stale)} onAnalyze={() => openAnalysis(selectedCoin)} onReviewActivity={setImpactActivity} news={<NewsPreview resource={feed} coins={market.data?.coins ?? []} now={now} reviews={newsReviews} />} />
          : <NewsPreview resource={feed} coins={market.data?.coins ?? []} now={now} reviews={newsReviews} />}
        </>}
      </main>
      <footer className="site-footer">
        <Brand />
        <span>Clarity starts with context.</span>
        <div>
          <a href="https://www.coingecko.com/" target="_blank" rel="noreferrer">
            CoinGecko
          </a>
          <a href="https://www.coindesk.com/" target="_blank" rel="noreferrer">
            CoinDesk
          </a>
          <a href="https://cointelegraph.com/" target="_blank" rel="noreferrer">
            Cointelegraph
          </a>
          <a href="https://decrypt.co/" target="_blank" rel="noreferrer">
            Decrypt
          </a>
        </div>
      </footer>
      <ResearchPanel open={researchOpen} onClose={closeResearch} seed={seed} />
      {analysisId && <BearBullModal key={analysisId} coin={analysisCoin ?? null} loading={market.loading} onClose={closeAnalysis} />}
    </div>
  )
}
