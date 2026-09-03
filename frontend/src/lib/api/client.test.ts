import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"

import { ApiError, apiFetch, postForm } from "./client"
import { cancelLlmRun, followUpLlmJudge, importXml, startLlmRun, startScannerRun } from "./endpoints"
import type { LlmRun, ScannerRun } from "./types"

const capability = "a".repeat(64)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })
}

describe("FlowScope API transport", () => {
  afterEach(() => {
    document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
    vi.unstubAllGlobals()
  })

  it("reads the current capability meta value for each API request and sends it only as a header", async () => {
    const meta = document.createElement("meta")
    meta.name = "flowscope-capability"
    meta.content = capability
    document.head.append(meta)
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ revision: 1 })))
    vi.stubGlobal("fetch", fetchStub)

    await apiFetch<{ revision: number }>("/api/snapshot")
    meta.content = "b".repeat(64)
    await apiFetch<{ revision: number }>("/api/snapshot")

    const [, firstInit] = fetchStub.mock.calls[0] as [string, RequestInit]
    const [, secondInit] = fetchStub.mock.calls[1] as [string, RequestInit]
    expect(new Headers(firstInit.headers).get("X-FlowScope-Token")).toBe(capability)
    expect(new Headers(secondInit.headers).get("X-FlowScope-Token")).toBe("b".repeat(64))
    expect(new Headers(firstInit.headers).get("Content-Type")).toBeNull()
  })

  it("URL-encodes form values and accepts 202 only when an endpoint declares it", async () => {
    const meta = document.createElement("meta")
    meta.name = "flowscope-capability"
    meta.content = capability
    document.head.append(meta)
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }, 202))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING" } }, 202))
    vi.stubGlobal("fetch", fetchStub)

    await expect(apiFetch("/api/snapshot")).rejects.toMatchObject({ status: 202 })
    await postForm("/api/llm-run", {
      action: "start", provider: "CODEX", role: "EXPLORER",
      target: "http://localhost:8888/", account: "user-a",
    }, [202])

    const [, init] = fetchStub.mock.calls[1] as [string, RequestInit]
    expect(init.method).toBe("POST")
    expect(init.body).toBeInstanceOf(URLSearchParams)
    expect((init.body as URLSearchParams).get("account")).toBe("user-a")
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded;charset=UTF-8")
  })

  it("returns only run from scanner and LLM mutations with their exact accepted statuses", async () => {
    const meta = document.createElement("meta")
    meta.name = "flowscope-capability"
    meta.content = capability
    document.head.append(meta)
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING", stage: "TRADITIONAL_SPIDER" } }, 202))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING", provider: "CODEX" } }, 202))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "CANCELLED" } }, 200))
      .mockResolvedValueOnce(jsonResponse({ run: { status: "RUNNING", role: "JUDGE" } }, 202))
    vi.stubGlobal("fetch", fetchStub)

    const scanner = await startScannerRun("https://app.test/", "user-a", true)
    const started = await startLlmRun({ provider: "CODEX", role: "EXPLORER", target: "https://app.test/", account: "user-a" })
    const cancelled = await cancelLlmRun()
    const followedUp = await followUpLlmJudge("explain evidence")

    expect(scanner).toEqual({ run: { status: "RUNNING", stage: "TRADITIONAL_SPIDER" } })
    expect(started).toEqual({ run: { status: "RUNNING", provider: "CODEX" } })
    expect(cancelled).toEqual({ run: { status: "CANCELLED" } })
    expect(followedUp).toEqual({ run: { status: "RUNNING", role: "JUDGE" } })
    expect("scope" in scanner).toBe(false)
    expect("completed_lanes" in started).toBe(false)
    expect(fetchStub.mock.calls.map(([path]) => path)).toEqual([
      "/api/scanner-run", "/api/llm-run", "/api/llm-run", "/api/llm-run",
    ])
  })

  expectTypeOf(startScannerRun).returns.toEqualTypeOf<Promise<{ run: ScannerRun }>>()
  expectTypeOf(startLlmRun).returns.toEqualTypeOf<Promise<{ run: LlmRun }>>()
  expectTypeOf(cancelLlmRun).returns.toEqualTypeOf<Promise<{ run: LlmRun }>>()
  expectTypeOf(followUpLlmJudge).returns.toEqualTypeOf<Promise<{ run: LlmRun }>>()

  it("uses the exact XML media type without converting the raw document into a form", async () => {
    const meta = document.createElement("meta")
    meta.name = "flowscope-capability"
    meta.content = capability
    document.head.append(meta)
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ success: true, imported: 1, candidates: 0, failed: 0 }))
    vi.stubGlobal("fetch", fetchStub)
    const xml = "<?xml version=\"1.0\"?><items><item>한글</item></items>"

    await importXml("human", "fixture.xml", xml)

    const [path, init] = fetchStub.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/api/import-xml?source=human&name=fixture.xml")
    expect(init.body).toBe(xml)
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/xml;charset=UTF-8")
  })

  it("preserves HTTP status and server messages for JSON, malformed, and non-JSON failures", async () => {
    const meta = document.createElement("meta")
    meta.name = "flowscope-capability"
    meta.content = capability
    document.head.append(meta)
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: false, message: "서버 메시지" }, 400))
      .mockResolvedValueOnce(new Response("{not-json", { status: 502, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 503, headers: { "Content-Type": "text/plain" } }))
    vi.stubGlobal("fetch", fetchStub)

    await expect(apiFetch("/api/snapshot")).rejects.toEqual(new ApiError(400, "서버 메시지"))
    await expect(apiFetch("/api/snapshot")).rejects.toMatchObject({ status: 502 })
    await expect(apiFetch("/api/snapshot")).rejects.toMatchObject({ status: 503 })
  })
})
