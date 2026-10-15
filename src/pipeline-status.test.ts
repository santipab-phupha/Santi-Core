import { test } from "node:test"
import assert from "node:assert/strict"
import { pipelineNodes } from "./pipeline-status.ts"
import type { FeedActivity, ImpactActivity } from "./pipeline-status"
import type { SourceQueueStatus } from "./news-review-types"

const feed: FeedActivity = { loading: false, offline: false, error: "", stale: false, checkedAt: 100_000, count: 112 }
const queue: SourceQueueStatus = { enabled: true, running: false, total: 12, checked: 12, matched: 10, unverified: 2, pending: 0, failed: 0, updatedAt: "2026-10-16T00:00:00Z" }
const impact: ImpactActivity = { coinId: "bitcoin", enabled: true, busy: false, error: "", reviewed: 5, pending: 0 }

test("countdown reaching a full circle never invents a running fetch or repeats an AI review", () => {
  const half = pipelineNodes(feed, queue, "", impact, "BTC", 130_000)
  assert.equal(half[0].label, "Next 30s")
  assert.equal(half[0].progress, .5)
  assert.deepEqual(half.map(node => node.state), ["idle", "idle", "idle"])
  const due = pipelineNodes(feed, queue, "", impact, "BTC", 170_000)
  assert.equal(due[0].label, "Refresh due")
  assert.equal(due[0].state, "idle")
  assert.equal(due[0].progress, 1)
  assert.equal(due[2].label, "Reviewed")
  assert.equal(pipelineNodes({ ...feed, loading: true }, queue, "", impact, "BTC", 170_000)[0].state, "running")
})

test("running, queued, missing, interrupted and offline states preserve actual worker coverage", () => {
  const running = pipelineNodes(feed, { ...queue, running: true, checked: 6, pending: 6 }, "", { ...impact, busy: true, reviewed: 2, pending: 3 }, "BTC", 100_000)
  assert.equal(running[1].state, "running")
  assert.equal(running[1].progress, .5)
  assert.equal(running[2].state, "running")
  assert.equal(running[2].progress, .4)
  const waiting = pipelineNodes({ ...feed, offline: true }, { ...queue, checked: 6, pending: 6 }, "", { ...impact, pending: 3 }, "ETH", 200_000)
  assert.equal(waiting[0].state, "paused")
  assert.equal(waiting[1].state, "idle")
  assert.equal(waiting[1].label, "6 queued")
  assert.equal(waiting[2].label, "3 pending")
  assert.ok(waiting[2].detail.startsWith("ETH"))
  const missing = pipelineNodes({ ...feed, checkedAt: null }, undefined, "", null, "asset", 200_000)
  assert.ok(missing.every(node => node.state === "idle" && node.progress === 0))
  assert.equal(missing[2].label, "Waiting for data")
  const failed = pipelineNodes({ ...feed, error: "Network unavailable" }, undefined, "Source statuses unavailable", { ...impact, error: "Review failed" }, "BTC", 200_000)
  assert.deepEqual(failed.map(node => node.state), ["error", "error", "error"])
})
