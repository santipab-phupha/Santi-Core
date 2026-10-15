import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { elevenlabsConfig, agentsConfig, tokenomistKey } from "./local-env.ts"

test("server reads the exact local filename, supports quoted keys and environment overrides", () => {
  const root = mkdtempSync(path.join(tmpdir(), "santi-env-"))
  const previous = process.env.TOKENOMIST_API_KEY
  try {
    delete process.env.TOKENOMIST_API_KEY
    assert.equal(tokenomistKey(root), "")
    writeFileSync(path.join(root, ".local.env"), 'TOKENOMIST_API_KEY="test-only-key"\n')
    assert.equal(tokenomistKey(root), "test-only-key")
    process.env.TOKENOMIST_API_KEY = "environment-test-key"
    assert.equal(tokenomistKey(root), "environment-test-key")
  } finally {
    if (previous === undefined) delete process.env.TOKENOMIST_API_KEY
    else process.env.TOKENOMIST_API_KEY = previous
    rmSync(root, { recursive: true })
  }
})

test("Agents config uses separate credentials and rejects models outside Gemini", () => {
 const root=mkdtempSync(path.join(tmpdir(),"santi-agents-env-"))
 const names=["ELEVENLABS_AGENTS_API_KEY","ELEVENLABS_AGENTS_MODEL","ELEVENLABS_BULL_AGENT_ID","ELEVENLABS_BEAR_AGENT_ID"]
 const previous=names.map(name=>process.env[name])
 try {
  names.forEach(name=>{delete process.env[name]})
  assert.deepEqual(agentsConfig(root),{apiKey:"",model:"gemini-2.5-flash",bullAgentId:"",bearAgentId:""})
  writeFileSync(path.join(root,".local.env"),'ELEVENLABS_API_KEY=tts-only\nELEVENLABS_AGENTS_API_KEY=agents-only\nELEVENLABS_BULL_AGENT_ID=agent_bull\nELEVENLABS_BEAR_AGENT_ID=agent_bear\n')
  assert.equal(agentsConfig(root).apiKey,"agents-only")
  assert.equal(elevenlabsConfig(root).apiKey,process.env.ELEVENLABS_API_KEY?.trim()||"tts-only")
  process.env.ELEVENLABS_AGENTS_MODEL="unsupported-provider"
  assert.throws(()=>agentsConfig(root),/Invalid ElevenLabs Agents/)
 } finally {
  names.forEach((name,index)=>{if(previous[index]===undefined) delete process.env[name];else process.env[name]=previous[index]})
  rmSync(root,{recursive:true})
 }
})

test("ElevenLabs config defaults and existing research credentials remain separate", () => {
  const root = mkdtempSync(path.join(tmpdir(), "santi-eleven-env-"))
  const names = ["ELEVENLABS_API_KEY", "ELEVENLABS_MODEL", "ELEVENLABS_BULL_VOICE_ID", "ELEVENLABS_BEAR_VOICE_ID"]
  const previous = names.map((name) => process.env[name])
  try {
    names.forEach((name) => { delete process.env[name] })
    assert.deepEqual(elevenlabsConfig(root), { apiKey: "", model: "eleven_v3", bullVoiceId: "", bearVoiceId: "" })
    writeFileSync(path.join(root, ".local.env"), 'ELEVENLABS_API_KEY="test-placeholder"\nELEVENLABS_BULL_VOICE_ID=bullTest\nELEVENLABS_BEAR_VOICE_ID=bearTest\nTOKENOMIST_API_KEY=separate-test-value\n')
    assert.equal(elevenlabsConfig(root).bullVoiceId, "bullTest")
    assert.equal(elevenlabsConfig(root).apiKey, "test-placeholder")
    process.env.ELEVENLABS_API_KEY = "environment-placeholder"
    assert.equal(elevenlabsConfig(root).apiKey, "environment-placeholder")
    process.env.ELEVENLABS_MODEL = "invalid/endpoint"
    assert.throws(() => elevenlabsConfig(root), /Invalid ElevenLabs/)
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index] })
    rmSync(root, { recursive: true })
  }
})
