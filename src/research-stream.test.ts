import { test } from "node:test"
import assert from "node:assert/strict"
import { readResearchStream } from "./research-stream.ts"

test("research streams preserve split UTF-8 and require a completed answer",async()=>{
  const raw=JSON.stringify({type:"result",answer:{summary:"Bitcoin • ข่าว",sections:[]}})
  const encoded=new TextEncoder().encode(raw)
  const stream=new ReadableStream({start(controller){for(const byte of encoded)controller.enqueue(Uint8Array.of(byte));controller.close()}})
  const values:unknown[]=[]
  await readResearchStream(new Response(stream),event=>values.push(event))
  assert.deepEqual(values,[JSON.parse(raw)])
  await assert.rejects(readResearchStream(new Response('{"type":"heartbeat"}\n'),()=>{}),/interrupted/)
  await assert.rejects(readResearchStream(new Response('{"type":"error","message":"Provider unavailable"}\n'),()=>{}),/Provider unavailable/)
})
