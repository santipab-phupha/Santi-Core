import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalReviewStore } from "./local-review-cache.ts"

test("local results persist across store restarts, but job locks and cooldowns do not", async () => {
  const directory = await mkdtemp(join(tmpdir(), "santi-impact-cache-"))
  try {
    const file = join(directory, "cache.json")
    const first = createLocalReviewStore(file)
    const result = { label: "positive", reason: "Confirmed reported mechanism" }
    await Promise.all([first.set("v2:hash:item-a", result, 60), first.set("v2:hash:item-b", { label: "neutral" }, 60)])
    await first.set("v2:hash:expired", result, -1)
    await first.set("v2:hash:job:bitcoin", { owner: "old-process" }, 260)
    await first.set("v2:hash:job:bitcoin:failed", true, 60)
    assert.equal((await first.get("v2:hash:job:bitcoin") as { owner: string }).owner, "old-process")
    const disk = await readFile(file, "utf8")
    assert.equal(disk.includes("job:"), false)
    const next = createLocalReviewStore(file)
    assert.deepEqual(await next.get("v2:hash:item-a"), result)
    assert.deepEqual(await next.get("v2:hash:item-b"), { label: "neutral" })
    assert.equal(await next.get("v2:hash:expired"), undefined)
    assert.equal(await next.get("v2:hash:job:bitcoin"), undefined)
    assert.equal(await next.get("v2:hash:job:bitcoin:failed"), undefined)
    await next.delete("v2:hash:item-a")
    assert.equal(await createLocalReviewStore(file).get("v2:hash:item-a"), undefined)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
