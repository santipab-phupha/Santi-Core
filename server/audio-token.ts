import { createHmac, timingSafeEqual } from "node:crypto"
import type { AudioManifest } from "../src/audio-types"

// A signed, bounded transcript survives serverless cold starts without a database.
export function audioTokens(secret: () => string) {
  function key() {
    const value = secret()
    if (value.length < 16) throw new Error("Audio signing configuration unavailable")
    return value
  }
  function sign(value: string) { return createHmac("sha256", key()).update("santi-core/audio-report/v1\0").update(value).digest() }
  return {
    issue(manifest: AudioManifest) {
      const payload = Buffer.from(JSON.stringify({ expires: Date.now() + 3_600_000, manifest })).toString("base64url")
      if (payload.length > 600_000) throw new Error("Audio transcript exceeds limits")
      return `${payload}.${sign(payload).toString("base64url")}`
    },
    read(token: unknown, reportId: unknown): AudioManifest | undefined {
      try {
        if (typeof token !== "string" || token.length > 600_100) return
        const parts = token.split(".")
        if (parts.length !== 2) return
        const signature = Buffer.from(parts[1], "base64url")
        const expected = sign(parts[0])
        if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return
        const data = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
        if (!Number.isFinite(data.expires) || data.expires <= Date.now() || data.expires > Date.now() + 3_601_000 || data.manifest?.reportId !== reportId) return
        return data.manifest as AudioManifest
      } catch { return }
    },
  }
}
