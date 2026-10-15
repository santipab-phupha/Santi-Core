import { agentsConfig } from "../server/local-env.ts"
import { impactAgentDefinition, impactAgentName } from "../server/impact-agent-definition.ts"
import { fileURLToPath } from "node:url"
const root = fileURLToPath(new URL("../", import.meta.url))
const config = agentsConfig(root)
if (!config.apiKey) throw new Error("Configure the server ElevenLabs Agents key first")
async function api(route: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${route}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(`Impact Agent setup failed (${response.status}); check Agents permissions`)
  return response.json()
}
const list = await api("agents?page_size=100")
const matches = list.agents?.filter((agent: { name: string }) => agent.name === impactAgentName) ?? []
if (matches.length > 1) throw new Error("Multiple impact reviewers exist; choose one explicitly")
const agentId = matches[0]?.agent_id ?? (await api("agents/create", "POST", impactAgentDefinition(config.model))).agent_id
if (matches.length && process.argv.includes("--update")) await api(`agents/${agentId}`, "PATCH", impactAgentDefinition(config.model))
const saved = await api(`agents/${agentId}`)
if (saved.conversation_config?.agent?.prompt?.llm !== config.model || saved.conversation_config?.agent?.language !== "en" || saved.conversation_config?.agent?.first_message || saved.conversation_config?.agent?.prompt?.backup_llm_config?.preference !== "disabled" || !saved.conversation_config?.conversation?.text_only || !saved.platform_settings?.auth?.enable_auth)
  throw new Error("Impact Reviewer configuration differs; no existing agent was overwritten")
console.log(`${impactAgentName}: ready, authenticated English text-only, ${config.model}`)
