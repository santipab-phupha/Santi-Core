import { readFile, writeFile } from "node:fs/promises"
import { parseEnv } from "node:util"
import { fileURLToPath } from "node:url"
import { agentsConfig, elevenlabsConfig } from "../server/local-env.ts"
import { agentDefinition } from "../server/agent-definitions.ts"
const root = fileURLToPath(new URL("../", import.meta.url))
const config = agentsConfig(root)
if (!config.apiKey) throw new Error("Add ELEVENLABS_AGENTS_API_KEY before creating agents")
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/${path}`, { method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { "xi-api-key": config.apiKey, "Content-Type": "application/json" }, ...(body ? {body:JSON.stringify(body)} : {}) })
  if (!response.ok) throw new Error(`ElevenLabs setup failed (${response.status}) at ${path.split("?")[0]}. Check Agents permissions and model support.`)
  return response.json()
}
const catalog = await api("llm/list")
if (!catalog.llms?.some((item: {llm:string}) => item.llm === config.model)) throw new Error("Configured Gemini model unavailable; no fallback was used")
const existing = await api("agents?page_size=100")
for (const side of ["bull", "bear"] as const) {
  const envName = `ELEVENLABS_${side.toUpperCase()}_AGENT_ID`
  const voices = elevenlabsConfig(root)
  const definition = agentDefinition(side, config.model, side === "bull" ? voices.bullVoiceId : voices.bearVoiceId)
  const current = parseEnv(await readFile(`${root}/.local.env`, "utf8"))[envName]
  const named = existing.agents?.filter((agent: {name:string}) => agent.name === definition.name) || []
  if (!current && named.length > 1) throw new Error(`Multiple agents named ${definition.name}; choose an ID explicitly`)
  const agentId = current || named[0]?.agent_id || (await api("agents/create", "POST", definition)).agent_id
  if (typeof agentId !== "string" || !/^agent_[a-zA-Z0-9]+$/.test(agentId)) throw new Error("Invalid agent ID")
  // Save immediately so a partially completed setup can resume without duplicates.
  const path = `${root}/.local.env`
  const rows = (await readFile(path,"utf8")).split(/\r?\n/)
  const index = rows.findIndex(line => line.startsWith(`${envName}=`))
  if (index >= 0) rows[index] = `${envName}=${agentId}`; else rows.push(`${envName}=${agentId}`)
  await writeFile(path, rows.join("\n"), "utf8")
  const saved = await api(`agents/${agentId}`)
  if (saved.conversation_config?.agent?.prompt?.llm !== config.model || saved.conversation_config?.agent?.prompt?.backup_llm_config?.preference !== "disabled" || saved.conversation_config?.agent?.language !== "en" || !saved.conversation_config?.conversation?.text_only || !saved.platform_settings?.auth?.enable_auth)
    throw new Error(`Existing ${definition.name} configuration differs; no existing agent was overwritten`)
  console.log(`${definition.name}: ready · ${config.model} · authenticated text-only · backup disabled`)
}
