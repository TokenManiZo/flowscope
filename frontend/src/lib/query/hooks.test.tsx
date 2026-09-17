import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { scannerRunFixture, snapshotFixture } from "@/test/fixtures"
import { createTestQueryClient } from "@/test/render"
import { QueryClientProvider } from "@tanstack/react-query"
import { useScannerRunQuery, useSnapshotQuery } from "./hooks"

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

  it("publishes a managed session status change even when the dataset revision is unchanged", async () => {
    vi.useFakeTimers()
    capabilityMeta()
    const unverified = { ...snapshotFixture, managedSessions: [{
      handle: "session-a", accountId: "account-a", accountLabel: "USER A", service: "http://127.0.0.1:8888",
      status: "UNVERIFIED", createdAt: "", lastUsedAt: null, expiresAtHint: null,
      hasAuthorization: true, cookieCount: 1, capturing: false, credentialConflict: false,
    }] }
    const active = { ...unverified, managedSessions: [{ ...unverified.managedSessions[0], status: "ACTIVE" }] }
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse(unverified))
      .mockResolvedValueOnce(jsonResponse(active))
    vi.stubGlobal("fetch", fetchStub)
    const client = createTestQueryClient()
    const view = renderHook(() => useSnapshotQuery(), { wrapper: wrapperFor(client) })

    await flushQuery()
    expect(view.result.current.data?.managedSessions[0]?.status).toBe("UNVERIFIED")
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    await flushQuery()

    expect(fetchStub).toHaveBeenCalledTimes(2)
    expect((client.getQueryData(["snapshot"]) as typeof active).managedSessions[0]?.status).toBe("ACTIVE")
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(view.result.current.data?.managedSessions[0]?.status).toBe("ACTIVE")
    view.unmount()
  })

  it("retains the last successful scanner run when a poll fails", async () => {
    vi.useFakeTimers()
    capabilityMeta()
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(jsonResponse(scannerRunFixture))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse(scannerRunFixture))
    vi.stubGlobal("fetch", fetchStub)
    const client = createTestQueryClient()
    const view = renderHook(() => useScannerRunQuery(), { wrapper: wrapperFor(client) })

    await flushQuery()
    expect(view.result.current.data?.run.status).toBe("NOT_STARTED")
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(view.result.current.data).toEqual(scannerRunFixture)
    view.unmount()
  })
})
