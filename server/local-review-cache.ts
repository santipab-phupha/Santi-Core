import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { ReviewStore } from "./impact-review"

type Entry = { value: unknown; until: number }

// Local development has no Vercel Runtime Cache. Persist successful item results
// across restarts; short-lived job leases and failure cooldowns stay in memory.
export function createLocalReviewStore(file: string): ReviewStore {
  const entries = new Map<string, Entry>()
  const jobs = new Map<string, Entry>()
  let writes: Promise<void> = Promise.resolve()
  const loaded = (async () => {
    try {
      const raw = await readFile(file, "utf8")
      if (raw.length > 4_000_000) throw new Error("Cache exceeds limit")
      const data = JSON.parse(raw)
      if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error("Invalid cache")
      for (const pair of data.entries.slice(-600)) {
        if (!Array.isArray(pair) || pair.length !== 2) continue
        const [key, entry] = pair
        if (typeof key === "string" && !key.includes(":job:") && entry &&
          Number.isFinite(entry.until) && entry.until > Date.now()) entries.set(key, entry)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Local impact cache could not be read; expired or invalid results will be reviewed on request.")
    }
  })()
  async function persist() {
    const save = writes.catch(() => {}).then(async () => {
      for (const [key, entry] of entries) if (entry.until <= Date.now()) entries.delete(key)
      while (entries.size > 600) entries.delete(entries.keys().next().value!)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, entries: [...entries] }), "utf8")
      await rename(`${file}.tmp`, file)
    })
    writes = save
    await save
  }
  return {
    async get(key) {
      await loaded
      const map = key.includes(":job:") ? jobs : entries
      const entry = map.get(key)
      if (entry && entry.until > Date.now()) return entry.value
      map.delete(key)
      return undefined
    },
    async set(key, value, ttl) {
      await loaded
      const job = key.includes(":job:")
      const map = job ? jobs : entries
      map.set(key, { value, until: Date.now() + ttl * 1000 })
      if (!job) await persist()
    },
    async delete(key) {
      await loaded
      if (key.includes(":job:")) jobs.delete(key)
      else { entries.delete(key); await persist() }
    },
  }
}
