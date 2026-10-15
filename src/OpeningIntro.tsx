import { useLayoutEffect, useRef } from "react"
import "./opening-intro.css"

export default function OpeningIntro({ onFinish }: { onFinish: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    const timer = window.setTimeout(onFinish, 8_000)
    return () => {
      window.clearTimeout(timer)
      element.close()
    }
  }, [onFinish])

  return <dialog ref={dialog} className="santi-intro" aria-label="Welcome to Santi-Core" aria-describedby="intro-description"
    onCancel={event => { event.preventDefault(); onFinish() }}>
    <p id="intro-description" className="intro-accessible">Presented by Team <span lang="th">สันติภาพ</span> in U-Hackathon 2026. Santi-Core. A Multi-Agent Platform for Crypto News Research and Analysis.</p>
    <button className="intro-skip" autoFocus onClick={onFinish}>Skip intro <span aria-hidden="true">↗</span></button>
    <div className="intro-atmosphere" aria-hidden="true">
      <div className="intro-aura" /><div className="intro-grid" />
      <svg className="intro-network" viewBox="0 0 1440 900" fill="none" preserveAspectRatio="xMidYMid slice">
        <path d="M-80 690 180 610 360 670 570 430 790 485 1060 260 1280 330 1520 110" />
        <path d="M-30 180 240 300 420 235 610 380 850 310 1080 480 1250 415 1480 530" />
        {[[180,610],[360,670],[570,430],[790,485],[1060,260],[1280,330],[240,300],[420,235],[850,310],[1080,480]].map(([cx,cy], index) => <circle key={index} cx={cx} cy={cy} r={index % 3 === 0 ? 3 : 2} />)}
      </svg>
      <span className="intro-star star-one" /><span className="intro-star star-two" /><span className="intro-star star-three" />
    </div>
    <div className="intro-stage" aria-hidden="true">
      <section className="intro-credits">
        <p className="intro-presented">Presented by Team</p>
        <h1 className="intro-team" lang="th"><span>“</span>สันติภาพ<span>”</span></h1>
        <p className="intro-in">in</p>
        <p className="intro-event">U-Hackathon <span>2026</span></p>
        <span className="intro-credit-line" />
      </section>
      <section className="intro-brand-scene">
        <div className="intro-logo-wrap"><span className="intro-logo-halo" /><img className="intro-logo" src="/santi-core-mark.svg" width="104" height="104" alt="" /></div>
        <h2 className="intro-name">Santi<span>-Core</span></h2>
        <p className="intro-tagline"><span>A Multi-Agent Platform</span><span>for Crypto News Research and Analysis</span></p>
        <span className="intro-brand-line" />
      </section>
    </div>
    <div className="intro-timeline" aria-hidden="true"><span /></div>
  </dialog>
}
