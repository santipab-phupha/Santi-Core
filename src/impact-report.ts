import { analyzeCoinImpact } from "./coin-impact.ts"
import { reviewedEvidence } from "./impact-types.ts"
import type { FeedResponse, MarketCoin } from "./data-types"
import type { ImpactReview } from "./impact-types"

export function buildImpactReport(coin: MarketCoin, feed: FeedResponse, review: ImpactReview, now: number, marketStale: boolean) {
  const base = analyzeCoinImpact({ coin, feed, now, marketStale })
  const result = reviewedEvidence(coin.id, base.evidence, review, base.feedCurrent && base.marketCurrent)
  // A directional label alone is insufficient: reports require completed,
  // mapped source evidence, just like the Approved state in the news feed.
  const supported = result.evidence.filter(item => item.agent?.verification?.status === "approved"
    && item.agent.verification.impactReviewedAt && item.agent.verification.references.length > 0)
  return {
    coinId: coin.id,
    symbol: coin.symbol,
    generatedAt: new Date(now).toISOString(),
    feedAt: feed.fetchedAt,
    fresh: base.feedCurrent && base.marketCurrent,
    positive: supported.filter(item => item.tone === "positive"),
    negative: supported.filter(item => item.tone === "negative"),
    inconclusive: result.counts.unknown,
    pending: result.pending.length + result.evidence.filter(item => item.tone !== "unknown" && !supported.includes(item)).length,
    context: result.context.length,
  }
}

export type ImpactReportSnapshot = ReturnType<typeof buildImpactReport>
