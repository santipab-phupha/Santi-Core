import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { agentsConfig } from "../server/local-env.ts"
import { researchAgentDefinition, researchAgentName, researchThinkingBudget } from "../server/research-agent-definition.ts"
const root = fileURLToPath(new URL("../", import.meta.url))
const config = agentsConfig(root)
if (!config.apiKey) throw new Error("Configure the ElevenLabs Agents API key first")
async function api(route: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${route}`, { method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error(`Research setup failed (${response.status}). No existing Bull/Bear agent was changed.`)
  return response.json()
}
const list = await api("agents?page_size=100")
const matches = list.agents?.filter((agent: { name: string }) => agent.name === researchAgentName) ?? []
if (matches.length > 1) throw new Error("Multiple local Research Agents exist")
const definition = researchAgentDefinition(config.model)
const id = matches[0]?.agent_id ?? (await api("agents/create", "POST", definition)).agent_id
if (!/^agent_[a-zA-Z0-9]+$/.test(id)) throw new Error("Invalid Research Agent identifier")
if (matches.length && process.argv.includes("--update-local")) {
  const current = await api(`agents/${id}`)
  if (current.name !== researchAgentName || !current.tags?.includes("research-chat-local")) throw new Error("Only this app's dedicated local Research Agent can be updated")
  await api(`agents/${id}`, "PATCH", definition)
}
const saved = await api(`agents/${id}`)
const prompt = saved.conversation_config?.agent?.prompt
const tools = prompt?.tools?.map((tool: { name: string }) => tool.name)
if (prompt?.llm !== config.model || prompt?.thinking_budget !== researchThinkingBudget || prompt?.backup_llm_config?.preference !== "disabled"
  || saved.conversation_config?.agent?.language !== "en" || saved.conversation_config?.agent?.first_message || !saved.conversation_config?.conversation?.text_only
  || !saved.platform_settings?.auth?.enable_auth || JSON.stringify(tools) !== JSON.stringify(["search_news", "read_source", "submit_answer"])) throw new Error("Research settings differ; rerun with --update-local for this dedicated agent")
const file = new URL("../.local.env", import.meta.url)
const current = readFileSync(file, "utf8")
const line = `ELEVENLABS_RESEARCH_AGENT_ID=${id}`
writeFileSync(file, /^ELEVENLABS_RESEARCH_AGENT_ID=.*$/m.test(current) ? current.replace(/^ELEVENLABS_RESEARCH_AGENT_ID=.*$/m, line) : `${current.trimEnd()}\n${line}\n`, "utf8")
console.log(`Research Agent connected locally: ${config.model}, text-only, source tools and follow-up context enabled.`)
