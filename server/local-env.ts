import { readFileSync } from "node:fs"
import path from "node:path"
import { parseEnv } from "node:util"

// Read only on the server. Never merge this file into Vite's client environment.
export function tokenomistKey(root: string): string {
  const inherited = process.env.TOKENOMIST_API_KEY?.trim()
  if (inherited) return inherited
  try {
    return parseEnv(readFileSync(path.join(root, ".local.env"), "utf8"))
      .TOKENOMIST_API_KEY?.trim() ?? ""
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""
    throw new Error("Cannot read local API configuration")
  }
}

export function elevenlabsConfig(root: string) {
  let local: Record<string, string | undefined> = {}
  try {
    local = parseEnv(readFileSync(path.join(root, ".local.env"), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read local audio configuration")
  }
  const value = (name: string) => process.env[name]?.trim() || local[name]?.trim() || ""
  const model = value("ELEVENLABS_MODEL") || "eleven_v3"
  const bullVoiceId = value("ELEVENLABS_BULL_VOICE_ID")
  const bearVoiceId = value("ELEVENLABS_BEAR_VOICE_ID")
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(model) || [bullVoiceId, bearVoiceId].some((id) => id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error("Invalid ElevenLabs configuration")
  return { apiKey: value("ELEVENLABS_API_KEY"), model, bullVoiceId, bearVoiceId }
}

export function agentsConfig(root: string) {
  let local: Record<string,string|undefined> = {}
  try { local = parseEnv(readFileSync(path.join(root,".local.env"),"utf8")) }
  catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read local Agents configuration") }
  const value = (name:string) => process.env[name]?.trim() || local[name]?.trim() || ""
  const model = value("ELEVENLABS_AGENTS_MODEL") || "gemini-2.5-flash"
  const bullAgentId = value("ELEVENLABS_BULL_AGENT_ID")
  const bearAgentId = value("ELEVENLABS_BEAR_AGENT_ID")
  if (!/^gemini-[a-zA-Z0-9.-]{1,80}$/.test(model) || [bullAgentId,bearAgentId].some(id=>id&&!/^agent_[a-zA-Z0-9]{1,100}$/.test(id))) throw new Error("Invalid ElevenLabs Agents configuration")
  return {apiKey:value("ELEVENLABS_AGENTS_API_KEY"),model,bullAgentId,bearAgentId}
}
