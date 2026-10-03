import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { notifyDatasetReplacing, prepareDatasetReplacement } from "@/lib/security/datasetBoundary"
import { emptyGraphView, emptyGraphWorkspace, type GraphWorkspaceChange } from "./graphWorkspace"
import { useGraphWorkspace } from "./useGraphWorkspace"

afterEach(() => { cleanup(); notifyDatasetReplacing(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear() })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } })

it("serializes saves, retains edits made in flight and flushes them before project replacement", async () => {
  let release: () => void = () => {}
  const firstSave = new Promise<void>(resolve => { release = resolve })
  const calls: { revision: number; changes: GraphWorkspaceChange }[] = []
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ datasetRevision: 801, revision: 3, workspace: emptyGraphWorkspace })
    const form = init.body as URLSearchParams
    calls.push({ revision: Number(form.get("revision")), changes: JSON.parse(form.get("changes")!) })
    if (calls.length === 1) await firstSave
    return json({ datasetRevision: 801, revision: 3 + calls.length })
  }))
  const { result, unmount } = renderHook(() => useGraphWorkspace(801))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 10, y: 20 } } } } })))
  let finished = false
  const drain = prepareDatasetReplacement().then(() => { finished = true })
  await waitFor(() => expect(calls).toHaveLength(1))
  act(() => result.current.update(current => ({ ...current, views: { site: { ...current.views.site, positions: { node: { x: 30, y: 40 } } } } })))
  expect(finished).toBe(false)
  release()
  await act(async () => { await drain })
  expect(calls.map(call => call.revision)).toEqual([3, 4])
  expect(calls[1].changes.viewPatches.site.positions?.node).toEqual({ x: 30, y: 40 })
  unmount()
  const reopened = renderHook(() => useGraphWorkspace(801))
  expect(reopened.result.current.workspace?.views.site.positions.node).toEqual({ x: 30, y: 40 })
})

it("warns before closing a large unacknowledged save and removes the guard after acknowledgment", async () => {
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  const saves: RequestInit[] = []
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ datasetRevision: 804, revision: 0, workspace: emptyGraphWorkspace })
    saves.push(init)
    await pending
    return json({ datasetRevision: 804, revision: 1 })
  }))
  const { result } = renderHook(() => useGraphWorkspace(804))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  const positions = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`operation:GET /${"orders/".repeat(20)}${index}`, { x: 500, y: index * 100 }]))
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions } } })))
  expect(saves).toHaveLength(1) // Geometry starts sending without the 250ms debounce.
  expect(saves[0].keepalive).toBe(false)
  const closing = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(closing)
  expect(closing.defaultPrevented).toBe(true)
  release()
  await waitFor(() => expect(result.current.saving).toBe(false))
  const clean = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
})

it("flushes a viewport change when the tab becomes hidden", async () => {
  const workspace = { ...emptyGraphWorkspace, views: { site: emptyGraphView } }
  const fetch = vi.fn(async (_path, init?: RequestInit) => json(init?.method === "POST"
    ? { datasetRevision: 805, revision: 1 } : { datasetRevision: 805, revision: 0, workspace }))
  vi.stubGlobal("fetch", fetch)
  const { result } = renderHook(() => useGraphWorkspace(805))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, viewport: { zoom: 1, pan: { x: 40, y: 60 } } } } })))
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
  act(() => document.dispatchEvent(new Event("visibilitychange")))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
})

it("can retry a transient save failure without discarding the moved position", async () => {
  let failed = false
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => {
    if (init?.method !== "POST") return json({ datasetRevision: 806, revision: 0, workspace: emptyGraphWorkspace })
    if (!failed) { failed = true; throw new Error("network unavailable") }
    return json({ datasetRevision: 806, revision: 1 })
  }))
  const { result } = renderHook(() => useGraphWorkspace(806))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 30, y: 90 } } } } })))
  await waitFor(() => expect(result.current.error).toBe("network unavailable"))
  await act(async () => { await result.current.retry() })
  expect(result.current.error).toBe("")
  expect(result.current.workspace?.views.site.positions.node).toEqual({ x: 30, y: 90 })
  await expect(prepareDatasetReplacement()).resolves.toBeUndefined()
})

it("does not let continuous viewport updates postpone saving beyond one second", async () => {
  const workspace = { ...emptyGraphWorkspace, views: { site: emptyGraphView } }
  const fetch = vi.fn(async (_path, init?: RequestInit) => json(init?.method === "POST"
    ? { datasetRevision: 807, revision: 1 } : { datasetRevision: 807, revision: 0, workspace }))
  vi.stubGlobal("fetch", fetch)
  const { result } = renderHook(() => useGraphWorkspace(807))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  vi.useFakeTimers()
  for (let index = 0; index < 5; index++) {
    act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, viewport: { zoom: 1, pan: { x: index + 1, y: 0 } } } } })))
    expect(fetch).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  }
  expect(fetch).toHaveBeenCalledTimes(2)
  const form = fetch.mock.calls[1][1]?.body as URLSearchParams
  expect(JSON.parse(form.get("changes")!).viewPatches.site.viewport.pan.x).toBe(5)
})

it("releases a synchronously rejected request so a corrected layout can be saved", async () => {
  const fetch = vi.fn(async (_path, init?: RequestInit) => json(init?.method === "POST"
    ? { datasetRevision: 808, revision: 1 } : { datasetRevision: 808, revision: 0, workspace: emptyGraphWorkspace }))
  vi.stubGlobal("fetch", fetch)
  const { result } = renderHook(() => useGraphWorkspace(808))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, expandedGroups: ["x".repeat(2 * 1024 * 1024)] } } })))
  await waitFor(() => expect(result.current.error).toContain("2MiB"))
  expect(result.current.saving).toBe(false)
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 10, y: 20 } } } } })))
  await act(async () => { await result.current.retry() })
  expect(result.current.error).toBe("")
  expect(fetch).toHaveBeenCalledTimes(2)
})

it("keeps unsaved geometry visible on a rejected save and blocks replacing that project", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_path, init?: RequestInit) => init?.method === "POST"
    ? json({ success: false, message: "workspace revision changed" }, 409)
    : json({ datasetRevision: 802, revision: 0, workspace: emptyGraphWorkspace })))
  const { result } = renderHook(() => useGraphWorkspace(802))
  await waitFor(() => expect(result.current.workspace).not.toBeNull())
  act(() => result.current.update(current => ({ ...current, views: { site: { ...emptyGraphView, positions: { node: { x: 3, y: 4 } } } } })))
  await act(async () => { await expect(prepareDatasetReplacement()).rejects.toThrow("workspace revision changed") })
  expect(result.current.workspace?.views.site.positions.node).toEqual({ x: 3, y: 4 })
  expect(result.current.error).toBe("workspace revision changed")
})

it("does not install another dataset's response", async () => {
  const fetch = vi.fn(async () => json({ datasetRevision: 999, revision: 0, workspace: emptyGraphWorkspace }))
  vi.stubGlobal("fetch", fetch)
  const { result } = renderHook(() => useGraphWorkspace(803))
  await waitFor(() => expect(result.current.error).toContain("프로젝트가 변경"))
  expect(result.current.workspace).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
})
