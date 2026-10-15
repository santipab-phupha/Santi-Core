import { test } from "node:test"
import assert from "node:assert/strict"
import { createAgentRunner } from "./eleven-agent.ts"
import type { AgentTask } from "./eleven-agent.ts"
import { agentDefinition } from "./agent-definitions.ts"
const config = {apiKey:"test-only-agents-secret",model:"gemini-2.5-flash",bullAgentId:"agent_bull",bearAgentId:"agent_bear"}
const definition = agentDefinition("bull",config.model,"")
const task = (patch: Partial<AgentTask> = {}): AgentTask => ({config,agentId:config.bullAgentId,prompt:"Research Bitcoin",kind:"submit_opening",signal:new AbortController().signal,readSource:async()=>({available:false}),...patch})
class MockSocket extends EventTarget {
  readyState=0
  sent: any[]=[]
  closed=false
  onSend:(value:any)=>void=()=>{}
  constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event("open"))})}
  send(raw:string){const value=JSON.parse(raw);this.sent.push(value);this.onSend(value)}
  message(value:unknown){this.dispatchEvent(new MessageEvent("message",{data:JSON.stringify(value)}))}
  close(){this.closed=true;this.readyState=3;this.dispatchEvent(new Event("close"))}
}
function provider(patch: any = {}) {
  return async (url: any, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("xi-api-key"),config.apiKey)
    assert.equal(init?.redirect,"error")
    assert.equal(new URL(String(url)).origin,"https://api.elevenlabs.io")
    return Response.json(String(url).includes("get-signed-url") ? {signed_url:"wss://api.elevenlabs.io/v1/convai/conversation?signature=test-only"} : {...definition,...patch})
  }
}
test("signed authenticated text session reads evidence and returns only the requested report tool",async()=>{
  let socket:MockSocket
  let reads=0
  const runner=createAgentRunner({fetcher:provider(),socketFactory:()=>{
    socket=new MockSocket()
    socket.onSend=value=>{
      if(value.type==="conversation_initiation_client_data") socket.message({type:"conversation_initiation_metadata"})
      if(value.type==="user_message") {socket.message({type:"ping",ping_event:{event_id:7}});socket.message({type:"client_tool_call",client_tool_call:{tool_name:"read_source",tool_call_id:"read1",parameters:{url:"https://example.org/source"}}})}
      if(value.type==="client_tool_result"&&value.tool_call_id==="read1") socket.message({type:"client_tool_call",client_tool_call:{tool_name:"submit_opening",tool_call_id:"submit1",parameters:{summary:"Evidence",claims:[],gaps:[]}}})
    }
    return socket as unknown as WebSocket
  }})
  const result=await runner(task({readSource:async url=>{reads++;assert.equal(url,"https://example.org/source");return {available:true,text:"Read source"}}}))
  assert.deepEqual(result,{summary:"Evidence",claims:[],gaps:[]})
  assert.equal(reads,1)
  assert.ok(socket!.sent.some(v=>v.type==="pong"&&v.event_id===7))
  assert.equal(JSON.stringify(socket!.sent).includes(config.apiKey),false)
  assert.equal(socket!.closed,true)
})
test("model changes, model cascading and audio mode are rejected before paid sessions",async()=>{
  for(const modify of [
    (d:any)=>{d.conversation_config.agent.prompt.llm="unsupported-provider"},
    (d:any)=>{d.conversation_config.agent.prompt.backup_llm_config={preference:"default"}},
    (d:any)=>{d.conversation_config.conversation.text_only=false},
    (d:any)=>{d.conversation_config.agent.language="th"},
  ]) {
    const d=structuredClone(definition);modify(d)
    let sockets=0
    const run=createAgentRunner({fetcher:provider(d),socketFactory:()=>{sockets++;throw new Error("must not connect")}})
    await assert.rejects(run(task()),{code:"unsafe_agent_config"})
    assert.equal(sockets,0)
  }
})

test("Research sessions search the feed, read sources and accept only the final answer tool",async()=>{
  let searches=0,reads=0
  const runner=createAgentRunner({fetcher:provider(),socketFactory:()=>{
    const socket=new MockSocket()
    socket.onSend=value=>{
      if(value.type==="conversation_initiation_client_data")socket.message({type:"conversation_initiation_metadata"})
      if(value.type==="user_message")socket.message({type:"client_tool_call",client_tool_call:{tool_name:"search_news",tool_call_id:"search",parameters:{query:"Bitcoin"}}})
      if(value.type==="client_tool_result"&&value.tool_call_id==="search")socket.message({type:"client_tool_call",client_tool_call:{tool_name:"read_source",tool_call_id:"read",parameters:{url:"https://www.coindesk.com/story"}}})
      if(value.type==="client_tool_result"&&value.tool_call_id==="read")socket.message({type:"client_tool_call",client_tool_call:{tool_name:"submit_answer",tool_call_id:"answer",parameters:{summary:"Source-grounded answer",sections:[],gaps:[]}}})
    }
    return socket as unknown as WebSocket
  }})
  const result=await runner(task({kind:"submit_answer",searchNews:async query=>{searches++;assert.equal(query,"Bitcoin");return {evidence:[]}},readSource:async()=>{reads++;return {available:true,text:"Article"}}}))
  assert.deepEqual(result,{summary:"Source-grounded answer",sections:[],gaps:[]})
  assert.equal(searches,1);assert.equal(reads,1)
})

test("impact reasoning budget must match hosted configuration before a paid conversation", async () => {
  for (const budget of [undefined, 512, 2048]) {
    const d = structuredClone(definition) as any
    d.conversation_config.agent.prompt.thinking_budget = budget
    let sockets = 0
    const run = createAgentRunner({ fetcher: provider(d), socketFactory: () => { sockets++; throw new Error("Must not start") } })
    await assert.rejects(run(task({ thinkingBudget: 1024 })), { code: "unsafe_agent_config" })
    assert.equal(sockets, 0)
  }
})

test("a prose-only completion gets one in-session submission reminder, never a new conversation", async () => {
  let sockets=0,turns=0
  const run=createAgentRunner({fetcher:provider(),socketFactory:()=>{
    sockets++
    const socket=new MockSocket()
    socket.onSend=value=>{
      if(value.type==="conversation_initiation_client_data")socket.message({type:"conversation_initiation_metadata"})
      if(value.type==="user_message"){
        turns++
        if(turns===1)socket.message({type:"agent_response",agent_response_event:{agent_response:"Unstructured prose"}})
        else {
          assert.match(value.text,/submit_answer exactly once/)
          socket.message({type:"client_tool_call",client_tool_call:{tool_name:"submit_answer",tool_call_id:"answer",parameters:{summary:"Structured answer",sections:[],gaps:[]}}})
        }
      }
    }
    return socket as unknown as WebSocket
  }})
  assert.deepEqual(await run(task({kind:"submit_answer"})),{summary:"Structured answer",sections:[],gaps:[]})
  assert.equal(sockets,1);assert.equal(turns,2)
})

test("repeated prose stops without retrying a paid session and abort clears the reminder", async () => {
  for(const cancel of [false,true]){
    let sockets=0,turns=0
    const controller=new AbortController()
    const run=createAgentRunner({fetcher:provider(),socketFactory:()=>{
      sockets++
      const socket=new MockSocket()
      socket.onSend=value=>{
        if(value.type==="conversation_initiation_client_data")socket.message({type:"conversation_initiation_metadata"})
        if(value.type==="user_message"){
          turns++;socket.message({type:"agent_response",agent_response_event:{agent_response:"Prose is not a report"}})
          if(cancel)controller.abort()
        }
      }
      return socket as unknown as WebSocket
    }})
    await assert.rejects(run(task({signal:controller.signal})),cancel?{name:"AbortError"}:{code:"incomplete_output"})
    assert.equal(sockets,1);assert.equal(turns,cancel?1:2)
  }
})
test("untrusted signed destinations, provider bodies, and retries cannot leak secrets",async()=>{
  let calls=0
  const run=createAgentRunner({fetcher:async()=>{calls++;return new Response("private-provider-secret",{status:403})}})
  await assert.rejects(run(task()),(error:any)=>error.code==="agents_unavailable"&&!error.message.includes("private-provider"))
  assert.equal(calls,1)
  const wrong=createAgentRunner({fetcher:async(url,init)=>String(url).includes("get-signed-url")?Response.json({signed_url:"wss://evil.example/conversation?signature=test"}):provider()(url,init),socketFactory:()=>{throw new Error("must not connect")}})
  await assert.rejects(wrong(task()),{code:"invalid_session"})
})
test("disconnect, abort, and unexpected tools never produce a completed report",async()=>{
  for(const mode of ["close","unexpected","abort"]){
    const controller=new AbortController()
    let socket:MockSocket
    const run=createAgentRunner({fetcher:provider(),socketFactory:()=>{
      socket=new MockSocket();socket.onSend=value=>{if(value.type==="conversation_initiation_client_data"){
        if(mode==="close")socket.close()
        if(mode==="abort")controller.abort()
        if(mode==="unexpected")socket.message({type:"client_tool_call",client_tool_call:{tool_name:"submit_rebuttal",tool_call_id:"wrong",parameters:{}}})
      }};return socket as unknown as WebSocket
    }})
    await assert.rejects(run(task({signal:controller.signal})))
    assert.equal(socket!.closed,true)
  }
})
test("hosted role definitions disable cascading and require authenticated text-only sessions",()=>{
  for(const side of ["bull","bear"] as const){
    const d=agentDefinition(side,config.model,"voiceTest")
    assert.equal(d.platform_settings.auth.enable_auth,true)
    assert.equal(d.platform_settings.analysis_llm,config.model)
    assert.equal(d.conversation_config.agent.prompt.backup_llm_config.preference,"disabled")
    assert.equal(d.conversation_config.conversation.text_only,true)
    assert.equal(d.conversation_config.agent.language,"en")
    assert.equal(d.conversation_config.agent.prompt.enable_parallel_tool_calls,false)
    assert.deepEqual(d.conversation_config.agent.prompt.tools.map(t=>t.name),["read_source","submit_opening","submit_rebuttal"])
  }
})
