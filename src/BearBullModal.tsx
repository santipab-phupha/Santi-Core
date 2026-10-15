import { useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import type { MarketCoin } from "./data-types"
import BearBullAnalysis from "./BearBullAnalysis"
import "./bear-bull-modal.css"

export default function BearBullModal({ coin, loading, onClose }: {
  coin: MarketCoin | null
  loading: boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const backdropPress = useRef(false)
  useLayoutEffect(() => {
    const element = dialog.current!
    const previousOverflow = document.body.style.overflow
    const previousScroll = { left: window.scrollX, top: window.scrollY }
    document.body.style.overflow = "hidden"
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = previousOverflow
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
      window.scrollTo({ ...previousScroll, behavior: "instant" })
    }
  }, [])
  return createPortal(
    <dialog ref={dialog} className="analysis-dialog" aria-labelledby="analysis-modal-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget }}
      onClick={(event) => { if (event.target === event.currentTarget && backdropPress.current) onClose() }}>
      <div className="analysis-modal-surface">
        <header className="analysis-modal-header">
          <div>
            <span className="analysis-modal-eyebrow">BULL / BEAR INTELLIGENCE</span>
            <h1 id="analysis-modal-title">Listen to both sides.</h1>
            {coin && <span className="analysis-modal-asset"><img src={coin.image} alt="" width="20" height="20" />{coin.name}<b>{coin.symbol}</b></span>}
          </div>
          <button autoFocus className="analysis-modal-close" onClick={onClose} aria-label="Close analysis">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button>
        </header>
        <div className="analysis-modal-body">
          {coin ? <BearBullAnalysis coin={coin} /> : <p className="analysis-modal-message" role="status">{loading ? "Loading asset…" : "This asset is not available in the loaded market list."}</p>}
        </div>
      </div>
    </dialog>, document.body,
  )
}
