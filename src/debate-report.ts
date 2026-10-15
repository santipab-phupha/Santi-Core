import type { DebateResult, DebateSource } from "./bear-bull-types"

export const debatePositions = { challenge: "Challenged", concede: "Conceded", uncertain: "Insufficient evidence" }
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)
const dateTime = (value: string) => Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "long", timeZone: "Asia/Bangkok" }).format(new Date(value))
  : "Time unavailable"
function citations(sources: DebateSource[]) {
  return sources.length ? `<ul class="references">${sources.map(source => {
    try {
      const url = new URL(source.url)
      if (url.protocol === "https:" && !url.username && !url.password)
        return `<li><a href="${escape(url.href)}" target="_blank" rel="noreferrer">${escape(source.title)}</a><small>${escape(url.href)}</small></li>`
    } catch { /* Omit invalid destinations from the downloaded document. */ }
    return `<li>${escape(source.title)}</li>`
  }).join("")}</ul>` : "<p class=muted>No source links provided for this section.</p>"
}
const gaps = (items: string[]) => items.length ? `<ul>${items.map(item => `<li>${escape(item)}</li>`).join("")}</ul>` : "<p>No additional gaps reported.</p>"

export function debateReportFilename(result: DebateResult) {
  const symbol = result.symbol.replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "Asset"
  const date = Number.isFinite(Date.parse(result.createdAt)) ? new Date(result.createdAt).toISOString().slice(0, 19).replace(/[T:]/g, "-") : "report"
  return `Santi-Core-${symbol}-Bear-Bull-${date}.html`
}

// Build a self-contained document from the completed result; never serialize credentials or audio tokens.
export function buildDebateReportHtml(result: DebateResult) {
  const sides = ["bull", "bear"] as const
  const argumentsHtml = sides.flatMap(side => result.openings[side].claims.map(claim => {
    const opponent = side === "bull" ? "bear" : "bull"
    const reply = result.rebuttals[opponent].replies.find(item => item.claimId === claim.id)
    return { side, opponent, claim, reply }
  })).map(({ side, opponent, claim, reply }, index) => `<article class="dispute">
    <header><span>ARGUMENT ${index + 1}</span><h3>${escape(claim.title)}</h3><p>${reply ? debatePositions[reply.position] : "Response unavailable"}</p></header>
    <div class="columns"><section class="${side}"><h4>${side.toUpperCase()} · Claim</h4><p>${escape(claim.argument)}</p>${citations(claim.sources)}<p class="caveat">Caveat: ${escape(claim.caveat)}</p></section>
    <section class="${opponent}"><h4>${opponent.toUpperCase()} · Response</h4><p>${escape(reply?.argument ?? "No completed response is available.")}</p>${citations(reply?.sources ?? [])}</section></div>
  </article>`).join("")
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(result.coinName)} · Bear/Bull report · Santi-Core</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0e0c14;color:#e5dfed;font:15px/1.85 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:48px 24px}h1,h2,h3,h4{line-height:1.4}h1{font-size:36px;margin:12px 0}h2{margin:36px 0 18px}h3{margin:8px 0}h4{margin:0 0 14px}p,li{overflow-wrap:anywhere;white-space:pre-wrap}p{margin:10px 0}a{color:#cbb2f2}header>span,.muted,small{color:#aaa0ba;font-size:12px}small{display:block;overflow-wrap:anywhere}ul{padding-left:20px}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.bull,.bear{min-width:0;padding:22px;border:3px solid #39b888;border-radius:14px;background:#13241f}.bear{border-color:#e36d88;background:#2a1821}.bull h4{color:#77e0b3}.bear h4{color:#ffa0b5}.dispute{margin:20px 0;padding:18px;border:1px solid #493856;border-radius:18px;background:#16131f}.dispute>header{margin-bottom:18px}.dispute>header>p{color:#cbb2f2;font-size:13px}.references{font-size:12px}.caveat{border-top:1px solid #53725f;padding-top:14px;font-size:12px;color:#c2b8ce}.metadata{padding:18px;border:1px solid #493856;border-radius:12px}.notice{margin-top:32px;color:#aaa0ba;font-size:12px}@media(max-width:650px){main{padding:24px 16px}h1{font-size:28px}.columns{grid-template-columns:1fr}.dispute{padding:12px}.bull,.bear{padding:18px}}@media print{body{background:white;color:#17111f;font-size:11pt}main{max-width:none;padding:0}.dispute,.bull,.bear{background:white;color:#17111f;box-shadow:none}.bull h4{color:#176744}.bear h4{color:#a12544}a{color:#493069}.muted,small,.notice,.caveat,header>span{color:#555}.bull,.bear{break-inside:avoid}h2,h3,h4{break-after:avoid}*{print-color-adjust:exact}}
</style></head><body><main>
<header><span>SANTI-CORE · COMPLETED ANALYSIS</span><h1>${escape(result.coinName)} (${escape(result.symbol)})</h1><p>Bear/Bull research report</p></header>
<div class="metadata"><p>Analyzed: ${escape(dateTime(result.createdAt))}<br>Market data: ${escape(dateTime(result.dataAt))}</p><small>Report ID: ${escape(result.reportId)}</small></div>
<h2>Both perspectives</h2><div class="columns">${sides.map(side => `<section class="${side}"><h4>${side.toUpperCase()} · Overview</h4><p>${escape(result.openings[side].summary)}</p><h4>After cross-examination</h4><p>${escape(result.rebuttals[side].summary)}</p></section>`).join("")}</div>
<h2>All arguments · ${sides.reduce((sum, side) => sum + result.openings[side].claims.length, 0)}</h2>${argumentsHtml || "<p>Neither side has enough evidence to make a sourced claim.</p>"}
<h2>Evidence gaps</h2><div class="columns">${sides.map(side => `<section class="${side}"><h4>${side.toUpperCase()}</h4>${gaps(result.openings[side].gaps)}</section>`).join("")}</div>${result.gaps.length ? `<h3>Shared coverage gaps</h3>${gaps(result.gaps)}` : ""}
<h2>Sources and methodology</h2><p>Two roles of the same model review news separately, then respond to each other's claims. Agreement is not independent verification. This report includes every argument raised in this analysis; it does not cover every claim on the internet. No winner or price probabilities are produced.</p>
<p class="muted">ElevenLabs Agents · ${escape(result.model)} · ${result.usage.requests} conversations</p>${citations(result.sources)}
<p class="notice">Saved from the completed report shown in Santi-Core. No new analysis is run when downloading. All times above use Asia/Bangkok. This file can be read offline; source links require an internet connection.</p>
</main></body></html>`
}

export function downloadDebateReport(result: DebateResult) {
  const url = URL.createObjectURL(new Blob([buildDebateReportHtml(result)], { type: "text/html;charset=utf-8" }))
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = debateReportFilename(result)
  anchor.hidden = true
  // Links outside a native modal are inert, including temporary download links.
  const container = document.querySelector("dialog:modal") ?? document.body
  container.append(anchor)
  try { anchor.click() } finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}
