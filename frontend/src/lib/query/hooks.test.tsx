import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { llmRunFixture, snapshotFixture } from "@/test/fixtures"
import { createTestQueryClient } from "@/test/render"
import { QueryClientProvider } from "@tanstack/react-query"
import { useLlmRunQuery, useSnapshotQuery } from "./hooks"

function wrapperFor(client: ReturnType<typeof createTestQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function capabilityMeta() {
  const meta = document.createElement("meta")
  meta.name = "flowscope-capability"
  meta.content = "a".repeat(64)
  document.head.append(meta)
  return meta
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
}

async function flushQuery(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

describe("centralized FlowScope polling", () => {
  afterEach(() => {
    document.head.querySelector('meta[name="flowscope-capability"]')?.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("shares one one-second snapshot poll across consumers of the same key", async () => {
    vi.useFakeTimers()
    capabilityMeta()
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse(snapshotFixture))
    vi.stubGlobal("fetch", fetchStub)
    const client = createTestQueryClient()
    const first = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })
    const second = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })

    await flushQuery()
    expect(first.result.current.data?.revision).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(second.result.current.data?.revision).toBe(1)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    first.unmount()
    second.unmount()
  })

  it("keeps a shared in-flight request alive until its final observer unmounts", async () => {
    capabilityMeta()
    let receivedSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      receivedSignal = init?.signal ?? undefined
      receivedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
    })))
    const client = createTestQueryClient()
    const first = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })
    const second = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })

    await waitFor(() => expect(receivedSignal).toBeDefined())
    expect(fetch).toHaveBeenCalledTimes(1)
    first.unmount()

    expect(receivedSignal?.aborted).toBe(false)
    second.unmount()

    await waitFor(() => expect(receivedSignal?.aborted).toBe(true))
  })

  it("keeps the previous snapshot object when a new response has the same revision", async () => {
    vi.useFakeTimers()
    capabilityMeta()
    const changedButSameRevision = { ...snapshotFixture, sampleMode: true }
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshotFixture))
      .mockResolvedValueOnce(jsonResponse(changedButSameRevision))
    vi.stubGlobal("fetch", fetchStub)
    const client = createTestQueryClient()
    const view = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })

    await flushQuery()
    expect(view.result.current.data).toBeDefined()
    const first = view.result.current.data
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(view.result.current.data).toBe(first)
    view.unmount()
  })

  it("retains the last successful LLM run when a poll fails", async () => {
    vi.useFakeTimers()
    capabilityMeta()
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse(llmRunFixture))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(llmRunFixture))
    vi.stubGlobal("fetch", fetchStub)
    const client = createTestQueryClient()
    const view = renderHook(() => useLlmRunQuery(), { wrapper: wrapperFor(client) })

    await flushQuery()
    expect(view.result.current.data?.run.status).toBe("IDLE")
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(view.result.current.data).toEqual(llmRunFixture)
    view.unmount()
  })
})
