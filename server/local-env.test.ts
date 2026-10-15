import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { elevenlabsConfig, agentsConfig, tokenomistKey, localSourceReviewsEnabled } from "./local-env.ts"

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

test("full-feed background checks require local opt-in and are disabled on Vercel", () => {
  const root=mkdtempSync(path.join(tmpdir(),"santi-source-queue-"))
  const names=["LOCAL_SOURCE_REVIEW_ENABLED","VERCEL"],previous=names.map(name=>process.env[name])
  try {
    names.forEach(name=>{delete process.env[name]})
    assert.equal(localSourceReviewsEnabled(root),false)
    writeFileSync(path.join(root,".local.env"),"LOCAL_SOURCE_REVIEW_ENABLED=true\n")
    assert.equal(localSourceReviewsEnabled(root),true)
    process.env.LOCAL_SOURCE_REVIEW_ENABLED="false"
    assert.equal(localSourceReviewsEnabled(root),false)
    process.env.LOCAL_SOURCE_REVIEW_ENABLED="invalid"
    assert.throws(()=>localSourceReviewsEnabled(root),/must be true or false/)
    process.env.LOCAL_SOURCE_REVIEW_ENABLED="true";process.env.VERCEL="1"
    assert.equal(localSourceReviewsEnabled(root),false)
  } finally {
    names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i]})
    rmSync(root,{recursive:true})
  }
})

test("Agents config uses separate credentials and rejects models outside Gemini", () => {
 const root=mkdtempSync(path.join(tmpdir(),"santi-agents-env-"))
 const names=["ELEVENLABS_AGENTS_API_KEY","ELEVENLABS_AGENTS_MODEL","ELEVENLABS_BULL_AGENT_ID","ELEVENLABS_BEAR_AGENT_ID","ELEVENLABS_IMPACT_AGENT_ID","ELEVENLABS_RESEARCH_AGENT_ID","IMPACT_REVIEW_CONCURRENCY","IMPACT_REVIEW_BATCH_SIZE","IMPACT_ANALYSIS_THINKING_BUDGET","REFERENCE_CHECK_CONCURRENCY","REFERENCE_CHECK_TIMEOUT_MS"]
 const previous=names.map(name=>process.env[name])
 try {
  names.forEach(name=>{delete process.env[name]})
  assert.deepEqual(agentsConfig(root),{apiKey:"",model:"gemini-2.5-flash",bullAgentId:"",bearAgentId:"",impactReviewConcurrency:3,impactReviewBatchSize:4,impactThinkingBudget:1024,referenceCheckConcurrency:6,referenceCheckTimeoutMs:6000})
  writeFileSync(path.join(root,".local.env"),'ELEVENLABS_API_KEY=tts-only\nELEVENLABS_AGENTS_API_KEY=agents-only\nELEVENLABS_BULL_AGENT_ID=agent_bull\nELEVENLABS_BEAR_AGENT_ID=agent_bear\n')
  assert.equal(agentsConfig(root).apiKey,"agents-only")
  process.env.ELEVENLABS_RESEARCH_AGENT_ID="agent_research"
  assert.equal(agentsConfig(root).researchAgentId,"agent_research")
  process.env.ELEVENLABS_RESEARCH_AGENT_ID="https://invalid-agent"
  assert.throws(()=>agentsConfig(root),/Invalid ElevenLabs Agents/)
  delete process.env.ELEVENLABS_RESEARCH_AGENT_ID
  assert.equal(elevenlabsConfig(root).apiKey,process.env.ELEVENLABS_API_KEY?.trim()||"tts-only")
  process.env.ELEVENLABS_AGENTS_MODEL="unsupported-provider"
  assert.throws(()=>agentsConfig(root),/Invalid ElevenLabs Agents/)
 } finally {
  names.forEach((name,index)=>{if(previous[index]===undefined) delete process.env[name];else process.env[name]=previous[index]})
  rmSync(root,{recursive:true})
 }
})

test("impact task configuration is server-only, bounded and environment-overridable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "santi-impact-env-"))
  const names = ["IMPACT_REVIEW_CONCURRENCY", "IMPACT_REVIEW_BATCH_SIZE","IMPACT_ANALYSIS_THINKING_BUDGET","REFERENCE_CHECK_CONCURRENCY","REFERENCE_CHECK_TIMEOUT_MS"]
  const previous = names.map(name => process.env[name])
  try {
    names.forEach(name => { delete process.env[name] })
    writeFileSync(path.join(root, ".local.env"), "IMPACT_REVIEW_CONCURRENCY=2\nIMPACT_REVIEW_BATCH_SIZE=3\n")
    assert.equal(agentsConfig(root).impactReviewConcurrency, 2)
    assert.equal(agentsConfig(root).impactReviewBatchSize, 3)
    process.env.IMPACT_REVIEW_CONCURRENCY = "1"
    assert.equal(agentsConfig(root).impactReviewConcurrency, 1)
    for (const value of ["0", "4", "1.5", "invalid"]) {
      process.env.IMPACT_REVIEW_CONCURRENCY = value
      assert.throws(() => agentsConfig(root), /IMPACT_REVIEW_CONCURRENCY/)
    }
    process.env.IMPACT_REVIEW_CONCURRENCY = "3"
    process.env.IMPACT_REVIEW_BATCH_SIZE = "9"
    assert.throws(() => agentsConfig(root), /IMPACT_REVIEW_BATCH_SIZE/)
    process.env.IMPACT_REVIEW_BATCH_SIZE = "4"
    for (const [name, bad, good] of [["IMPACT_ANALYSIS_THINKING_BUDGET", "0", "1024"], ["REFERENCE_CHECK_CONCURRENCY", "13", "6"], ["REFERENCE_CHECK_TIMEOUT_MS", "999", "6000"]]) {
      process.env[name] = bad
      assert.throws(() => agentsConfig(root), new RegExp(name))
      process.env[name] = good
    }
    assert.equal(agentsConfig(root).impactThinkingBudget, 1024)
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index] })
    rmSync(root, { recursive: true })
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
