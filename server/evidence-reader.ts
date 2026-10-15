import type { DebateSource } from "../src/bear-bull-types"
const hosts = new Set(["www.coindesk.com", "coindesk.com", "cointelegraph.com", "decrypt.co", "insights.unlocks.app"])
const clean = (value: string) => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|quot|apos|#39|lt|gt);/g, (v) => ({"&nbsp;":" ","&amp;":"&","&quot;":'"',"&apos;":"'","&#39;":"'","&lt;":"<","&gt;":">"})[v] || " ").replace(/\s+/g, " ").trim()
export function articleText(html: string) {
  function body(value: unknown, depth = 0): string {
    if (depth > 8 || !value || typeof value !== "object") return ""
    if (Array.isArray(value)) return value.map((v) => body(v, depth + 1)).find(Boolean) || ""
    const row = value as Record<string, unknown>
    if (typeof row.articleBody === "string") return clean(row.articleBody)
    return Object.values(row).map((v) => body(v, depth + 1)).find(Boolean) || ""
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const value = body(JSON.parse(match[1])); if (value.length > 100) return value.slice(0, 8_000) } catch { /* unsupported structured data */ }
  }
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]
  return article ? clean(article).slice(0, 8_000) : ""
}
export function createEvidenceReader(registry: Map<string, DebateSource>, signal: AbortSignal, fetcher = fetch) {
  const cache = new Map<string, Promise<unknown>>()
  return async (raw: unknown): Promise<unknown> => {
    if (typeof raw !== "string" || !registry.has(raw)) return { available: false, gap: "URL is not among the supplied evidence. No page was fetched." }
    if (cache.has(raw)) return cache.get(raw)!
    const task = (async () => {
      const readSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      try {
        let url = new URL(raw)
        for (let redirects = 0; redirects <= 2; redirects++) {
          readSignal.throwIfAborted()
          if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.port || url.username || url.password) break
          const response = await fetcher(url, { redirect: "manual", signal: readSignal, headers: { Accept: "text/html" } })
          if ([301,302,303,307,308].includes(response.status)) { await response.body?.cancel(); url = new URL(response.headers.get("location") || "", url); continue }
          if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) { await response.body?.cancel(); break }
          const reader = response.body?.getReader()
          if (!reader) break
          const chunks: Uint8Array[] = []
          let size = 0
          try {
            while (true) { const {done, value} = await reader.read(); if (done) break; size += value.length; if (size > 1_500_000) throw new Error("Page too large"); chunks.push(value) }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
          const text = articleText(Buffer.concat(chunks).toString("utf8"))
          if (text.length < 100) break
          return { available: true, url: raw, title: registry.get(raw)!.title, text, partial: true, retrievedAt: new Date().toISOString(), scope: "Bounded public article excerpt, maximum 8000 characters; not a full web search." }
        }
      } catch { if (signal.aborted) throw signal.reason }
      return { available: false, url: raw, gap: "Could not retrieve an article excerpt. Only the supplied headline/structured event is available; do not infer article content." }
    })()
    cache.set(raw, task)
    return task
  }
}
