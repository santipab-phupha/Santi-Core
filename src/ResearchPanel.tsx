import { useEffect, useRef, useState } from "react"
import type { ResearchAnswer, ResearchMessage } from "./research-chat-types"
import { readResearchStream } from "./research-stream"
import "./research-chat.css"

type Run = { id: string; question: string; detail: string; answer?: ResearchAnswer; error?: string }
const levels = { headline: "Headline only", "publisher-summary": "Publisher summary", "article-excerpt": "Article excerpt read", "structured-data": "Provider data" }
function historyFor(runs: Run[]): ResearchMessage[] {
  return runs.filter(run => run.answer).slice(-5).flatMap(run => [
    { role: "user" as const, content: run.question.slice(0, 3000) },
    { role: "assistant" as const, content: [run.answer!.summary, ...run.answer!.sections.map(section => `${section.heading}: ${section.text}\n${section.references.map(ref => ref.url).join(" ")}`), ...run.answer!.gaps].join("\n").slice(0, 3000) },
  ])
}

export default function ResearchPanel({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: { id: number; question: string } | null }) {
  const [input, setInput] = useState("")
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const [configuration, setConfiguration] = useState<"loading" | "ready" | "unavailable">("loading")
  const [configError, setConfigError] = useState("")
  const request = useRef<AbortController | null>(null)
  const session = useRef(crypto.randomUUID())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { request.current?.abort(); request.current = null }, [])
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus({ preventScroll: true })
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch("/api/research/config", { signal: controller.signal, cache: "no-store" })
        if (!response.ok) throw new Error("Could not check the Research Agent connection. Reopen Research to retry.")
        const value = await response.json() as { configured: boolean }
        if (!controller.signal.aborted) { setConfiguration(value.configured ? "ready" : "unavailable"); setConfigError(value.configured ? "" : "The ElevenLabs Research Agent is not configured yet.") }
      } catch (cause) { if (!controller.signal.aborted) { setConfiguration("unavailable"); setConfigError(cause instanceof Error ? cause.message : "Research is unavailable.") } }
    })()
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => { controller.abort(); window.removeEventListener("keydown", onKey) }
  }, [open, onClose])
  useEffect(() => { if (seed) setInput(seed.question.slice(0, 4000)) }, [seed])
  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const lastRun = log.querySelector<HTMLElement>(".research-run:last-child")
    if (runs.at(-1)?.answer && lastRun) log.scrollTop += lastRun.getBoundingClientRect().top - log.getBoundingClientRect().top - 12
    else log.scrollTop = log.scrollHeight
  }, [runs])

  const submit = async (question = input.trim()) => {
    if (!question.trim() || request.current || configuration !== "ready") return
    const controller = new AbortController(), id = crypto.randomUUID()
    request.current = controller
    const history = historyFor(runs)
    setBusy(true); setInput("")
    setRuns(current => [...current, { id, question, detail: "Loading shared news and market data" }])
    const update = (value: Partial<Run>) => { if (request.current === controller) setRuns(current => current.map(run => run.id === id ? { ...run, ...value } : run)) }
    try {
      const response = await fetch("/api/research", { method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(190_000)]),
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history, sessionId: session.current, requestId: id }) })
      if (!response.ok) { const value = await response.json() as { error?: string }; throw new Error(value.error || "Research is temporarily unavailable.") }
      let answer: ResearchAnswer | undefined
      await readResearchStream(response, event => {
        if (event.type === "phase") update({ detail: event.detail || "Researching your question…" })
        if (event.type === "result") answer = event.answer
      })
      if (!answer) throw new Error("No completed answer was received.")
      update({ answer, detail: "Research complete" })
    } catch (cause) { update({ error: controller.signal.aborted ? "Research stopped." : cause instanceof Error ? cause.message : "Research could not complete." }) }
    finally { if (request.current === controller) { request.current = null; setBusy(false) } }
  }
  const newChat = () => { request.current?.abort(); request.current = null; session.current = crypto.randomUUID(); setBusy(false); setRuns([]); setInput(""); inputRef.current?.focus() }
  if (!open) return null
  return (
    <aside className="research-panel research-chat" role="dialog" aria-modal="false" aria-labelledby="research-title">
      <header className="research-panel-head">
        <span className="assistant-mark" aria-hidden="true">✦</span>
        <div><h2 id="research-title">Santi Research</h2><span>ElevenLabs Agents · Research chat</span></div>
        <button className="icon-button" onClick={onClose} aria-label="Close research">×</button>
      </header>
      <div className="research-chat-toolbar"><span>{configuration === "ready" ? "● Agent connected" : configuration === "loading" ? "Connecting…" : "Connection unavailable"}</span><button onClick={newChat}>New chat</button></div>
      <div className="research-messages" ref={logRef} role="log" aria-label="Research conversation" aria-relevant="additions">
        {!runs.length && <div className="assistant-welcome">
          <h3>What are you exploring?</h3>
          <p>Ask detailed questions or follow up on our news, market data and tokenomics. Answers include source links. Research covers the loaded feed, not a general web search.</p>
          <div className="suggestion-chips">{["What’s happening with Bitcoin?", "Explain the risks from upcoming token unlocks."].map(question => <button key={question} disabled={configuration !== "ready"} onClick={() => void submit(question)}>{question} <span aria-hidden="true">↗</span></button>)}</div>
        </div>}
        {configError && <p className="research-notice" role="alert">{configError}</p>}
        {runs.map(run => <div className="research-run" key={run.id}>
          <p className="user-question">{run.question}</p>
          {!run.answer && !run.error && <div className="research-chat-progress" role="status"><span className="step-spinner" aria-hidden="true" />{run.detail}</div>}
          {run.error && <div className="research-notice" role="alert">{run.error}<button disabled={busy || configuration !== "ready"} onClick={() => void submit(run.question)}>Retry question</button></div>}
          {run.answer && <article className="research-chat-answer">
            <p className="research-answer-summary">{run.answer.summary}</p>
            {run.answer.sections.map((section, index) => <section className="research-answer-section" key={index}>
              <h4>{section.heading}</h4><p>{section.text}</p>
              {section.references.length > 0 && <div className="research-answer-refs">{section.references.map(reference => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer" title={reference.title}><span>{reference.source} ↗</span><small>{levels[reference.level]} · {new Date(reference.publishedAt).toLocaleDateString("en-GB")}</small></a>)}</div>}
            </section>)}
            {run.answer.gaps.length > 0 && <details className="research-answer-gaps"><summary>Evidence limits · {run.answer.gaps.length}</summary>{run.answer.gaps.map((gap, i) => <p key={i}>{gap}</p>)}</details>}
            <small className="research-answer-time">ElevenLabs Agents · {new Date(run.answer.createdAt).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})}</small>
          </article>}
        </div>)}
      </div>
      <form className="research-composer" onSubmit={event => {event.preventDefault(); void submit()}}>
        {busy && <button className="research-stop" type="button" onClick={() => request.current?.abort()}>Stop research</button>}
        <label className="sr-only" htmlFor="research-question">Ask Santi Research</label>
        <div><textarea id="research-question" ref={inputRef} value={input} maxLength={4000} onChange={event => setInput(event.target.value)} onKeyDown={event => { if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit()} }} placeholder={runs.length ? "Ask a follow-up…" : "Ask about a coin, headline or tokenomics…"} rows={2}/>
          <button type="submit" disabled={busy || !input.trim() || configuration !== "ready"} aria-label="Send research question">↑</button></div>
        <small>{busy ? "Agent is reading sources. You can keep browsing." : "Remembers the last 5 completed exchanges · Shift+Enter for a new line"}</small>
      </form>
    </aside>
  )
}
