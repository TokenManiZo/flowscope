import { describe, expect, it } from "vitest"

import type { SurfaceEndpoint } from "@/lib/api/types"
import { buildUrlList, endpointUrl } from "./surfaceUrlExport"

const endpoint = (service: string, method: string, pathTemplate: string): SurfaceEndpoint => ({
  key: { service, method, pathTemplate }, observedSources: [], observations: [], declarations: [], parameters: [], deltaState: "DECLARED_NOT_OBSERVED",
})

describe("endpointUrl", () => {
  it("joins origin and path without doubling or dropping the slash", () => {
    expect(endpointUrl({ service: "https://api.test:443", method: "GET", pathTemplate: "/identity/api/auth/login" })).toBe("https://api.test:443/identity/api/auth/login")
    expect(endpointUrl({ service: "https://api.test/", method: "GET", pathTemplate: "users/1" })).toBe("https://api.test/users/1")
  })

  it("keeps an already absolute path template as-is", () => {
    expect(endpointUrl({ service: "https://api.test", method: "GET", pathTemplate: "https://cdn.test/app.js" })).toBe("https://cdn.test/app.js")
  })
})

describe("buildUrlList", () => {
  it("emits one sorted, deduplicated URL per line with a trailing newline", () => {
    const text = buildUrlList([
      endpoint("https://api.test", "POST", "/identity/api/auth/signup"),
      endpoint("https://api.test", "GET", "/identity/api/auth/signup"), // 같은 URL, 메서드만 다름 → 한 줄
      endpoint("https://api.test", "GET", "/community/api/v2/community/posts/recent"),
    ])
    expect(text).toBe("https://api.test/community/api/v2/community/posts/recent\nhttps://api.test/identity/api/auth/signup\n")
  })

  it("returns an empty string when there is nothing to export", () => {
    expect(buildUrlList([])).toBe("")
  })
})
