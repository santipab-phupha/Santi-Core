import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { agentsConfig } from "../server/local-env.ts"
import { impactAnalystDefinition, localImpactAnalystName } from "../server/impact-agent-definition.ts"
const root = fileURLToPath(new URL("../", import.meta.url))
const config = agentsConfig(root)
if (!config.apiKey) throw new Error("Configure the ElevenLabs Agents key first")
async function api(route: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${route}`, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(`Local analyst setup failed (${response.status}); no production agent was changed`)
  return response.json()
}
const list = await api("agents?page_size=100")
const matches = list.agents?.filter((item: { name: string }) => item.name === localImpactAnalystName) ?? []
if (matches.length > 1) throw new Error("Multiple local impact analysts exist")
const definition = impactAnalystDefinition(config.model, config.impactThinkingBudget ?? 1024)
const id = matches[0]?.agent_id ?? (await api("agents/create", "POST", definition)).agent_id
if (!/^agent_[a-zA-Z0-9]+$/.test(id)) throw new Error("Invalid local analyst identifier")
if (matches.length && process.argv.includes("--update-local")) {
  const existing = await api(`agents/${id}`)
  if (existing.name !== localImpactAnalystName || !existing.tags?.includes("impact-analysis-local")) throw new Error("Only this app's dedicated local impact analyst can be updated")
  await api(`agents/${id}`, "PATCH", definition)
}
const saved = await api(`agents/${id}`)
const prompt = saved.conversation_config?.agent?.prompt
const fields = prompt?.tools?.find((tool: { name: string }) => tool.name === "submit_classification")?.parameters?.properties?.labels?.items?.required
if (prompt?.llm !== config.model || prompt?.thinking_budget !== (config.impactThinkingBudget ?? 1024) || prompt?.backup_llm_config?.preference !== "disabled" ||
  saved.conversation_config?.agent?.language !== "en" || saved.conversation_config?.agent?.first_message || !saved.conversation_config?.conversation?.text_only ||
  !saved.platform_settings?.auth?.enable_auth || !fields?.includes("label") || fields.includes("reference_ids"))
  throw new Error("Local analyst settings differ; rerun with --update-local to change only this dedicated local agent")
const file = new URL("../.local.env", import.meta.url)
const current = readFileSync(file, "utf8")
const line = `ELEVENLABS_IMPACT_AGENT_ID=${id}`
writeFileSync(file, /^ELEVENLABS_IMPACT_AGENT_ID=.*$/m.test(current) ? current.replace(/^ELEVENLABS_IMPACT_AGENT_ID=.*$/m, line) : `${current.trimEnd()}\n${line}\n`, "utf8")
console.log(`Local impact analyst ready: ${config.model}, thinking budget ${prompt.thinking_budget}; references use a separate non-LLM worker. Production agents unchanged.`)
