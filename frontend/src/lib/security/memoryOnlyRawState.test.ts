import { afterEach, describe, expect, it, vi } from "vitest"

import { createMemoryOnlyRawState, REQUEST_LAB_MAX_BYTES } from "./memoryOnlyRawState"

const secret = "RAW-SECRET-REQUEST"

describe("memoryOnlyRawState", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps raw values only in memory, caps current-tab history at ten, and scrubs all references", () => {
    const storage = vi.spyOn(Storage.prototype, "setItem")
    const log = vi.spyOn(console, "log")
    const raw = createMemoryOnlyRawState({ request: secret, response: "RAW-SECRET-RESPONSE" })
    for (let index = 0; index < 12; index += 1) raw.addResult({ response: `response-${index}`, status: 200, durationMs: index })

    expect(raw.history).toHaveLength(10)
    expect(raw.history[0]?.response).toBe("response-11")
    expect(storage).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    raw.clear()

    expect(raw.request).toBe("")
    expect(raw.response).toBe("")
    expect(raw.history).toHaveLength(0)
  })

  it("uses the exact UTF-8 1 MiB limit, including multibyte boundaries", () => {
    const raw = createMemoryOnlyRawState()
    expect(REQUEST_LAB_MAX_BYTES).toBe(1_048_576)
    expect(raw.canSend("a".repeat(REQUEST_LAB_MAX_BYTES))).toBe(true)
    expect(raw.canSend("가".repeat(Math.floor(REQUEST_LAB_MAX_BYTES / 3)))).toBe(true)
    expect(raw.canSend("가".repeat(Math.floor(REQUEST_LAB_MAX_BYTES / 3) + 1))).toBe(false)
  })
})
