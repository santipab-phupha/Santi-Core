import { useMemo, useState } from "react"
import type { FeedResponse, MarketCoin } from "./data-types"
import { analyzeCoinImpact, impactLabels } from "./coin-impact"
import type { ImpactTone } from "./coin-impact"
import "./coin-impact.css"

const tones: ImpactTone[] = ["positive", "negative", "unknown"]
const scopes = { coin: "Asset news", market: "Market context", tokenomics: "Tokenomics" }
function timestamp(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(time)
    : "Time unavailable"
}

export default function CoinImpact({ coin, feed, now, marketStale, feedError, loading, onAnalyze }: {
  coin: MarketCoin
  feed: FeedResponse | null
  now: number
  marketStale: boolean
  feedError: boolean
  loading: boolean
  onAnalyze: () => void
}) {
  const result = useMemo(() => analyzeCoinImpact({ coin, feed, now, marketStale, feedError }),
    [coin, feed, now, marketStale, feedError])
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<ImpactTone | null>(null)
  const total = result.evidence.length
  const pending = loading && !feed
  const visible = filter ? result.evidence.filter((item) => item.tone === filter) : result.evidence
  const evidenceId = `impact-evidence-${coin.id}`
  const selectTone = (tone: ImpactTone) => {
    setFilter(filter === tone ? null : tone)
    setExpanded(true)
  }

  return (
    <section className="coin-impact" aria-labelledby="impact-title" aria-busy={pending}>
      <div className="impact-heading">
        <h3 id="impact-title">Overviews</h3>
        <button className="impact-analyze" onClick={onAnalyze} aria-haspopup="dialog"><span aria-hidden="true">✦</span> Analysis by Bear/Bull <span aria-hidden="true">↗</span></button>
      </div>
      <div className={`impact-meter ${pending ? "is-loading" : ""}`} aria-label={pending ? "Gathering evidence" : `${total} sources: positive ${result.counts.positive}, negative ${result.counts.negative}, inconclusive ${result.counts.unknown}`}>
        {!pending && tones.map((tone) => result.counts[tone] > 0 && (
          <button
            className={`impact-segment ${tone}`}
            key={tone}
            style={{ width: `${result.counts[tone] / total * 100}%` }}
            onClick={() => selectTone(tone)}
            aria-label={`View ${impactLabels[tone].toLowerCase()} evidence: ${result.counts[tone]} sources`}
            title={`${impactLabels[tone]}: ${result.counts[tone]} sources`}
          />
        ))}
      </div>
      <div className="impact-bottom"><div className="impact-legend" aria-label="Filter evidence by impact">
        {tones.map((tone) => (
          <button className={tone} key={tone} aria-pressed={filter === tone} onClick={() => selectTone(tone)} disabled={pending}>
            <i aria-hidden="true" />{impactLabels[tone]} <b>{pending ? "—" : result.counts[tone]}</b>
          </button>
        ))}
      </div>
        <button className="impact-expand" onClick={() => { setExpanded(!expanded); setFilter(null) }} aria-expanded={expanded} aria-controls={evidenceId}>
          {expanded ? "Hide evidence" : `View evidence ${pending ? "" : total}`} <span aria-hidden="true">{expanded ? "−" : "+"}</span>
        </button>
      </div>
      {expanded && (
        <div className="impact-detail" id={evidenceId}>
          <div className="impact-coverage">
            {Object.entries(scopes).map(([scope, label]) => (
              <span key={scope}>{label} <b>{result.evidence.filter((item) => item.scope === scope).length}</b></span>
            ))}
            {feed && <time dateTime={feed.fetchedAt}>Feed {timestamp(feed.fetchedAt)} ICT</time>}
          </div>
          {filter && <button className="impact-clear-filter" onClick={() => setFilter(null)}>Show all · Viewing {impactLabels[filter]}</button>}
          <div className="impact-evidence">
            {visible.map((item) => (
              <article key={item.id} className={`impact-evidence-row ${item.tone}`}>
                <div className="impact-evidence-meta">
                  <span>{impactLabels[item.tone]} · {scopes[item.scope]}</span>
                  <time dateTime={Number.isFinite(Date.parse(item.at)) ? item.at : undefined}>{timestamp(item.at)} ICT</time>
                </div>
                <a href={item.url} target="_blank" rel="noreferrer">{item.title} <span aria-hidden="true">↗</span></a>
                <p>{item.reason}</p>
                <small>{item.source} · {item.domain}</small>
              </article>
            ))}
            {!visible.length && <p className="impact-empty">{pending ? "Gathering evidence…" : "No evidence in this category yet"}</p>}
          </div>
          {result.gaps.length > 0 && <div className="impact-gaps">{result.gaps.map((gap) => <p key={gap}>{gap}</p>)}</div>}
          <details className="impact-method">
            <summary>Methodology and coverage</summary>
            <p>Rule-based labels use publisher headlines from the last 72 hours. They do not read full articles, use an AI model, or extract TradingView data. Conditional, negated and broad market headlines are inconclusive. Exact duplicate URLs and titles are removed; different reports of the same event may remain.</p>
            <p>Tokenomics uses CoinGecko supply data and up to 25 upcoming Tokenomist cliff unlocks, filtered to this asset within 30 days. An unlock of at least 1% of circulating supply within 7 days is labelled potential supply pressure. This rule has not been validated for predictive accuracy and does not establish actual selling. Supply totals or a missing unlock are not positive signals.</p>
            <p>The bar shows the share of evidence labels, not price probabilities. Different domains do not establish independent confirmation. Coverage is limited to 12 asset headlines, 6 market headlines, 6 tokenomics items and 1 supply snapshot. Bear/Bull uses ElevenLabs Agents for a separate analysis and debate.</p>
            <a href="https://tokenomist.ai/learn/glossary-term/unlocked-supply" target="_blank" rel="noreferrer">Learn about unlocked supply at Tokenomist ↗</a>
          </details>
        </div>
      )}
    </section>
  )
}
