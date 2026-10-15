import { test } from "node:test"
import assert from "node:assert/strict"
import { readDebateStream } from "./debate-stream.ts"
import type { DebateEvent } from "./bear-bull-types"

function chunks(text: string) {
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 2)
          controller.enqueue(bytes.slice(i, i + 2))
        controller.close()
      },
    }),
  )
}
test("NDJSON preserves split UTF-8, several events and a final line without newline", async () => {
  const events: DebateEvent[] = []
  await readDebateStream(
    chunks(
      '{"type":"opening","opening":{"summary":"หลักฐาน"}}\n\n{"type":"heartbeat"}\n{"type":"result","cached":false}',
    ),
    (event) => events.push(event),
  )
  assert.equal(events.length, 3)
  assert.equal(
    events[0].type === "opening" && events[0].opening.summary,
    "หลักฐาน",
  )
})
test("truncated connections and provider errors never mark the stream completed", async () => {
  await assert.rejects(
    readDebateStream(chunks('{"type":"phase","phase":"research"}\n'), () => {}),
    /before the agents completed/,
  )
  await assert.rejects(
    readDebateStream(
      chunks(
        '{"type":"error","message":"quota unavailable","code":"agents_unavailable"}\n',
      ),
      () => {},
    ),
    /quota unavailable/,
  )
  await assert.rejects(
    readDebateStream(chunks("bad-json\n"), () => {}),
    /interrupted/,
  )
})
