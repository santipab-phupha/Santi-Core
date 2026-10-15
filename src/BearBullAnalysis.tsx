import { useEffect, useRef, useState } from "react"
import type { MarketCoin } from "./data-types"
import type {
  DebateConfig,
  DebateEvent,
  DebateOpening,
  DebatePhase,
  DebateResult,
  DebateSide,
  DebateSource,
} from "./bear-bull-types"
import { readDebateStream } from "./debate-stream"
import AgentAvatar from "./AgentAvatar"
import DebateAudio from "./DebateAudio"
import "./bear-bull.css"

const sides: DebateSide[] = ["bull", "bear"]
const phases: DebatePhase[] = ["context", "research", "debate", "complete"]
const phaseNames = {
  context: "Gather data",
  research: "Review evidence",
  debate: "Cross-examine",
  complete: "Complete",
}
const positions = {
  challenge: "Challenged",
  concede: "Conceded",
  uncertain: "Insufficient evidence",
}
type AgentState = {
  task: "research" | "debate"
  status: "waiting" | "running" | "done"
}
type ViewState = {
  status: "checking" | "setup" | "running" | "complete" | "error" | "cancelled"
  phase: DebatePhase
  agents: Record<DebateSide, AgentState>
  openings: Partial<Record<DebateSide, DebateOpening>>
  result?: DebateResult
  config?: DebateConfig
  cached: boolean
  message: string
}
const initial = (): ViewState => ({
  status: "checking",
  phase: "context",
  openings: {},
  cached: false,
  message: "",
  agents: {
    bull: { task: "research", status: "waiting" },
    bear: { task: "research", status: "waiting" },
  },
})
function update(state: ViewState, event: DebateEvent): ViewState {
  if (event.type === "phase") return { ...state, phase: event.phase }
  if (event.type === "agent")
    return {
      ...state,
      agents: {
        ...state.agents,
        [event.side]: { task: event.task, status: event.status },
      },
    }
  if (event.type === "opening")
    return {
      ...state,
      openings: { ...state.openings, [event.opening.side]: event.opening },
    }
  if (event.type === "result")
    return {
      ...state,
      status: "complete",
      phase: "complete",
      result: event.result,
      cached: event.cached,
      openings: event.result.openings,
      agents: {
        bull: { task: "debate", status: "done" },
        bear: { task: "debate", status: "done" },
      },
    }
  return state
}
function Citations({ sources }: { sources: DebateSource[] }) {
  return (
    <div className="debate-citations">
      {sources.map((source, index) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.title}
        >
          [{index + 1}] {new URL(source.url).hostname.replace(/^www\./, "")} ↗
        </a>
      ))}
    </div>
  )
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value))
}

export default function BearBullAnalysis({ coin }: { coin: MarketCoin }) {
  const [state, setState] = useState<ViewState>(initial)
  const [attempt, setAttempt] = useState(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    active.current = controller
    setState(initial())
    async function run() {
      try {
        const configResponse = await fetch("/api/analysis/config", {
          signal: controller.signal,
          cache: "no-store",
        })
        if (!configResponse.ok)
          throw new Error("Could not read ElevenLabs Agents settings. Check the server and try again.")
        const config = (await configResponse.json()) as DebateConfig
        if (controller.signal.aborted) return
        setState((value) => ({
          ...value,
          config,
          status: config.configured ? "running" : "setup",
        }))
        if (!config.configured) return
        const response = await fetch("/api/analysis", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coinId: coin.id }),
        })
        if (!response.ok) {
          const failure = (await response.json().catch(() => ({}))) as {
            error?: string
          }
          throw new Error(failure.error || "Could not start the analysis. Please try again later.")
        }
        await readDebateStream(response, (event) => {
          if (!controller.signal.aborted && event.type !== "heartbeat")
            setState((value) => update(value, event))
        })
      } catch (error) {
        if (!controller.signal.aborted)
          setState((value) => ({
            ...value,
            status: "error",
            message:
              error instanceof Error ? error.message : "Analysis failed.",
          }))
      }
    }
    void run()
    return () => {
      controller.abort()
      if (active.current === controller) active.current = null
    }
  }, [coin.id, attempt])
  const running = state.status === "running" || state.status === "checking"
  const progress =
    state.status === "complete"
      ? 100
      : state.phase === "debate"
        ? 70
        : state.phase === "research"
          ? 30
          : 8
  const result = state.result
  const disputes = result
    ? sides.flatMap((side) =>
        result.openings[side].claims.map((claim) => ({
          side,
          claim,
          opponent: side === "bull" ? "bear" as const : "bull" as const,
          reply: result.rebuttals[
            side === "bull" ? "bear" : "bull"
          ].replies.find((reply) => reply.claimId === claim.id)!,
        })),
      )
    : []

  return (
    <section className="debate-page" aria-labelledby="debate-title">
      <header className="debate-heading">
        <div>
          <h2 id="debate-title">Analysis by Bear/Bull</h2>
        </div>
        <div className="debate-actions">
          {running ? (
            <button
              onClick={() => {
                active.current?.abort()
                setState((value) => ({
                  ...value,
                  status: "cancelled",
                  message: "Analysis stopped. Interim results are incomplete.",
                }))
              }}
            >
              Stop analysis
            </button>
          ) : (
            <button onClick={() => setAttempt((value) => value + 1)}>
              {state.status === "setup" ? "Check connection" : "Start again"} ↗
            </button>
          )}
        </div>
      </header>
      {running && <div className="debate-loader" role="status" aria-live="polite">
        <div className="debate-loader-art" aria-hidden="true">
          <span className="debate-loader-ring" /><span className="debate-loader-ring inner" />
          <span className="debate-loader-center"><svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v7h4v-7H4Zm16 0h1v7h-4v-7h3ZM17 20c0 2-3 2-5 2" /></svg></span>
          <div className="debate-loader-orbit"><span className="debate-loader-avatar bull"><AgentAvatar side="bull" /></span><span className="debate-loader-avatar bear"><AgentAvatar side="bear" /></span></div>
        </div>
        <h3>{state.status === "checking" ? "Connecting your agents…" : state.phase === "debate" ? "Putting both sides to the test…" : "Following the evidence…"}</h3>
        <p>{state.status === "checking" ? "Preparing your research session." : `${phaseNames[state.phase]} · ${coin.name}`}</p>
      </div>}
      {!result && <div
        className={`debate-arena ${running ? "is-working" : "is-idle"}`}
        aria-busy={running}
      >
        <div className="debate-connection" aria-hidden="true">
          <i />
          <span>×</span>
          <i />
        </div>
        {sides.map((side) => (
          <article
            className={`debate-agent ${side} ${state.agents[side].status}`}
            key={side}
          >
            <div className="agent-orb">
              <span className="agent-orbit" />
              <AgentAvatar side={side} />
            </div>
            <span className="agent-role">
              {side === "bull" ? "THE UPSIDE" : "THE DOWNSIDE"}
            </span>
            <h2>
              {side === "bull" ? "Bull" : "Bear"} <span>Agent</span>
            </h2>
            <p>
              {side === "bull"
                ? "Examines positive drivers and tests the upside case."
                : "Examines risks and tests the downside case."}
            </p>
            <div className="agent-task" role="status">
              <i />
              {state.status === "setup"
                ? "Awaiting setup"
                : state.status === "checking"
                  ? "Checking settings…"
                  : state.status === "error" || state.status === "cancelled"
                    ? "Stopped"
                    : state.status === "complete"
                      ? "Responses complete"
                      : state.agents[side].status === "running"
                        ? state.agents[side].task === "research"
                          ? "Reading news and reviewing evidence…"
                          : "Responding to each opposing claim…"
                        : state.openings[side]
                          ? `${state.openings[side]!.claims.length} claims ready`
                          : "Awaiting data"}
            </div>
            {state.openings[side] && (
              <p className="agent-thesis">{state.openings[side]!.summary}</p>
            )}
          </article>
        ))}
      </div>}
      {state.status === "setup" ? (
        <div className="debate-setup" role="status">
          <div className="setup-symbol">⌁</div>
          <div>
            <h2>Connect ElevenLabs Agents</h2>
            <p>
              Add the server settings in <code>.local.env</code> and check the connection again.
            </p>
            <pre>
              ELEVENLABS_AGENTS_API_KEY=…{"\n"}ELEVENLABS_BULL_AGENT_ID=…{"\n"}
              ELEVENLABS_BEAR_AGENT_ID=…
            </pre>
            <small>Analysis is available once both agents are configured.</small>
          </div>
        </div>
      ) : state.status === "error" || state.status === "cancelled" ? (
        <div className="debate-error" role="alert">
          <h2>
            {state.status === "cancelled"
              ? "Analysis stopped"
              : "Analysis incomplete"}
          </h2>
          <p>{state.message}</p>
        </div>
      ) : (
        <div className="debate-progress">
          <div
            className="debate-progress-track"
            role="progressbar"
            aria-label="Analysis progress"
            aria-valuetext={
              state.status === "checking"
                ? "Checking settings"
                : phaseNames[state.phase]
            }
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <ol>
            {phases.map((phase, index) => (
              <li
                key={phase}
                className={index <= phases.indexOf(state.phase) ? "active" : ""}
              >
                <b>
                  {state.status === "complete" ||
                  index < phases.indexOf(state.phase)
                    ? "✓"
                    : `0${index + 1}`}
                </b>
                {phaseNames[phase]}
              </li>
            ))}
          </ol>
        </div>
      )}
      {!result && sides.some((side) => state.openings[side]) && (
        <section className="debate-preliminary">
          <h2>Preliminary claims</h2>
          <p>Awaiting responses to every opposing claim.</p>
          <div className="debate-opening-grid">
            {sides.map(
              (side) =>
                state.openings[side] && (
                  <div key={side} className={side}>
                    <h3>{side.toUpperCase()}</h3>
                    {state.openings[side]!.claims.map((claim) => (
                      <article key={claim.id}>
                        <h4>{claim.title}</h4>
                        <p>{claim.argument}</p>
                        <Citations sources={claim.sources} />
                      </article>
                    ))}
                  </div>
                ),
            )}
          </div>
        </section>
      )}
      {result && <DebateAudio report={result} embedded />}
      {result && (
        <section className="debate-results" aria-labelledby="disputes-title">
          <div className="debate-results-heading">
            <div>
              <span className="debate-kicker">THE CROSS-EXAMINATION</span>
              <h2 id="disputes-title">
                All arguments <span>{disputes.length}</span>
              </h2>
            </div>
            <p>
              {state.cached ? "Cached report · " : "Analyzed "}
              {dateTime(result.createdAt)} ICT
            </p>
          </div>
          <div className="debate-totals">
            {Object.entries(positions).map(([key, label]) => (
              <span key={key} className={key}>
                {label}{" "}
                <b>
                  {
                    disputes.filter((item) => item.reply.position === key)
                      .length
                  }
                </b>
              </span>
            ))}
          </div>
          {!disputes.length && (
            <p className="debate-no-evidence">
              Neither side has enough evidence to make a sourced claim.
            </p>
          )}
          <div className="debate-disputes">
            {disputes.map(({ side, claim, opponent, reply }, index) => (
              <article className="debate-dispute" key={claim.id}>
                <header>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{claim.title}</h3>
                  <b className={reply.position}>{positions[reply.position]}</b>
                </header>
                <div className="dispute-columns">
                  <div className={side}>
                    <span className="dispute-side">
                      {side.toUpperCase()} · Claim
                    </span>
                    <p>{claim.argument}</p>
                    <Citations sources={claim.sources} />
                    <small>{claim.caveat}</small>
                  </div>
                  <div className={opponent}>
                    <span className="dispute-side">
                      {opponent.toUpperCase()} · Response
                    </span>
                    <p>{reply.argument}</p>
                    <Citations sources={reply.sources} />
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="debate-gaps">
            {sides.map((side) => (
              <div key={side}>
                <h3>{side.toUpperCase()} · Evidence gaps</h3>
                {result.openings[side].gaps.length ? (
                  result.openings[side].gaps.map((gap, index) => (
                    <p key={index}>{gap}</p>
                  ))
                ) : (
                  <p>No additional gaps reported.</p>
                )}
              </div>
            ))}
          </div>
          <details className="debate-method">
            <summary>Sources and methodology</summary>
            <p>
              Two roles of the same model review news and articles separately before reading each other's claims.
              Agreement is not independent verification. The table includes every argument raised in this report.
              It does not cover every claim on the internet.
              No winner or price probabilities are produced.
            </p>
            <p>
              ElevenLabs Agents · {result.model} ·{" "}
              {result.usage.requests} conversations · Market data {" "}
              {dateTime(result.dataAt)} ICT
            </p>
            {result.gaps.map((gap, index) => (
              <p key={index}>{gap}</p>
            ))}
            <Citations sources={result.sources} />
          </details>
        </section>
      )}
      {!result && (
        <p className="debate-footnote">
          Bull and Bear are two roles of the same model.
          Only summaries and evidence with verified source links are shown.
          {state.config
            ? ` · ElevenLabs Agents / ${state.config.model}`
            : ""}
        </p>
      )}
    </section>
  )
}
