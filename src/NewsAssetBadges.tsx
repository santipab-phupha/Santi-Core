import { useState } from "react"
import type { FeedItem, MarketCoin } from "./data-types"
import { newsAssets } from "./news-assets"
import type { NewsAsset } from "./news-assets"

function AssetBadge({ asset }: { asset: NewsAsset }) {
  const [failed, setFailed] = useState(false)
  return <span className="news-asset-badge" title={asset.name}>
    {asset.image && !failed ? <img src={asset.image} alt="" width="18" height="18" loading="lazy" onError={() => setFailed(true)} />
      : <span className="news-asset-fallback" aria-hidden="true">{asset.symbol.slice(0, 1)}</span>}
    {asset.symbol.toUpperCase()}
  </span>
}
export default function NewsAssetBadges({ item, coins }: { item: FeedItem; coins: MarketCoin[] }) {
  const assets = newsAssets(item, coins)
  return <div className="news-assets" aria-label="Assets mentioned in this story">
    {assets.length ? assets.map((asset) => <AssetBadge key={asset.id} asset={asset} />)
      : <span className="news-asset-market"><span aria-hidden="true">◎</span> Market / Other</span>}
  </div>
}
