import { useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import type { MarketCoin } from "./data-types"
import type { ImpactReportSnapshot } from "./impact-report"
import type useReportAudio from "./useReportAudio"
import ImpactReport from "./ImpactReport"
import "./report-audio-modal.css"

export default function ReportAudioModal({ coin, report, speech, onClose }: {
  coin: MarketCoin
  report: ImpactReportSnapshot | null
  speech: ReturnType<typeof useReportAudio>
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const backdropPress = useRef(false)
  useLayoutEffect(() => {
    const element = dialog.current!
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
    }
  }, [])
  const speaking = speech.status === "playing"
  const preparing = speech.status === "loading"
  const progress = speech.current ? speech.current.index / speech.current.total * 100 : 0

  return createPortal(
    <dialog ref={dialog} className="report-listen-dialog" aria-labelledby="report-listen-title"
      onCancel={event => { event.preventDefault(); onClose() }}
      onPointerDown={event => { backdropPress.current = event.target === event.currentTarget }}
      onClick={event => { if (event.target === event.currentTarget && backdropPress.current) onClose() }}>
      <header className="report-listen-header">
        <div><span>ELEVENLABS AUDIO</span><h2 id="report-listen-title">Listen to report</h2></div>
        <button autoFocus className="report-listen-close" onClick={onClose} aria-label="Close report audio">×</button>
      </header>
      <div className="report-listen-body">
        <div className={`report-listen-orb ${speaking ? "is-speaking" : ""} ${preparing ? "is-loading" : ""}`} aria-hidden="true">
          {coin.image ? <img src={coin.image} alt="" width="52" height="52" /> : <b>{coin.symbol}</b>}
          <i /><i />
        </div>
        <div className="report-listen-asset"><strong>{coin.name}</strong><span>{coin.symbol}</span></div>
        <div className="report-listen-state" role="status">
          {speech.active && <span className="report-audio-wave" aria-hidden="true"><i /><i /><i /><i /></span>}
          {preparing ? "Preparing audio…" : speaking ? "Reading your report" : speech.status === "ready" ? "Ready to play" : speech.detail === "Report finished" ? "Report finished" : speech.error ? "Audio unavailable" : "Playback stopped"}
        </div>
        <section className="report-listen-transcript" aria-label="Current narration">
          <header><h3>{speech.current?.title || `${coin.symbol} Report`}</h3>{speech.current && <span>{speech.current.index} / {speech.current.total}</span>}</header>
          <p>{speech.current?.text || (speech.error ? "Press Retry to try again." : speech.active ? "Loading the latest source-checked report…" : "Press Listen again to read this report.")}</p>
        </section>
        <div className="report-listen-progress" role="progressbar" aria-label="Report sections" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>
        {speech.error && <p className="report-listen-error" role="alert">{speech.error}</p>}
        {speech.status === "ready" && <p className="report-listen-hint">Audio is ready. Press Play to listen.</p>}
        <div className="report-listen-controls">
          <button className="report-listen-play" onClick={() => { if (speech.active && speech.status !== "ready") speech.stop(); else void speech.listen() }}>
            {speech.active && speech.status !== "ready" ? "■ Stop" : speech.status === "ready" ? "▶ Play" : speech.error ? "↻ Retry" : "▶ Listen again"}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        {report && <details className="report-listen-full"><summary>View full report <span>{report.positive.length} positive · {report.negative.length} negative</span></summary><ImpactReport id="spoken-report" report={report} busy={false} error="" /></details>}
      </div>
    </dialog>, document.body,
  )
}
