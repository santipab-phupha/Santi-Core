import {test} from "node:test"
import assert from "node:assert/strict"
import {articleText,createEvidenceReader} from "./evidence-reader.ts"
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
