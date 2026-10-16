import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import assert from "node:assert/strict"
import { createServer } from "node:http"

// Exercise emitted JavaScript: development's TS loader cannot catch missing
// .ts -> .js rewrites in a deployed function's import graph.
const root = process.cwd()
const output = path.join(root, ".cache", "server-check")
// Check the API graph independently of Vite's bundler module resolution.
// This catches development-only type imports that break Vercel's API compiler.
execFileSync(process.execPath, [
  "node_modules/typescript/bin/tsc", "--noEmit", "--module", "ESNext",
  "--moduleResolution", "node", "--target", "ES2020", "--strict",
  "--skipLibCheck", "--allowImportingTsExtensions", "--allowSyntheticDefaultImports",
  "api/workspace.ts",
], { stdio: "inherit" })
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "false", "--outDir", output], { stdio: "inherit" })
const entry = path.join(output, "api", "workspace.js")
assert.match(readFileSync(entry, "utf8"), /workspace-api\.js/)
const handler = (await import(pathToFileURL(entry).href)).default
const server = createServer((req, res) => { void handler(req, res) })
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
try {
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${base}/api/missing`)).status, 404)
  const response = await fetch(`${base}/api/analysis/config`)
  assert.equal(response.status, 200)
  assert.equal(typeof (await response.json()).configured, "boolean")
  console.log("Compiled API starts and serves routes successfully")
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
