import { useState } from "react"
import "./finance-backdrop.css"

const candles = [
  [18, 370, 55, 24], [54, 340, 72, -32], [90, 318, 52, 28], [126, 270, 90, -48],
  [162, 258, 58, 24], [198, 216, 76, -38], [234, 180, 70, -32], [270, 196, 52, 22],
  [306, 146, 84, -44], [342, 116, 58, -26], [378, 128, 70, 30], [414, 78, 88, -40],
]
const fragments = [
  { label: "BTC / USD", position: "btc", path: "M0 28 16 22 28 27 44 9 58 16 74 3 90 8 108 0" },
  { label: "ETH / USD", position: "eth", path: "M0 26 18 29 32 16 48 22 64 7 80 15 96 3 112 8" },
  { label: "LIQUIDITY", position: "liquidity", path: "M0 25 16 19 30 24 46 13 62 19 78 5 94 12 110 2" },
  { label: "MARKET VOLUME", position: "volume", path: "M0 27 14 18 30 22 46 5 64 14 78 8 94 16 110 0" },
]

export default function FinanceBackdrop() {
  const [paused, setPaused] = useState(false)
  return <>
    <div className={`finance-backdrop ${paused ? "is-paused" : ""}`} aria-hidden="true">
      <div className="finance-glow finance-glow-purple" />
      <div className="finance-glow finance-glow-teal" />
      <div className="finance-grid" />
      <svg className="finance-market-lines" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <linearGradient id="finance-trend" x1="0" y1="700" x2="1440" y2="200" gradientUnits="userSpaceOnUse"><stop stopColor="#6a449e" stopOpacity="0"/><stop offset=".35" stopColor="#b68be9"/><stop offset=".7" stopColor="#7a60be"/><stop offset="1" stopColor="#60bfae" stopOpacity=".4"/></linearGradient>
          <linearGradient id="finance-area" x1="0" y1="200" x2="0" y2="1000" gradientUnits="userSpaceOnUse"><stop stopColor="#9d67de" stopOpacity=".12"/><stop offset="1" stopColor="#9d67de" stopOpacity="0"/></linearGradient>
        </defs>
        <g className="finance-trend-layer">
          <path d="M-80 800 60 760 150 795 270 670 340 700 460 540 560 610 670 460 780 515 890 350 1010 405 1120 270 1220 330 1340 150 1520 200V1100H-80Z" fill="url(#finance-area)"/>
          <path d="M-80 800 60 760 150 795 270 670 340 700 460 540 560 610 670 460 780 515 890 350 1010 405 1120 270 1220 330 1340 150 1520 200" stroke="url(#finance-trend)" strokeWidth="1.5"/>
          <path d="M-50 880 90 810 210 850 320 760 450 795 580 660 720 705 860 550 1000 610 1130 440 1260 510 1480 330" stroke="#8060ae" strokeWidth="1" strokeDasharray="4 9" opacity=".38"/>
          {[ [270,670], [670,460], [1120,270], [1340,150] ].map(([cx,cy],i)=><g key={cx}><circle cx={cx} cy={cy} r="3" fill="#b78be5"/><circle className="finance-signal-ring" style={{animationDelay:`${i * -1.6}s`}} cx={cx} cy={cy} r="9" stroke="#b78be5"/></g>)}
        </g>
        <g className="finance-candles finance-candles-left" transform="translate(-50 180)">
          {candles.map(([x,y,height,body],i)=><g key={i} stroke={body<0?"#9e78d2":"#597b91"}><path d={`M${x} ${y-height/2}v${height}`}/><rect x={x-5} y={y-Math.abs(body)/2} width="10" height={Math.abs(body)} rx="2" fill={body<0?"#9e78d2":"#597b91"} fillOpacity=".35"/></g>)}
        </g>
        <g className="finance-candles finance-candles-right" transform="translate(1190 600) scale(.8)">
          {candles.slice(0,8).map(([x,y,height,body],i)=><g key={i} stroke={body<0?"#73b1a9":"#9570b8"}><path d={`M${x} ${y-height/2}v${height}`}/><rect x={x-5} y={y-Math.abs(body)/2} width="10" height={Math.abs(body)} rx="2" fill={body<0?"#73b1a9":"#9570b8"} fillOpacity=".3"/></g>)}
        </g>
      </svg>
      {fragments.map(fragment=><div key={fragment.position} className={`finance-fragment finance-fragment-${fragment.position}`}><span>{fragment.label}</span><svg viewBox="0 0 114 34" fill="none"><path d={fragment.path} stroke="currentColor" strokeWidth="1.2"/></svg></div>)}
      <span className="finance-symbol finance-symbol-bitcoin">₿</span>
      <span className="finance-symbol finance-symbol-ethereum">Ξ</span>
      <div className="finance-grain" />
    </div>
    <button className="finance-motion-toggle" onClick={()=>setPaused(value=>!value)} aria-label={paused ? "Resume background animation" : "Pause background animation"} aria-pressed={paused} title={paused ? "Resume background animation" : "Pause background animation"}><span aria-hidden="true">{paused?"▷":"Ⅱ"}</span><span>Background</span></button>
  </>
}
