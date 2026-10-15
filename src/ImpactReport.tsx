import type { ImpactReportSnapshot } from "./impact-report"
import "./impact-report.css"

export default function ImpactReport({ report, busy, error, id = "impact-report" }: { report: ImpactReportSnapshot | null; busy: boolean; error: string; id?: string }) {
  if (!report && !busy && !error) return null
  return (
    <section id={id} className="impact-report" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <header className="report-heading">
        <h3 id={`${id}-title`}>{report?.symbol} Report</h3>
        <span role="status">{busy ? "Updating report…" : report ? <time dateTime={report.generatedAt}>Updated {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(report.generatedAt))}</time> : "Report unavailable"}</span>
      </header>
      {error && <p className="report-error" role="alert">{error}{report ? " Your previous report is shown below." : ""}</p>}
      {report && <>
        {!report.fresh && <p className="report-error">Fresh market and news data are unavailable. Close and reopen Report when the feed recovers.</p>}
        <div className="report-columns">
          {(["positive", "negative"] as const).map(tone => (
            <section className={`report-column ${tone}`} key={tone} aria-labelledby={`${id}-${tone}`}>
              <header><h4 id={`${id}-${tone}`}><span aria-hidden="true">{tone === "positive" ? "↗" : "↘"}</span> {tone === "positive" ? "Positive news" : "Negative news"}</h4><b>{report[tone].length}</b></header>
              <div className="report-stories">
                {report[tone].map(item => (
                  <article key={item.id} className="report-story">
                    <a className="report-story-title" href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a>
                    <p>{item.reason}</p>
                    <div className="report-references"><span>Ref.</span>{item.agent!.verification!.references.map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer" title={reference.title}>{reference.source} ↗</a>)}</div>
                  </article>
                ))}
                {!report[tone].length && <p className="report-empty">No source-checked {tone} signals yet.</p>}
              </div>
            </section>
          ))}
        </div>
        <p className="report-coverage">{report.inconclusive} inconclusive · {report.pending} awaiting review · {report.context} context. These are excluded from the two columns.</p>
        <p className="report-caption">Completed reviews for {report.symbol} · news within 72 hours and upcoming unlocks. Close and reopen to refresh reviewed news.</p>
      </>}
    </section>
  )
}
