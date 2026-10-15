import type { DebateSide, DebateSource } from "./bear-bull-types"
export type VoiceProfile = {
  id: string
  name: string
}
export type AudioConfig = {
  configured: boolean
  ready: boolean
  model: string
  voices: VoiceProfile[]
  bullVoiceId: string
  bearVoiceId: string
}
export type AudioTurn = {
  id: string
  side: DebateSide
  title: string
  text: string
  sources: DebateSource[]
}
export type AudioManifest = {
  reportId: string
  coinName: string
  symbol: string
  createdAt: string
  characters: number
  turns: AudioTurn[]
}
