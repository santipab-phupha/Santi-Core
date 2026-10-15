import {test} from "node:test"
import assert from "node:assert/strict"
import {articleText,createEvidenceReader} from "./evidence-reader.ts"
import {matchingSourceQuote} from "./original-source-checker.ts"
const url="https://decrypt.co/123/bitcoin"
const registry=new Map([[url,{url,title:"Bitcoin report",origin:"feed" as const}]])
test("evidence reads only registered publisher URLs and never follows redirects to local/private destinations",async()=>{
 let calls=0
 const read=createEvidenceReader(registry,new AbortController().signal,async()=>{calls++;return new Response(null,{status:302,headers:{location:"http://127.0.0.1/private"}})})
 assert.equal((await read("https://evil.example/read") as any).available,false)
 assert.equal(calls,0)
 assert.equal((await read(url) as any).available,false)
 assert.equal(calls,1)
})
test("article extraction uses real article content, excludes scripts, shares reads and bounds excerpts",async()=>{
 const content="Bitcoin evidence. ".repeat(1000)
 const html=`<script type="application/ld+json">${JSON.stringify({"@graph":[{articleBody:content}]})}</script>`
 assert.equal(articleText(html).length,8000)
 assert.equal(articleText("<nav>Website boilerplate</nav>"),"")
 assert.equal(articleText("<article>Real text<script>ignore me</script><style>ignore css</style></article>"),"Real text")
 let calls=0
 const read=createEvidenceReader(registry,new AbortController().signal,async()=>{calls++;return new Response(html,{headers:{"Content-Type":"text/html"}})})
 const [a,b]=await Promise.all([read(url),read(url)]) as any[]
 assert.equal(a.available,true);assert.equal(a.partial,true);assert.deepEqual(a,b);assert.equal(calls,1)
})

test("the fast reference worker can match a publisher h1 without changing debate article extraction", async () => {
  const title = "Bitcoin ETF records confirmed net inflows"
  const html = `<main><h1>${title}</h1></main>`
  assert.equal(articleText(html), "")
  assert.equal(articleText(html, true), title)
  const reader = createEvidenceReader(registry, new AbortController().signal,
    async () => new Response(html, { headers: { "Content-Type": "text/html" } }), { includeHeading: true, minimumLength: 8, timeoutMs: 1000 })
  assert.equal((await reader(url) as { available: boolean }).available, true)
})

test("encoded publisher punctuation matches RSS headlines without approving different text", () => {
  const title = "Ethereum, Altcoins See 'Outsized Drawdowns' Due to Macro Pressures"
  const text = articleText("<h1>Ethereum, Altcoins See &#x27;Outsized Drawdowns&#39; Due to Macro Pressures</h1>", true)
  const item = { id: url, title, url, source: "Decrypt", publishedAt: new Date().toISOString(), kind: "News" as const, topics: [] }
  assert.equal(text, title)
  assert.equal(matchingSourceQuote(text, item)?.quote, title)
  assert.equal(matchingSourceQuote(text, { ...item, title: "Ethereum sees confirmed inflows" }), null)
  assert.equal(articleText("<article>&#x2019; &#160; &#128200; &#x110000; &#xD800;</article>"), "’ 📈 &#x110000; &#xD800;")
  assert.equal(articleText("<article>&#x3c;script&#x3e;quoted text&#x3c;/script&#x3e;</article>"), "<script>quoted text</script>")
})

test("large publisher pages may provide a bounded reference headline without weakening full article reads", async () => {
  const title = "Bitcoin ETF records source-confirmed inflows"
  const html = `<h1>${title}</h1><script>${"x".repeat(1_600_000)}</script>`
  const fetcher = async () => new Response(html, {headers:{"Content-Type":"text/html"}})
  const reference = createEvidenceReader(registry,new AbortController().signal,fetcher,{includeHeading:true,minimumLength:8})
  const value = await reference(url) as {available:boolean;text:string}
  assert.equal(value.available,true);assert.equal(value.text,title)
  const fullArticle = createEvidenceReader(registry,new AbortController().signal,fetcher)
  assert.equal((await fullArticle(url) as {available:boolean}).available,false)
})
