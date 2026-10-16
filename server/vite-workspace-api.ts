import type { Plugin, Connect } from "vite"
import { createWorkspaceHandler } from "./workspace-api.ts"

// Keep Vite's development hooks outside the serverless API import graph.
export function workspaceApi(): Plugin {
  let handler = createWorkspaceHandler()
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    void handler(req, res, next).catch(next)
  }
  return {
    name: "santi-workspace-api",
    configResolved(config) {
      handler = createWorkspaceHandler(config.root)
    },
    configureServer(server) {
      server.middlewares.use(middleware)
      handler.startLocalSourceReviews()
      server.httpServer?.once("close", () => { void handler.stopSourceReviews() })
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
