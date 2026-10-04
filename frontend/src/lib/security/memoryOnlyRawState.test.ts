import { afterEach, describe, expect, it, vi } from "vitest"

import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES, REQUEST_LAB_MAX_REQUESTS, REQUEST_LAB_WORKSPACE_BYTES } from "./memoryOnlyRawState"

const secret = "RAW-SECRET-REQUEST"

describe("memoryOnlyRawState", () => {
  afterEach(() => vi.restoreAllMocks())

  it("copies independent requests without storage/logging and scrubs originals, entries, results and derived views", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem")
    const log = vi.spyOn(console, "log")
    const raw = createMemoryOnlyRawState({ request: secret, response: "RAW-SECRET-RESPONSE" })
    const first = raw.addRequest(raw.originalRequest, "ORIGINAL")!
    const second = raw.addRequest(first.request, "ANONYMOUS")!
    raw.selectedId = first.id
    raw.editRequest(first, "edited first")
    raw.replaceResult(first, { response: "first response", status: 200, durationMs: 1 })
    const result = first.result!
    expect(raw.request).toBe("edited first")
    expect(second.request).toBe(secret)
    expect(raw.originalRequest).toBe(secret)
    expect(storage).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    const json = { text: '{"derived":"RAW-SECRET-REQUEST"}', message: "" }
    raw.jsonViews.request = json
    const entries = raw.requests
    raw.clear()
    expect(json.text).toBe("")
    expect(raw.jsonViews.request).toBeNull()
    expect(raw.originalRequest).toBe("")
    expect(raw.originalResponse).toBe("")
    expect(first.request).toBe("")
    expect(second.request).toBe("")
    expect(result.response).toBe("")
    expect(raw.request).toBe("")
    expect(raw.response).toBe("")
    expect(entries).toHaveLength(0)
  })

  it("keeps only the latest result and removes selected text without affecting other requests or Original", () => {
    const raw = createMemoryOnlyRawState({ request: secret, response: "observed" })
    const first = raw.addRequest(secret, "ORIGINAL")!
    const second = raw.addRequest("second", "ACCOUNT")!
    raw.selectedId = first.id
    raw.replaceResult(first, { response: "previous", status: 200, durationMs: 1 })
    const previous = first.result!
    raw.replaceResult(first, { response: "latest", status: 201, durationMs: 2 })
    expect(previous.response).toBe("")
    expect(raw.response).toBe("latest")
    const latest = first.result!
    raw.removeRequest(first)
    expect(first.request).toBe("")
    expect(latest.response).toBe("")
    expect(raw.requests).toEqual([second])
    expect(raw.request).toBe(secret)
    expect(raw.response).toBe("observed")
    const late = { response: "late result", status: 200, durationMs: 1 }
    expect(raw.replaceResult(first, late)).toBe(false)
    expect(late.response).toBe("")
  })

  it("rejects excessive response retention without evicting other editable requests", () => {
    const raw = createMemoryOnlyRawState({ request: "original", response: "observed" })
    const response = "r".repeat(4 * REQUEST_LAB_MAX_BYTES)
    for (let index = 0; index < 4; index++) {
      const entry = raw.addRequest(`request-${index}`, "ORIGINAL")!
      expect(raw.replaceResult(entry, { response, status: 200, durationMs: 1 })).toBe(true)
    }
    const next = raw.addRequest("unsent", "ANONYMOUS")!
    const oversized = { response, status: 200, durationMs: 1 }
    expect(raw.replaceResult(next, oversized)).toBe(false)
    expect(oversized.response).toBe("")
    expect(next.result).toBeNull()
    expect(raw.requests).toHaveLength(5)
    expect(raw.requests[0]?.result?.response).toBe(response)
    expect(raw.editRequest(next, "q".repeat(REQUEST_LAB_MAX_BYTES))).toBe(false)
    expect(next.request).toBe("unsent")
    expect(REQUEST_LAB_WORKSPACE_BYTES).toBe(40 * REQUEST_LAB_MAX_BYTES)
    raw.removeRequest(raw.requests[0]!)
    expect(raw.editRequest(next, "q".repeat(REQUEST_LAB_MAX_BYTES))).toBe(true)
    raw.clear()
  })

  it("retains Original and two latest pairs at the default server request/response limits", () => {
    const request = "q".repeat(REQUEST_LAB_MAX_BYTES)
    const response = "r".repeat(4 * REQUEST_LAB_MAX_BYTES)
    const raw = createMemoryOnlyRawState({ request, response })
    for (let index = 0; index < 2; index++) {
      const entry = raw.addRequest(request, "ORIGINAL")!
      expect(raw.replaceResult(entry, { response, status: 200, durationMs: 1 })).toBe(true)
    }
    expect(raw.requests).toHaveLength(2)
    expect(raw.originalRequest).toBe(request)
    expect(raw.originalResponse).toBe(response)
    raw.clear()
  })

  it("bounds empty request entries without recycling IDs or silently deleting drafts", () => {
    const raw = createMemoryOnlyRawState()
    for (let index = 0; index < REQUEST_LAB_MAX_REQUESTS; index++) expect(raw.addRequest("", "ORIGINAL")).not.toBeNull()
    expect(raw.addRequest("", "ORIGINAL")).toBeNull()
    raw.removeRequest(raw.requests[0]!)
    expect(raw.addRequest("", "ORIGINAL")?.id).toBe(REQUEST_LAB_MAX_REQUESTS + 1)
  })

  it("uses the exact UTF-8 1 MiB send limit, including multibyte boundaries", () => {
    const raw = createMemoryOnlyRawState()
    expect(REQUEST_LAB_MAX_BYTES).toBe(1_048_576)
    expect(raw.canSend("a".repeat(REQUEST_LAB_MAX_BYTES))).toBe(true)
    expect(raw.canSend("가".repeat(Math.floor(REQUEST_LAB_MAX_BYTES / 3)))).toBe(true)
    expect(raw.canSend("가".repeat(Math.floor(REQUEST_LAB_MAX_BYTES / 3) + 1))).toBe(false)
  })
})
