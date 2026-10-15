import { test } from "node:test"
import assert from "node:assert/strict"
import { startResourcePoller } from "./resource-poller.ts"

const settle = async () => { await Promise.resolve(); await Promise.resolve() }
function harness(run: (signal: AbortSignal) => Promise<void>) {
  let now = 0, connected = true, offline = false, id = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  const poller = startResourcePoller({
    interval: 60_000, run, now: () => now, online: () => connected,
    onOffline: (value) => { offline = value },
    schedule(callback, delay) {
      const timer = ++id
      timers.set(timer, { callback, at: now + delay })
      return timer
    },
    cancel(timer) { timers.delete(timer as number) },
  })
  return {
    poller, timers,
    offline: () => offline,
    connect(value: boolean) { connected = value },
    advance(delta: number) {
      now += delta
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.callback() }
      }
    },
  }
}

test("polling updates repeatedly, resumes overdue tabs and stops cleanly", async () => {
  let calls = 0, lastSignal: AbortSignal | undefined
  const h = harness(async (signal) => { calls++; lastSignal = signal })
  await settle()
  assert.equal(calls, 1)
  h.poller.resume()
  assert.equal(calls, 1)
  h.advance(60_000)
  await settle()
  assert.equal(calls, 2)
  // A suspended browser may advance time without running its pending timer.
  h.timers.clear()
  h.advance(120_000)
  h.poller.resume()
  await settle()
  assert.equal(calls, 3)
  h.poller.stop()
  assert.equal(h.timers.size, 0)
  assert.equal(lastSignal?.aborted, true)
  h.advance(60_000)
  h.poller.resume(true)
  assert.equal(calls, 3)
})

test("failed requests retry, offline pauses and reconnect checks immediately", async () => {
  let calls = 0, data = "last known price"
  const h = harness(async () => {
    calls++
    if (calls === 1) throw new Error("offline")
    data = "new price"
  })
  await settle()
  assert.equal(data, "last known price")
  h.connect(false)
  h.poller.offline()
  assert.equal(h.offline(), true)
  h.advance(120_000)
  assert.equal(calls, 1)
  h.connect(true)
  h.poller.resume(true)
  await settle()
  assert.equal(calls, 2)
  assert.equal(data, "new price")
  assert.equal(h.offline(), false)
  h.advance(60_000)
  await settle()
  assert.equal(calls, 3)
  h.poller.stop()
})

test("overlapping clicks and focus events share a request; reconnect is queued after it", async () => {
  let calls = 0, finish: (() => void) | undefined
  const h = harness(() => { calls++; return new Promise<void>(resolve => { finish = resolve }) })
  h.poller.refresh()
  h.poller.resume()
  assert.equal(calls, 1)
  h.connect(false)
  h.poller.offline()
  h.connect(true)
  h.poller.resume(true)
  assert.equal(h.offline(), false)
  assert.equal(calls, 1)
  finish!()
  await settle()
  h.advance(0)
  assert.equal(calls, 2)
  h.poller.stop()
  finish!()
  await settle()
  assert.equal(h.timers.size, 0)
})
