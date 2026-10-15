import type { FeedItem } from "../src/data-types"

type JsonObject = Record<string, unknown>
function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {}
}
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}
function iso(value: unknown): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null
  return new Date(value).toISOString()
}

export function parseTokenomist(raw: unknown, now = Date.now()): FeedItem[] {
  const payload = object(raw)
  if (payload.status !== true || !Array.isArray(payload.data))
    throw new Error("Invalid Tokenomist response")
  const queryDate = iso(object(payload.metadata).queryDate)
  if (!queryDate || Date.parse(queryDate) > now + 300_000)
    throw new Error("Missing Tokenomist timestamp")
  return payload.data.flatMap((value) => {
    const token = object(value), event = object(token.upcomingEvent)
    const cliff = object(event.cliffUnlocks)
    const unlockDate = iso(event.unlockDate)
    const amount = positive(cliff.totalCliffAmount ?? cliff.cliffAmount)
    const updated = iso(event.latestUpdateDate)
    if (
      typeof token.tokenId !== "string" || !/^[a-z0-9-]+$/.test(token.tokenId) ||
      typeof token.tokenName !== "string" || !token.tokenName.trim() ||
      typeof token.tokenSymbol !== "string" || !/^[a-z0-9.$_-]{1,20}$/i.test(token.tokenSymbol) ||
      !unlockDate || Date.parse(unlockDate) < now || !amount
    ) return []
    const symbol = token.tokenSymbol.toUpperCase()
    const name = token.tokenName.slice(0, 100)
    return [{
      id: `tokenomist:${token.tokenId}:${unlockDate}`,
      title: `${name} (${symbol}) cliff unlock`,
      url: `https://tokenomist.ai/${encodeURIComponent(token.tokenId)}`,
      source: "Tokenomist",
      // Event dates are separate from the time the schedule was updated.
      publishedAt: updated && Date.parse(updated) <= now ? updated : queryDate,
      kind: "Tokenomics" as const,
      topics: [name, symbol, "Unlock", "Vesting"],
      unlock: {
        date: unlockDate,
        amount,
        valueUsd: positive(cliff.totalCliffValue ?? cliff.cliffValue),
        symbol,
        checkedAt: queryDate,
      },
    }]
  }).slice(0, 25)
}

// One shared hourly request, independent of the two-minute publisher refresh.
export function tokenomistClient(getKey: () => string) {
  let cached: { items: FeedItem[]; checkedAt: string } | undefined
  let expires = 0
  let retryAt = 0
  let pending: Promise<{ items: FeedItem[]; stale: boolean }> | undefined
  let state: "not_configured" | "not_checked" | "connected" | "unavailable" = "not_checked"
  return {
    status() {
      return {
        configured: Boolean(getKey()),
        state: getKey() ? state : "not_configured",
        checkedAt: cached?.checkedAt ?? null,
      }
    },
    async load(): Promise<{ items: FeedItem[]; stale: boolean }> {
      const key = getKey()
      if (!key) { state = "not_configured"; return { items: [], stale: false } }
      if (cached && Date.now() < expires) return { items: cached.items, stale: false }
      if (pending) return pending
      if (Date.now() < retryAt) {
        if (cached) return { items: cached.items, stale: true }
        throw new Error("Tokenomist unavailable")
      }
      pending = (async () => {
        try {
          const response = await fetch("https://api.tokenomist.ai/v5/unlock/events/upcoming?page=1&pageSize=25", {
            headers: { "x-api-key": key, Accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(12_000),
          })
          if (!response.ok) throw new Error("Tokenomist request failed")
          const items = parseTokenomist(await response.json())
          cached = { items, checkedAt: new Date().toISOString() }
          expires = Date.now() + 3_600_000
          state = "connected"
          return { items, stale: false }
        } catch {
          state = "unavailable"
          retryAt = Date.now() + 300_000
          if (cached) return { items: cached.items, stale: true }
          throw new Error("Tokenomist unavailable")
        } finally { pending = undefined }
      })()
      return pending
    },
  }
}
