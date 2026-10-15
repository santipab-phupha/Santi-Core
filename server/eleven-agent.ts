export type AgentsConfig = {
  apiKey: string
  model: string
  bullAgentId: string
  bearAgentId: string
}
export type AgentTask = {
  config: AgentsConfig
  agentId: string
  prompt: string
  kind: "submit_opening" | "submit_rebuttal" | "submit_classification"
  signal: AbortSignal
  readSource: (url: unknown) => Promise<unknown>
}
export class AgentError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}
const failure = (status: number) => new AgentError("agents_unavailable", ({
  401: "The ElevenLabs Agents API key is invalid.",
  403: "The ElevenLabs key does not have Agents access.",
  404: "The configured ElevenLabs agent was not found.",
  429: "ElevenLabs rate limit or insufficient credits. Please try again later.",
} as Record<number, string>)[status] || "Could not connect to ElevenLabs Agents.")
export function createAgentRunner({ fetcher = fetch, socketFactory = (url: string) => new WebSocket(url) }:
  { fetcher?: typeof fetch; socketFactory?: (url: string) => WebSocket } = {}) {
  async function request(config: AgentsConfig, path: string, signal: AbortSignal) {
    const response = await fetcher(`https://api.elevenlabs.io/v1/convai/${path}`, {
      headers: { "xi-api-key": config.apiKey }, redirect: "error", signal,
    })
    if (!response.ok) throw failure(response.status)
    const raw = await response.text()
    if (raw.length > 2_000_000) throw new AgentError("invalid_output", "The agent data exceeds the size limit.")
    return JSON.parse(raw)
  }
  return async function run(task: AgentTask): Promise<unknown> {
    const { config, agentId, kind, prompt, readSource } = task
    const signal = AbortSignal.any([task.signal, AbortSignal.timeout(120_000)])
    signal.throwIfAborted()
    // Check the hosted configuration before starting a billable conversation.
    const agent = await request(config, `agents/${encodeURIComponent(agentId)}`, signal)
    const settings = agent.conversation_config
    if (!/^gemini-[a-zA-Z0-9.-]+$/.test(config.model) || settings?.agent?.prompt?.llm !== config.model ||
      settings?.agent?.prompt?.backup_llm_config?.preference !== "disabled" ||
      settings?.conversation?.text_only !== true || settings?.agent?.language !== "en" || settings?.agent?.first_message) {
      throw new AgentError("unsafe_agent_config", "The agent must use the configured Gemini model, English, text-only mode and disabled backup models before analysis.")
    }
    const signed = await request(config, `conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, signal)
    const url = new URL(signed.signed_url)
    if (url.protocol !== "wss:" || url.hostname !== "api.elevenlabs.io" || url.port || url.username || url.password || url.pathname !== "/v1/convai/conversation")
      throw new AgentError("invalid_session", "ElevenLabs returned an invalid conversation address.")
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const socket = socketFactory(url.href)
      let settled = false
      let started = false
      let reading = false
      let reads = 0
      let size = 0
      const calls = new Set<string>()
      function finish(error?: unknown, value?: unknown) {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", abort)
        try { socket.close(1000, "Task finished") } catch { /* connection not established */ }
        if (error) reject(error); else resolve(value)
      }
      function abort() { finish(signal.reason) }
      function send(value: unknown) { if (!settled && socket.readyState === 1) socket.send(JSON.stringify(value)) }
      signal.addEventListener("abort", abort, { once: true })
      socket.addEventListener("open", () => send({ type: "conversation_initiation_client_data" }))
      socket.addEventListener("error", () => finish(new AgentError("agents_unavailable", "The ElevenLabs Agents connection failed.")))
      socket.addEventListener("close", () => finish(new AgentError("incomplete_output", "The agent closed the conversation before completing its report. No final result was produced.")))
      socket.addEventListener("message", (event) => {
        void (async () => {
          if (settled) return
          if (typeof event.data !== "string" || (size += event.data.length) > 2_000_000) throw new AgentError("invalid_output", "The conversation exceeds the size limit.")
          const data = JSON.parse(event.data)
          if (data.type === "ping") send({ type: "pong", event_id: data.ping_event?.event_id })
          if (data.type === "conversation_initiation_metadata" && !started) {
            started = true
            send({ type: "user_message", text: prompt })
          }
          if (data.type === "error") throw new AgentError("agents_unavailable", "ElevenLabs Agents could not complete this task. Check permissions, the model and account credits.")
          if (data.type !== "client_tool_call") return
          const call = data.client_tool_call
          if (!call || typeof call.tool_call_id !== "string" || calls.has(call.tool_call_id)) throw new AgentError("invalid_output", "The agent returned a duplicate or invalid tool call.")
          calls.add(call.tool_call_id)
          if (calls.size > 8) throw new AgentError("tool_limit", "The agent exceeded the tool-call limit for this task.")
          if (call.tool_name === kind) {
            if (reading) throw new AgentError("incomplete_output", "The agent submitted its report before finishing the evidence read.")
            send({ type: "client_tool_result", tool_call_id: call.tool_call_id, result: "Report received. Task complete.", is_error: false })
            finish(undefined, call.parameters)
          } else if (call.tool_name === "read_source" && kind === "submit_opening") {
            if (reading || ++reads > 3) throw new AgentError("tool_limit", "Read one source at a time, up to three sources per side.")
            reading = true
            const result = await readSource(call.parameters?.url)
            reading = false
            send({ type: "client_tool_result", tool_call_id: call.tool_call_id, result: JSON.stringify(result), is_error: false })
          } else throw new AgentError("unexpected_tool", "The agent called a tool outside this stage. Analysis stopped.")
        })().catch((error) => finish(error))
      })
      if (signal.aborted) abort()
    })
  }
}
