import type { DebateSource } from "../src/bear-bull-types"
const hosts = new Set(["www.coindesk.com", "coindesk.com", "cointelegraph.com", "decrypt.co", "insights.unlocks.app"])
function numericEntity(entity: string, digits: string) {
  const point = digits[0].toLowerCase() === "x" ? parseInt(digits.slice(1), 16) : parseInt(digits, 10)
  return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity
}
const clean = (value: string) => value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ").replace(/&#(x[\da-f]+|\d+);/gi, numericEntity)
  .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, (v) => ({"&nbsp;":" ","&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">"})[v] || " ").replace(/\s+/g, " ").trim()
export function articleText(html: string, includeHeading = false) {
  const heading = includeHeading ? clean(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "") : ""
  const withHeading = (text: string) => [heading, text].filter(Boolean).join(" ").slice(0, 8_000)
  function body(value: unknown, depth = 0): string {
    if (depth > 8 || !value || typeof value !== "object") return ""
    if (Array.isArray(value)) return value.map((v) => body(v, depth + 1)).find(Boolean) || ""
    const row = value as Record<string, unknown>
    if (typeof row.articleBody === "string") return clean(row.articleBody)
    return Object.values(row).map((v) => body(v, depth + 1)).find(Boolean) || ""
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const value = body(JSON.parse(match[1])); if (value.length > 100) return withHeading(value) } catch { /* unsupported structured data */ }
  }
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1]
  return withHeading(article ? clean(article) : "")
}
export function createEvidenceReader(registry: Map<string, DebateSource>, signal: AbortSignal, fetcher = fetch,
  options: { timeoutMs?: number; includeHeading?: boolean; minimumLength?: number } = {}) {
  const cache = new Map<string, Promise<unknown>>()
  return async (raw: unknown): Promise<unknown> => {
    if (typeof raw !== "string" || !registry.has(raw)) return { available: false, gap: "URL is not among the supplied evidence. No page was fetched." }
    if (cache.has(raw)) return cache.get(raw)!
    const task = (async () => {
      const readSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)])
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
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const remaining = 1_500_000 - size
              if (value.length > remaining) {
                // Reference matching may use an actual headline already inside
                // the bounded prefix. Oversized hydration scripts after it do
                // not invalidate that text. Full article reads stay strict.
                if (!options.includeHeading) throw new Error("Page too large")
                if (remaining > 0) chunks.push(value.subarray(0, remaining))
                break
              }
              size += value.length; chunks.push(value)
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
          const text = articleText(Buffer.concat(chunks).toString("utf8"), options.includeHeading)
          if (text.length < (options.minimumLength ?? 100)) break
          return { available: true, url: raw, title: registry.get(raw)!.title, text, partial: true, retrievedAt: new Date().toISOString(), scope: "Bounded public article excerpt, maximum 8000 characters; not a full web search." }
        }
      } catch { if (signal.aborted) throw signal.reason }
      return { available: false, url: raw, gap: "Could not retrieve an article excerpt. Only the supplied headline/structured event is available; do not infer article content." }
    })()
    cache.set(raw, task)
    return task
  }
}
