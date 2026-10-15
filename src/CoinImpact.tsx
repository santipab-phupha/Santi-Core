import { useEffect, useMemo, useState } from "react"
import type { FeedResponse, MarketCoin } from "./data-types"
import { analyzeCoinImpact, impactLabels } from "./coin-impact"
import { impactInput, reviewedEvidence } from "./impact-types"
import useImpactReview from "./useImpactReview"
import useImpactReport from "./useImpactReport"
import useReportAudio from "./useReportAudio"
import ImpactReport from "./ImpactReport"
import ReportAudioModal from "./ReportAudioModal"
import type { ImpactReportSnapshot } from "./impact-report"
import { newsReviewInput } from "./news-review-types"
import type { ImpactTone } from "./coin-impact"
import type { ImpactActivity } from "./pipeline-status"
import "./coin-impact.css"

const tones: ImpactTone[] = ["positive", "negative", "unknown"]
const scopes = { coin: "Asset news", market: "Market context", tokenomics: "Tokenomics" }
function timestamp(value: string) {
  const time = Date.parse(value)
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }).format(time)
    : "Time unavailable"
}

export default function CoinImpact({ coin, feed, now, marketStale, feedError, loading, onAnalyze, onReviewActivity }: {
  coin: MarketCoin
  feed: FeedResponse | null
  now: number
  marketStale: boolean
  feedError: boolean
  loading: boolean
  onAnalyze: () => void
  onReviewActivity?: (activity: ImpactActivity) => void
}) {
  const base = useMemo(() => analyzeCoinImpact({ coin, feed, now, marketStale, feedError }),
    [coin, feed, now, marketStale, feedError])
  const latestNewsKey = JSON.stringify([...(feed?.items ?? [])].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 5).map(newsReviewInput))
  const reviewKey = JSON.stringify(base.evidence.filter((item) => !item.id.startsWith("supply:")).map((item) => impactInput(coin.id, item))) + latestNewsKey + Math.floor(now / 1_800_000)
  const agent = useImpactReview(coin.id, reviewKey, Boolean(feed && base.feedCurrent && base.marketCurrent && !feedError))
  const reviewed = reviewedEvidence(coin.id, base.evidence, agent.review, base.feedCurrent && base.marketCurrent && !feedError)
  const result = { ...base, ...reviewed }
  const reviewEnabled = Boolean(feed && base.feedCurrent && base.marketCurrent && !feedError)
  const reviewedCount = agent.review?.coinId === coin.id ? agent.review.labels.length : 0
  const pendingCount = agent.review?.coinId === coin.id ? agent.review.pending ?? result.pending.length : result.pending.length
  const reviewRunning = reviewEnabled && (agent.busy || agent.review?.running === true)
  useEffect(() => {
    onReviewActivity?.({ coinId: coin.id, enabled: reviewEnabled, busy: reviewRunning, error: reviewEnabled ? agent.error : "", reviewed: reviewedCount, pending: pendingCount })
  }, [coin.id, reviewEnabled, reviewRunning, agent.error, reviewedCount, pendingCount, onReviewActivity])
  const [expanded, setExpanded] = useState(false)
  const [filter, setFilter] = useState<ImpactTone | null>(null)
  const report = useImpactReport(coin.id)
  const [listenOpen, setListenOpen] = useState(false)
  const [narrationReport, setNarrationReport] = useState<ImpactReportSnapshot | null>(null)
  const speech = useReportAudio(coin.id, setNarrationReport)
  const closeListen = () => { speech.stop(); setListenOpen(false) }
  const reportOpen = Boolean(report.report || report.error)
  const total = result.evidence.length
  const pending = (loading && !feed) || (agent.busy && !total)
  const visible = filter ? result.evidence.filter((item) => item.tone === filter) : result.evidence
  const evidenceId = `impact-evidence-${coin.id}`
  const selectTone = (tone: ImpactTone) => {
    setFilter(filter === tone ? null : tone)
    setExpanded(true)
  }

  return (
    <><section className="coin-impact" aria-labelledby="impact-title" aria-busy={pending}>
      <div className="impact-heading">
        <h3 id="impact-title">Overviews</h3>
        <div className="impact-actions">
          <button className="impact-report-button" onClick={() => { speech.stop(); if (reportOpen) report.close(); else void report.generate() }} disabled={report.busy} aria-expanded={reportOpen || report.busy} aria-controls="impact-report"><span aria-hidden="true">{reportOpen ? "×" : "▤"}</span>{report.busy ? "Generating…" : reportOpen ? "Close" : "Report"}</button>
          <button className="impact-report-button impact-listen-button" onClick={() => { setNarrationReport(null); setListenOpen(true); void speech.listen() }} disabled={report.busy} aria-haspopup="dialog" aria-label="Listen to report" title="Read this asset's report aloud with ElevenLabs"><span aria-hidden="true">▶</span>Listen</button>
          <button className="impact-analyze" onClick={() => { speech.stop(); onAnalyze() }} aria-haspopup="dialog"><span aria-hidden="true">✦</span> Bear/Bull <span aria-hidden="true">↗</span></button>
        </div>
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
      <audio ref={speech.audio} preload="none" onEnded={speech.ended} onError={speech.mediaError} />
      <div className="impact-review-status" role="status">
        {agent.busy ? <span className="impact-review-running">✦ Reviewing news for {coin.symbol}…{agent.review?.coinId === coin.id && agent.review.labels.length > 0 ? ` · ${agent.review.labels.length} reviewed` : ""}</span>
          : agent.error ? <span>{agent.error} <button onClick={agent.retry}>Retry review</button></span>
          : !base.feedCurrent || !base.marketCurrent ? <span>Fresh data is needed before Agent review.</span>
          : <span>✦ {agent.review?.coinId === coin.id ? "Review complete" : "Awaiting review"} · {total} signals{result.context.length ? ` · ${result.context.length} context` : ""}{result.pending.length ? ` · ${result.pending.length} awaiting review` : ""}{agent.review?.coinId === coin.id && result.pending.length > 0 && <> <button onClick={agent.retry}>Review remaining</button></>}</span>}
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
                <small>{item.source} · {item.domain}{item.agent ? item.agent.verification?.status === "unverified" ? " · Source check · no model inference" : ` · Impact Agent · ${item.agent.basis}` : ""}</small>
                {item.agent?.quote && <blockquote>{item.agent.quote}</blockquote>}
                {item.agent?.verification?.status === "unverified" && <small className="impact-source-missing">No evidence · Inconclusive</small>}
                {!!item.agent?.verification?.references.length && <div className="impact-source-references"><span>Ref.</span>{item.agent.verification.references.map(reference => <a key={reference.url} href={reference.url} title={reference.title} target="_blank" rel="noreferrer">{reference.source} ↗</a>)}</div>}
              </article>
            ))}
            {!visible.length && <p className="impact-empty">{pending ? "Gathering evidence…" : "No evidence in this category yet"}</p>}
          </div>
          {result.context.length > 0 && <details className="impact-method"><summary>Context · {result.context.length}</summary>{result.context.map((item) => <article key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a><p>{item.reason}</p></article>)}</details>}
          {result.pending.length > 0 && <p className="impact-empty">{result.pending.length} items awaiting Agent review. Unreviewed news is excluded from the bar.</p>}
          {result.gaps.length > 0 && <div className="impact-gaps">{result.gaps.map((gap) => <p key={gap}>{gap}</p>)}</div>}
          <details className="impact-method">
            <summary>Methodology and coverage</summary>
            <p>A separate source worker opens the original publisher link and matches the supplied headline or excerpt against the retrieved page text. It does not search other websites or use an AI model. An ElevenLabs Agent then reasons about asset impact using the matched text or structured unlock data. If no text matches, the story stays visible as Inconclusive without an extra model call. Pending or interrupted analysis is excluded until completion. Neutral supported background and supply snapshots appear under Context. Green Approved means both stages completed, not certified factual truth. This is event-impact interpretation, not a price forecast.</p>
            <p>Tokenomics uses CoinGecko supply data and up to 25 upcoming Tokenomist cliff unlocks, filtered to this asset within 30 days. The Agent considers the supplied unlock date and amount; an unlock does not establish actual selling. Supply totals or a missing unlock are not positive signals. Duplicate URLs and titles are removed, but different reports of the same event may remain.</p>
            <p>The bar shows the share of Agent-reviewed signals, not price probabilities. Results are cached per asset and evidence item; new or changed items need review. Different domains do not establish independent confirmation. Coverage is limited to 12 asset headlines, 6 market headlines, 6 tokenomics items and 1 supply snapshot. Bear/Bull uses ElevenLabs Agents for a separate analysis and debate.</p>
            <a href="https://tokenomist.ai/learn/glossary-term/unlocked-supply" target="_blank" rel="noreferrer">Learn about unlocked supply at Tokenomist ↗</a>
          </details>
        </div>
      )}
    </section>
    <ImpactReport report={report.report} busy={report.busy} error={report.error} />
    {listenOpen && <ReportAudioModal coin={coin} report={narrationReport} speech={speech} onClose={closeListen} />}
    </>
  )
}
