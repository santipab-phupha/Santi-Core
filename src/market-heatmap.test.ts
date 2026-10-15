import { test } from "node:test"
import assert from "node:assert/strict"
import { marketTreemap, heatmapColor } from "./market-heatmap.ts"
import type { MarketCoin } from "./data-types"

const coin = (id: number, marketCap: number): MarketCoin => ({ id:`coin-${id}`, name:`Coin ${id}`, symbol:`C${id}`, rank:id+1, marketCap, image:"", price:1, change24h:0, circulatingSupply:null, maxSupply:null, updatedAt:new Date().toISOString() })
test("50-asset treemap preserves market-cap proportions and fills desktop and mobile without overlaps",()=>{
  const coins=[coin(0,1600),coin(1,300),...Array.from({length:48},(_,i)=>coin(i+2,100/(i+1)))]
  const total=coins.reduce((sum,item)=>sum+item.marketCap,0)
  for(const [width,height] of [[1280,500],[328,610],[900,430]]){
    const tiles=marketTreemap(coins,width,height)
    assert.equal(tiles.length,50)
    let area=0
    for(const tile of tiles){
      assert.ok(tile.width>0&&tile.height>0)
      assert.ok(tile.x>=0&&tile.y>=0&&tile.x+tile.width<=width+1e-6&&tile.y+tile.height<=height+1e-6)
      assert.ok(Math.abs(tile.width*tile.height/(width*height)-tile.coin.marketCap/total)<1e-10)
      area+=tile.width*tile.height
    }
    assert.ok(Math.abs(area-width*height)<1e-6)
    for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
      const a=tiles[i],b=tiles[j]
      const intersection=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))
      assert.ok(intersection<1e-6,"Tile areas must not overlap")
    }
  }
})

test("treemap skips invalid/duplicate caps, sorts without mutating input, and never fabricates missing assets",()=>{
  const coins=[coin(0,5),coin(1,10),coin(0,5),coin(2,0),coin(3,NaN),coin(4,-1)]
  assert.deepEqual(marketTreemap(coins,600,400).map(tile=>tile.coin.id),["coin-1","coin-0"])
  assert.equal(coins[0].id,"coin-0")
  assert.equal(marketTreemap([coin(0,1)],600,400)[0].width,600)
  assert.equal(marketTreemap(Array.from({length:60},(_,i)=>coin(i,100-i)),600,400).length,50)
  for(const [w,h] of [[0,400],[NaN,400],[400,-1]])assert.deepEqual(marketTreemap(coins,w,h),[])
})

test("heatmap colors distinguish missing, flat, gains and losses with bounded intensity",()=>{
  assert.equal(heatmapColor(null).tone,"unavailable")
  assert.equal(heatmapColor(NaN).tone,"unavailable")
  assert.equal(heatmapColor(0).tone,"neutral")
  assert.equal(heatmapColor(.001).tone,"neutral")
  assert.equal(heatmapColor(1).tone,"positive")
  assert.equal(heatmapColor(-1).tone,"negative")
  assert.equal(heatmapColor(8).color,heatmapColor(100).color)
  assert.equal(heatmapColor(-8).color,heatmapColor(-100).color)
})
